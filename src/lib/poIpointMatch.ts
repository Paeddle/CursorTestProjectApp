import { lookupCatalogItem } from './barcodeCatalogLookup'
import type { BarcodeCatalogItem, POBarcode } from '../types/poCheckin'
import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'

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

/** PO line items that look like model / part numbers (e.g. VX80R, HRST-8ANS). */
function isCompactModelCode(s: string): boolean {
  const k = alphaKey(s)
  if (k.length < 3 || k.length > 24) return false
  return /\d/.test(k) && /[a-z]/.test(k)
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

/** Match job_or_customer from PO line to a job ref row. */
export function resolveJobRef(
  jobOrCustomer: string | null | undefined,
  jobRefs: PoJobRef[]
): PoJobRef | null {
  const j = (jobOrCustomer || '').trim()
  if (!j || jobRefs.length === 0) return null

  const nj = norm(j)
  const jPre = jobPrefix(j)
  const jSlug = jobSlug(j)

  const exact = jobRefs.find((r) => norm(r.job_name) === nj)
  if (exact) return exact

  let best: { ref: PoJobRef; score: number } | null = null

  for (const r of jobRefs) {
    const rn = norm(r.job_name)
    let score = 0

    if (rn === nj) return r
    if (
      (rn.length >= 8 || nj.length >= 8) &&
      (rn.includes(nj) || nj.includes(rn))
    ) {
      score = 85
    }

    const rPre = jobPrefix(r.job_name)
    const rSlug = jobSlug(r.job_name)

    if (jSlug && rSlug) {
      if (rSlug === jSlug) score = Math.max(score, 95)
      else if (rSlug.includes(jSlug) || jSlug.includes(rSlug)) score = Math.max(score, 88)
    }

    if (jPre && rPre && jPre === rPre && jSlug && rSlug) {
      score = Math.max(score, 75)
    }

    const jWords = slugWordTokens(jSlug)
    const rWords = slugWordTokens(rSlug)
    const sharedWords = jWords.filter(
      (t) => t.length >= 5 && !/^\d+$/.test(t) && rWords.includes(t)
    )
    if (sharedWords.length >= 2) {
      score = Math.max(score, 92)
    } else if (sharedWords.length === 1 && sharedWords[0]!.length >= 6) {
      score = Math.max(score, 88)
    }

    const jTail = jSlug.split('-').pop() || ''
    const rTail = rSlug.split('-').pop() || ''
    if (jTail.length >= 5 && jTail === rTail) {
      score = Math.max(score, 92)
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { ref: r, score }
    }
  }

  return best && best.score >= 75 ? best.ref : null
}

export function productNamesMatch(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true

  const ka = alphaKey(a)
  const kb = alphaKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  if (ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka))) return true

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

export function jobNameForLine(line: PoLineItem, jobRefs: PoJobRef[]): string | null {
  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  return ref?.job_name ?? (line.job_or_customer?.trim() || null)
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
  locations: PoItemLocation[]
): PoItemLocation[] {
  const item = (line.item_name || '').trim()
  if (!item || locations.length === 0) return []

  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  if (!ref) return []

  const inRef = findItemLocations(item, ref.ref_number, locations)
  return dedupeLocationsByName(inRef)
}

/** Unique location names for a PO line item. */
export function locationNamesForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  locations: PoItemLocation[]
): string[] {
  return locationNamesFromRows(locationsForLine(line, jobRefs, locations))
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

export function lineItemsForPo(poNumber: string, items: PoLineItem[]): PoLineItem[] {
  const key = normalizePoKey(poNumber)
  return items.filter((i) => normalizePoKey(i.po_number) === key)
}

/** Names that identify an iPoint line (report item name + matched location products). */
export function ipointLineMatchNames(
  line: PoLineItem,
  locations: PoItemLocation[],
  jobRefs: PoJobRef[]
): string[] {
  const item = (line.item_name || '').trim()
  if (!item) return []

  const names = new Set<string>([item])
  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  for (const loc of findItemLocations(item, ref?.ref_number ?? null, locations)) {
    const product = (loc.product_name || '').trim()
    if (product) names.add(product)
  }
  return [...names]
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
 * Matches via barcode catalog item/part number and location spreadsheet product names.
 */
export function ipointLineIsScanned(
  line: PoLineItem,
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  locations: PoItemLocation[],
  jobRefs: PoJobRef[]
): boolean {
  if (!barcodes.length) return false

  const lineNames = ipointLineMatchNames(line, locations, jobRefs)
  if (lineNames.length === 0) return false

  for (const scan of barcodes) {
    const scanFields = scannedBarcodeMatchFields(scan.barcode_value, catalogMap)
    for (const scanField of scanFields) {
      for (const lineName of lineNames) {
        if (productNamesMatch(lineName, scanField)) return true
      }
    }
  }
  return false
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
