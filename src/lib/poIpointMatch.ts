import { lookupCatalogItem } from './barcodeCatalogLookup'
import type { BarcodeCatalogItem, POBarcode } from '../types/poCheckin'
import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Letters/numbers only — helps match part numbers vs catalog names. */
function alphaKey(s: string): string {
  return norm(s).replace(/[^a-z0-9]/g, '')
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
    if (rn.includes(nj) || nj.includes(rn)) score = 85

    const rPre = jobPrefix(r.job_name)
    const rSlug = jobSlug(r.job_name)

    if (jSlug && rSlug) {
      if (rSlug === jSlug) score = Math.max(score, 95)
      else if (rSlug.includes(jSlug) || jSlug.includes(rSlug)) score = Math.max(score, 88)
    }

    if (jPre && rPre && jPre === rPre && jSlug && rSlug) {
      score = Math.max(score, 75)
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { ref: r, score }
    }
  }

  return best?.ref ?? null
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

  return false
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
    const ref = String(refNumber).trim()
    pool = locations.filter((l) => String(l.ref_number).trim() === ref)
  }

  return pool.filter((l) => productNamesMatch(name, l.product_name))
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

function formatLocationNames(matches: PoItemLocation[]): string | null {
  if (matches.length === 0) return null
  const names = [...new Set(matches.map((m) => m.location_name.trim()).filter(Boolean))]
  return names.length ? names.join(' · ') : null
}

/**
 * Room location(s) for a PO line item:
 * 1) Resolve job from PO Line Report → JobRef ref number
 * 2) Match item name to product rows in that ref's location file
 * 3) If no job ref, search all location files when only one ref has that product
 */
export function locationForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  locations: PoItemLocation[]
): string | null {
  const item = (line.item_name || '').trim()
  if (!item || locations.length === 0) return null

  const ref = resolveJobRef(line.job_or_customer, jobRefs)

  if (ref) {
    const scoped = findItemLocations(item, ref.ref_number, locations)
    const formatted = formatLocationNames(scoped)
    if (formatted) return formatted
  }

  const global = findItemLocations(item, null, locations)
  if (global.length === 0) return null

  const byRef = new Map<string, PoItemLocation[]>()
  for (const row of global) {
    const k = String(row.ref_number).trim()
    if (!byRef.has(k)) byRef.set(k, [])
    byRef.get(k)!.push(row)
  }

  if (byRef.size === 1) {
    return formatLocationNames(global)
  }

  if (ref) {
    const inRef = byRef.get(String(ref.ref_number).trim())
    if (inRef?.length) return formatLocationNames(inRef)
  }

  return formatLocationNames(global)
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

/** Labels from scanner check-ins on a PO (catalog name, part #, raw barcode). */
export function poScanMatchLabels(
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>
): string[] {
  const labels: string[] = []
  for (const b of barcodes) {
    const v = (b.barcode_value || '').trim()
    if (!v) continue
    const cat = lookupCatalogItem(catalogMap, v)
    if (cat?.item_name?.trim()) labels.push(cat.item_name.trim())
    if (cat?.part_number?.trim()) labels.push(cat.part_number.trim())
    labels.push(v)
  }
  return labels
}

/** True if any barcode scan on this PO matches the iPoint line item name. */
export function ipointLineIsScanned(
  line: PoLineItem,
  scanLabels: string[]
): boolean {
  const item = (line.item_name || '').trim()
  if (!item || scanLabels.length === 0) return false
  return scanLabels.some((label) => label && productNamesMatch(item, label))
}
