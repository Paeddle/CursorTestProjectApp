import { lookupCatalogItem } from './barcodeCatalogLookup'
import type { BarcodeCatalogItem, POBarcode } from '../types/poCheckin'
import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'
import type { AggregatedPoLineItem } from './poLineAggregate'

function parseLineRequestedQuantity(qty: string | number | null | undefined): number {
  if (qty == null || qty === '') return 0
  const s = String(qty).replace(/,/g, '').trim()
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

function norm(s: string): string {
  return s
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Letters/numbers only — helps match part numbers vs catalog names. */
function alphaKey(s: string): string {
  return norm(s).replace(/[^a-z0-9]/g, '')
}

/** Compare job ref numbers from filenames vs JobRef list (4152, 4152.0, etc.). */
export function normalizeRefNumber(ref: string | number | null | undefined): string {
  const s = String(ref ?? '').trim()
  if (!s) return ''
  const n = Number.parseFloat(s)
  if (Number.isFinite(n) && Number.isInteger(n)) return String(Math.trunc(n))
  const digits = s.replace(/\D/g, '')
  return digits || s
}

function significantTokens(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
}

function slugWordTokens(slug: string): string[] {
  return slug.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
}

/** Shared site words — must not be the only basis for linking a PO line to a job ref. */
const GENERIC_SLUG_TOKENS = new Set([
  'big',
  'sky',
  'lot',
  'yc',
  'unit',
  'bozeman',
  'sales',
  'order',
  'work',
  'ridge',
  'road',
  'hitching',
  'post',
  'chalet',
  'simmons',
  'spruce',
  'white',
  'cowboy',
  'heaven',
])

function distinctiveSlugTokens(slug: string): string[] {
  return slugWordTokens(slug).filter((t) => !GENERIC_SLUG_TOKENS.has(t) && t.length >= 4)
}

/** Trailing site / installer id after the last hyphen (e.g. Scher, DA, Thornton). */
function jobSlugSuffix(jobOrCustomer: string): string | null {
  const t = jobOrCustomer.trim()
  const i = t.lastIndexOf('-')
  if (i < 0) return null
  const tail = norm(t.slice(i + 1))
  const token = tail.split(/[^a-z0-9]+/).filter(Boolean).pop()
  if (!token || /^\d+$/.test(token)) return null
  return token
}

/** PO line items that look like model / part numbers (e.g. VX80R, HRST-8ANS). */
function isCompactModelCode(s: string): boolean {
  const k = alphaKey(s)
  if (k.length < 3 || k.length > 24) return false
  return /\d/.test(k) && /[a-z]/.test(k)
}

/** Hyphenated SKUs (e.g. AC-AEX-DEARC-KIT) — match exactly, not via short alpha prefixes. */
function isHyphenatedPartNumber(s: string): boolean {
  const t = (s || '').trim()
  if (!t.includes('-')) return false
  const segments = t.split('-').filter(Boolean)
  if (segments.length < 2) return false
  if (!segments.every((seg) => /^[A-Za-z0-9]+$/.test(seg))) return false
  return alphaKey(t).length >= 6
}

function locationProductLabels(row: PoItemLocation): string[] {
  const labels: string[] = []
  const product = (row.product_name || '').trim()
  const mfr = (row.manufacturer || '').trim()
  if (product) labels.push(product)
  if (mfr) labels.push(mfr)
  if (mfr && product) labels.push(`${mfr} ${product}`)
  return labels
}

function jobPrefix(jobOrCustomer: string): string {
  const t = jobOrCustomer.trim()
  const i = t.indexOf(':')
  return norm(i >= 0 ? t.slice(0, i) : t)
}

function jobSlug(jobOrCustomer: string): string {
  const t = jobOrCustomer.trim()
  const i = t.indexOf(':')
  return norm(i >= 0 ? t.slice(i + 1) : t)
}

/** Match job_or_customer from PO line to a job ref row (strict — avoids wrong customer in UI). */
export function resolveJobRef(
  jobOrCustomer: string | null | undefined,
  jobRefs: PoJobRef[]
): PoJobRef | null {
  const j = (jobOrCustomer || '').trim()
  if (!j || jobRefs.length === 0 || /multiple customers/i.test(j)) return null

  const nj = norm(j)
  const jPre = jobPrefix(j)
  const jSlug = jobSlug(j)

  const exact = jobRefs.find((r) => norm(r.job_name) === nj)
  if (exact) return exact

  let best: { ref: PoJobRef; score: number } | null = null

  for (const r of jobRefs) {
    const rn = norm(r.job_name)
    const rPre = jobPrefix(r.job_name)
    const rSlug = jobSlug(r.job_name)

    if (rn === nj) return r

    // Company / customer name (before ":") must match — blocks Bottcher → Brandner via shared "-Bottcher".
    if (!jPre || !rPre || jPre !== rPre) continue

    let score = 0
    if (jSlug && rSlug) {
      if (jSlug === rSlug) score = 98
      else if (jSlug.includes(rSlug) || rSlug.includes(jSlug)) score = 90
    }

    const jWords = slugWordTokens(jSlug)
    const rWords = slugWordTokens(rSlug)
    const sharedWords = jWords.filter(
      (t) => t.length >= 5 && !/^\d+$/.test(t) && rWords.includes(t)
    )
    if (sharedWords.length >= 2) score = Math.max(score, 92)

    if (score > 0 && score < 98) {
      const jSuffix = jobSlugSuffix(j)
      const rSuffix = jobSlugSuffix(r.job_name)
      if (jSuffix && rSuffix && jSuffix !== rSuffix) continue

      const sharedDistinct = distinctiveSlugTokens(jSlug).filter((t) =>
        distinctiveSlugTokens(rSlug).includes(t)
      )
      if (sharedDistinct.length === 0) continue
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { ref: r, score }
    }
  }

  return best && best.score >= 88 ? best.ref : null
}

/** Job location file ref # for a PO line (null when job ref is not linked). */
export function refNumberForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[]
): string | null {
  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  return ref ? normalizeRefNumber(ref.ref_number) : null
}

function productNamesMatchPartNumber(a: string, b: string): boolean {
  const ka = alphaKey(a)
  const kb = alphaKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const na = norm(a)
  const nb = norm(b)
  if (na.length >= 6 && nb.includes(na)) return true
  if (nb.length >= 6 && na.includes(nb)) return true
  return false
}

export function productNamesMatch(a: string, b: string): boolean {
  if (isHyphenatedPartNumber(a) || isHyphenatedPartNumber(b)) {
    return productNamesMatchPartNumber(a, b)
  }

  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true

  const ka = alphaKey(a)
  const kb = alphaKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  if (ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka))) {
    const shorter = Math.min(ka.length, kb.length)
    const longer = Math.max(ka.length, kb.length)
    if (shorter / longer >= 0.75) return true
  }

  // Short model codes from PO lines (e.g. VX80R) inside longer catalog/location text.
  if (isCompactModelCode(a) && kb.includes(ka)) return true
  if (isCompactModelCode(b) && ka.includes(kb)) return true

  const ta = significantTokens(a)
  const tb = significantTokens(b)
  if (ta.length > 0 && tb.length > 0) {
    const tbSet = new Set(tb)
    const hits = ta.filter(
      (t) =>
        tbSet.has(t) ||
        [...tbSet].some((u) => u.includes(t) || t.includes(u))
    )
    const minTokens = Math.min(ta.length, tb.length)
    if (hits.length >= 1 && hits.length >= Math.max(1, Math.ceil(minTokens * 0.5))) {
      return true
    }
    const longestA = [...ta].sort((x, y) => y.length - x.length)[0]
    const longestB = [...tb].sort((x, y) => y.length - x.length)[0]
    if (
      longestA &&
      longestB &&
      longestA.length >= 4 &&
      longestB.length >= 4 &&
      (longestA === longestB ||
        longestA.includes(longestB) ||
        longestB.includes(longestA))
    ) {
      return true
    }
  }

  return false
}

