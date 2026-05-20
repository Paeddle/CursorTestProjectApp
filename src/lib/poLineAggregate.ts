import type { PoLineItem } from '../types/poIpoint'
import type { PoLineReportCsvRow } from './parsePoLineReport'
import { normalizePoKey } from './poIpointMatch'

function norm(s: string): string {
  return s
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Parse requested quantity (Req.) as a whole number. */
export function parseRequestedQuantity(qty: string | number | null | undefined): number {
  if (qty == null || qty === '') return 0
  const s = String(qty).replace(/,/g, '').trim()
  if (!s) return 0
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

/** Store summed Req. — never write "0" when the report had no quantity. */
export function formatAggregatedQuantity(qty: number): string {
  return qty > 0 ? String(qty) : ''
}

/** UI / DB: show dash when missing; avoid showing literal 0 for blank imports. */
export function formatRequestedQuantityDisplay(qty: string | number | null | undefined): string {
  const n = parseRequestedQuantity(qty)
  return n > 0 ? String(n) : '—'
}

/** Blank customer on the PO Line Report means stock. */
export function stockJobLabel(jobOrCustomer: string | null | undefined): string {
  const j = (jobOrCustomer || '').trim()
  return j || 'Stock'
}

export type CustomerQtyBreakdown = {
  job_or_customer: string
  quantity: number
}

function aggregateKey(poNumber: string, itemName: string): string {
  return `${normalizePoKey(poNumber)}\0${norm(itemName || '')}`
}

function customerPrefix(jobOrCustomer: string): string {
  const t = jobOrCustomer.trim()
  const i = t.indexOf(':')
  return norm(i >= 0 ? t.slice(0, i) : t)
}

/** Human-readable job/customer for UI — always prefer PO Line Report text, not fuzzy job ref. */
export function displayJobForAggregatedLine(line: AggregatedPoLineItem): string {
  const parts = line.customerBreakdown.filter((c) => c.job_or_customer && c.job_or_customer !== 'Stock')
  if (parts.length === 0) {
    if (line.job_or_customer === 'Stock') return 'Stock'
    return line.job_or_customer?.trim() || '—'
  }
  if (parts.length === 1) return parts[0]!.job_or_customer
  return parts
    .map((c) => {
      const label = c.job_or_customer
      const pre = customerPrefix(label)
      return pre ? label.split(':')[0]!.trim() + (c.quantity > 1 ? ` (${c.quantity})` : '') : label
    })
    .join('; ')
}

/** Collapse import rows to one row per PO + item (import should keep raw rows; used for CSV preview). */
export function aggregatePoLineReportRows<T extends PoLineReportCsvRow>(rows: T[]): T[] {
  const buckets = new Map<
    string,
    { row: T; qty: number; breakdown: CustomerQtyBreakdown[] }
  >()

  for (const row of rows) {
    const item = (row.item_name || '').trim()
    const po = (row.po_number || '').trim()
    if (!po || !item) continue

    const key = aggregateKey(po, item)
    const qty = parseRequestedQuantity(row.quantity)
    const job = stockJobLabel(row.job_or_customer)

    const prev = buckets.get(key)
    if (!prev) {
      buckets.set(key, {
        row: { ...row, quantity: formatAggregatedQuantity(qty), job_or_customer: job },
        qty,
        breakdown: [{ job_or_customer: job, quantity: qty }],
      })
      continue
    }

    prev.qty += qty
    const existing = prev.breakdown.find((b) => norm(b.job_or_customer) === norm(job))
    if (existing) existing.quantity += qty
    else prev.breakdown.push({ job_or_customer: job, quantity: qty })

    prev.row.quantity = formatAggregatedQuantity(prev.qty)
    prev.row.job_or_customer =
      prev.breakdown.length > 1 ? 'Multiple customers' : prev.breakdown[0]!.job_or_customer
  }

  return [...buckets.values()].map((b) => b.row)
}

export type AggregatedPoLineItem = PoLineItem & {
  /** Original `po_line_items` rows merged into this line (for locations + scan matching). */
  sourceLineIds: string[]
  /** Per-customer requested qty before summing (same PO + item, different jobs). */
  customerBreakdown: CustomerQtyBreakdown[]
}

/** One row per item on a PO with total requested quantity. */
export function aggregateLineItemsForPo(
  poNumber: string,
  items: PoLineItem[]
): AggregatedPoLineItem[] {
  const poKey = normalizePoKey(poNumber)
  const buckets = new Map<
    string,
    {
      line: PoLineItem
      qty: number
      breakdown: CustomerQtyBreakdown[]
      sourceLineIds: string[]
    }
  >()

  for (const line of items) {
    if (normalizePoKey(line.po_number) !== poKey) continue
    const item = (line.item_name || '').trim()
    if (!item) continue

    const key = aggregateKey(line.po_number, item)
    const qty = parseRequestedQuantity(line.quantity)
    const job = stockJobLabel(line.job_or_customer)

    const prev = buckets.get(key)
    if (!prev) {
      buckets.set(key, {
        line,
        qty,
        breakdown: [{ job_or_customer: job, quantity: qty }],
        sourceLineIds: [line.id],
      })
      continue
    }

    prev.qty += qty
    prev.sourceLineIds.push(line.id)
    const existing = prev.breakdown.find((b) => norm(b.job_or_customer) === norm(job))
    if (existing) existing.quantity += qty
    else prev.breakdown.push({ job_or_customer: job, quantity: qty })
  }

  return [...buckets.values()].map(({ line, qty, breakdown, sourceLineIds }) => ({
    ...line,
    quantity: formatAggregatedQuantity(qty),
    job_or_customer:
      breakdown.length > 1 ? 'Multiple customers' : breakdown[0]!.job_or_customer,
    sourceLineIds,
    customerBreakdown: breakdown,
  }))
}
