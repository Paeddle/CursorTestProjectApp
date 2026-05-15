import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Match job_or_customer from PO line to a job ref row (exact or contains). */
export function resolveJobRef(
  jobOrCustomer: string | null | undefined,
  jobRefs: PoJobRef[]
): PoJobRef | null {
  const j = (jobOrCustomer || '').trim()
  if (!j) return null
  const nj = norm(j)
  const exact = jobRefs.find((r) => norm(r.job_name) === nj)
  if (exact) return exact
  const contains = jobRefs.find((r) => nj.includes(norm(r.job_name)) || norm(r.job_name).includes(nj))
  return contains ?? null
}

/** Find room location for a product name within a job ref's location list. */
export function findItemLocation(
  productName: string,
  refNumber: string | null,
  locations: PoItemLocation[]
): PoItemLocation | null {
  const name = norm(productName)
  if (!name || !refNumber) return null
  const pool = locations.filter((l) => l.ref_number === refNumber)
  const exact = pool.find((l) => norm(l.product_name) === name)
  if (exact) return exact
  const partial = pool.find(
    (l) => norm(l.product_name).includes(name) || name.includes(norm(l.product_name))
  )
  return partial ?? null
}

export function jobNameForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[]
): string | null {
  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  return ref?.job_name ?? (line.job_or_customer?.trim() || null)
}

export function locationForLine(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  locations: PoItemLocation[]
): string | null {
  const ref = resolveJobRef(line.job_or_customer, jobRefs)
  const loc = findItemLocation(line.item_name, ref?.ref_number ?? null, locations)
  return loc?.location_name ?? null
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