function rowMatchesProduct(row: PoItemLocation, productName: string): boolean {
  const name = (productName || '').trim()
  if (!name) return false
  return locationProductLabels(row).some((label) => productNamesMatch(name, label))
}

/** All location rows for a product, optionally limited to one job ref number. */
export function findItemLocations(
  productName: string,
  refNumber: string | null | undefined,
  locations: PoItemLocation[]
): PoItemLocation[] {
  const name = (productName || '').trim()
  if (!name) return []

  let pool = locations
  if (refNumber != null && String(refNumber).trim() !== '') {
    const ref = normalizeRefNumber(refNumber)
    pool = locations.filter((l) => normalizeRefNumber(l.ref_number) === ref)
  }

  return pool.filter((l) => rowMatchesProduct(l, name))
}

/** Single best location row (legacy). */
export function findItemLocation(
  productName: string,
  refNumber: string | null,
  locations: PoItemLocation[]
): PoItemLocation | null {
  const matches = findItemLocations(productName, refNumber, locations)
  return matches[0] ?? null
}

/** Linked job ref name when confident; otherwise null (use PO line customer text for display). */
export function jobNameForLine(line: PoLineItem, jobRefs: PoJobRef[]): string | null {
  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  return ref?.job_name ?? null
}

/**
 * When the job file lists per-room quantities, pick the rooms that cover the PO
 * requested qty (e.g. two rows of qty 1 for Req. 2 → two locations).
 */
export function narrowLocationsByRequestedQty(
  matches: PoItemLocation[],
  requestedQty: number
): PoItemLocation[] {
  if (requestedQty <= 0 || matches.length <= requestedQty) return matches

  const withQty = matches.filter((m) => m.quantity != null && m.quantity > 0)
  if (withQty.length === 0) return matches

  const covering = withQty.find((m) => (m.quantity ?? 0) >= requestedQty)
  if (covering && withQty.length === 1) return [covering]

  let sum = 0
  const picked: PoItemLocation[] = []
  const ordered = [...withQty].sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0))
  for (const row of ordered) {
    if (sum >= requestedQty) break
    picked.push(row)
    sum += row.quantity ?? 0
  }
  if (sum >= requestedQty) return dedupeLocationsByName(picked)

  return matches
}

export function dedupeLocationsByName(matches: PoItemLocation[]): PoItemLocation[] {
  const seen = new Set<string>()
  const out: PoItemLocation[] = []
  for (const row of matches) {
    const name = row.location_name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(row)
  }
  return out.sort((a, b) => a.location_name.localeCompare(b.location_name))
}

function formatLocationNames(matches: PoItemLocation[]): string | null {
  const names = locationNamesFromRows(matches)
  return names.length ? names.join(' · ') : null
}

function locationNamesFromRows(matches: PoItemLocation[]): string[] {
  return dedupeLocationsByName(matches).map((m) => m.location_name.trim()).filter(Boolean)
}

/**
 * Room location rows for a PO line item — only from the linked job ref's location file.
 * No cross-job fallback (avoids showing rooms from other ref spreadsheets).
 */
export function locationsForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  locations: PoItemLocation[],
  requestedQty?: number | null
): PoItemLocation[] {
  const item = (line.item_name || '').trim()
  if (!item || locations.length === 0) return []

  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  if (!ref) return []

  const inRef = findItemLocations(item, ref.ref_number, locations)
  const deduped = dedupeLocationsByName(inRef)
  const qty =
    requestedQty != null && requestedQty > 0
      ? requestedQty
      : parseLineRequestedQuantity(line.quantity)
  return narrowLocationsByRequestedQty(deduped, qty)
}

/** Unique location names for a PO line item. */
export function locationNamesForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  locations: PoItemLocation[],
  requestedQty?: number | null
): string[] {
  return locationNamesFromRows(locationsForLine(line, jobRefs, locations, requestedQty))
}

/**
 * Rooms for an aggregated PO row — only from the job ref file tied to each
 * active source line's job/customer, aligned to requested quantity when the
 * location file lists per-room qty.
 */
export function locationsForAggregatedLine(
  line: AggregatedPoLineItem,
  sourceLines: PoLineItem[],
  jobRefs: PoJobRef[],
  locations: PoItemLocation[],
  activeSourceLineIds: string[],
  requestedQty?: number | null
): PoItemLocation[] {
  const sourceById = new Map(sourceLines.map((l) => [l.id, l]))
  const qty =
    requestedQty != null && requestedQty > 0
      ? requestedQty
      : parseLineRequestedQuantity(line.quantity)
  const matches: PoItemLocation[] = []
  for (const id of activeSourceLineIds) {
    const src = sourceById.get(id)
    if (!src) continue
    matches.push(...locationsForLine(src, jobRefs, locations, null))
  }
  const deduped = dedupeLocationsByName(matches)
  return narrowLocationsByRequestedQty(deduped, qty)
}

export function locationNamesForAggregatedLine(
  line: AggregatedPoLineItem,
  sourceLines: PoLineItem[],
  jobRefs: PoJobRef[],
  locations: PoItemLocation[],
  activeSourceLineIds: string[],
  requestedQty?: number | null
): string[] {
  return locationNamesFromRows(
    locationsForAggregatedLine(
      line,
      sourceLines,
      jobRefs,
      locations,
      activeSourceLineIds,
      requestedQty
    )
  )
}

/**
 * Room location(s) for a PO line item:
 * 1) Resolve job from PO Line Report → JobRef ref number
 * 2) Match item name to product rows in that ref's location file only
 */
export function locationForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  locations: PoItemLocation[]
): string | null {
  return formatLocationNames(locationsForLine(line, jobRefs, locations))
}

/** Normalize PO numbers for comparison (PO-11831 vs 11831). */
export function normalizePoKey(po: string): string {
  const t = po.trim()
  const m = t.match(/PO-?(\d+)/i)
  if (m) return `po-${m[1]}`
  const digits = t.replace(/\D/g, '')
  if (digits) return `po-${digits}`
  return t.toLowerCase()
}

/** Single display form: PO-12345 (never PO PO-12345). */
export function formatPoDisplay(po: string): string {
  const t = (po || '').trim()
  if (!t) return ''
  const m = t.match(/^PO-?(\d+)/i)
  if (m) return `PO-${m[1]}`
  const digits = t.replace(/\D/g, '')
  if (digits) return `PO-${digits}`
  return /^PO/i.test(t) ? t : `PO-${t}`
}

export function lineItemsForPo(poNumber: string, items: PoLineItem[]): PoLineItem[] {
  const key = normalizePoKey(poNumber)
  return items.filter((i) => normalizePoKey(i.po_number) === key)
}

/**
 * Strict match: scanned barcode/catalog text vs PO Line Report item name only.
 * (Location spreadsheet aliases are intentionally excluded — they caused false
 * "Scanned" hits when another item on the PO shared a similar location product.)
 */
export function ipointScanFieldMatchesItemName(itemName: string, scanField: string): boolean {
  const item = (itemName || '').trim()
  const scan = (scanField || '').trim()
  if (!item || !scan) return false

  if (isHyphenatedPartNumber(item) || isHyphenatedPartNumber(scan)) {
    return productNamesMatchPartNumber(item, scan)
  }

  const na = norm(item)
  const nb = norm(scan)
  if (na === nb) return true

  const ka = alphaKey(item)
  const kb = alphaKey(scan)
  if (ka && kb && ka === kb) return true

  if (isCompactModelCode(item) && kb.includes(ka)) {
    return (
      significantTokens(scan).includes(ka) ||
      productNamesMatchPartNumber(item, scan)
    )
  }
  if (isCompactModelCode(scan) && ka.includes(kb)) {
    return (
      significantTokens(item).includes(kb) ||
      productNamesMatchPartNumber(item, scan)
    )
  }

  if (ka.length >= 6 && kb.length >= 6) {
    const shorter = Math.min(ka.length, kb.length)
    const longer = Math.max(ka.length, kb.length)
    if ((ka.includes(kb) || kb.includes(ka)) && shorter / longer >= 0.82) {
      return true
    }
  }

  if (na.length >= 8 && nb.length >= 8) {
    const shorter = Math.min(na.length, nb.length)
    const longer = Math.max(na.length, nb.length)
    if ((na.includes(nb) || nb.includes(na)) && shorter / longer >= 0.65) {
      return true
    }
  }

  const ta = significantTokens(item)
  const tb = significantTokens(scan)
  if (ta.length === 0 || tb.length === 0) return false

  const shorterToks = ta.length <= tb.length ? ta : tb
  const longerSet = new Set(ta.length <= tb.length ? tb : ta)
  const hits = shorterToks.filter((t) => longerSet.has(t))
  if (hits.length < shorterToks.length) return false
  if (shorterToks.length >= 2) return true
  return shorterToks.length === 1 && shorterToks[0]!.length >= 5
}

/** Catalog + raw barcode strings associated with a scanned barcode value. */
function scannedBarcodeMatchFields(
  barcodeValue: string,
  catalogMap: Map<string, BarcodeCatalogItem>
): string[] {
  const v = (barcodeValue || '').trim()
  if (!v) return []

  const fields = new Set<string>([v])
  const cat = lookupCatalogItem(catalogMap, v)
  if (cat?.item_name?.trim()) fields.add(cat.item_name.trim())
  if (cat?.part_number?.trim()) fields.add(cat.part_number.trim())
  return [...fields]
}

/**
 * True when a barcode for this item was scanned on the PO (scanner app → po_barcodes).
 * Compares catalog/barcode text to this line's PO item name only (strict similarity).
 */
export function ipointLineIsScanned(
  line: PoLineItem,
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  _locations: PoItemLocation[],
  _jobRefs: PoJobRef[]
): boolean {
  const itemName = (line.item_name || '').trim()
  if (!itemName || !barcodes.length) return false

  for (const scan of barcodes) {
    const scanFields = scannedBarcodeMatchFields(scan.barcode_value, catalogMap)
    for (const scanField of scanFields) {
      if (ipointScanFieldMatchesItemName(itemName, scanField)) return true
    }
  }
  return false
}

function bumpLatest(latest: { at: string | null; ms: number }, scannedAt: string) {
  const ms = new Date(scannedAt).getTime()
  if (!Number.isFinite(ms)) return
  if (ms > latest.ms) {
    latest.ms = ms
    latest.at = scannedAt
  }
}

/** Latest scanner timestamp for barcodes matching this PO line item name. */
export function ipointItemLastScannedAt(
  itemName: string,
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>
): string | null {
  const item = (itemName || '').trim()
  if (!item || !barcodes.length) return null

  const latest = { at: null as string | null, ms: -1 }

  for (const scan of barcodes) {
    let matched = false
    for (const field of scannedBarcodeMatchFields(scan.barcode_value, catalogMap)) {
      if (ipointScanFieldMatchesItemName(item, field)) {
        matched = true
        break
      }
    }
    const cat = lookupCatalogItem(catalogMap, scan.barcode_value)
    if (!matched && cat?.item_name?.trim() && productNamesMatch(item, cat.item_name)) {
      matched = true
    }
    if (!matched && cat?.part_number?.trim() && productNamesMatch(item, cat.part_number)) {
      matched = true
    }
    if (matched) bumpLatest(latest, scan.scanned_at)
  }

  return latest.at
}

/** Set of iPoint line ids that have at least one matching barcode scan on the PO. */
export function ipointScannedLineIds(
  lines: PoLineItem[],
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  locations: PoItemLocation[],
  jobRefs: PoJobRef[]
): Set<string> {
  const ids = new Set<string>()
  for (const line of lines) {
    if (ipointLineIsScanned(line, barcodes, catalogMap, locations, jobRefs)) {
      ids.add(line.id)
    }
  }
  return ids
}
