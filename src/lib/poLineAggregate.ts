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

function aggregateKey(poNumber: string, itemName: string): string {
  return `${normalizePoKey(poNumber)}\0${norm(itemName || '')}`
}

type AggregateBucket<T> = {
  row: T
  qty: number
  jobs: Set<string>
}

function finalizeJob(jobs: Set<string>): string {
  const nonStock = [...jobs].filter((j) => j && j !== 'Stock')
  if (nonStock.length === 0) return 'Stock'
  if (nonStock.length === 1) return nonStock[0]!
  return 'Multiple customers'
}

/** Collapse PO Line Report rows to one row per PO + item with summed Req. quantities. */
export function aggregatePoLineReportRows<T extends PoLineReportCsvRow>(rows: T[]): T[] {
  const buckets = new Map<string, AggregateBucket<T>>()

  for (const row of rows) {
    const item = (row.item_name || '').trim()
    const po = (row.po_number || '').trim()
    if (!po || !item) continue

    const key = aggregateKey(po, item)
    const qty = parseRequestedQuantity(row.quantity)
    const job = stockJobLabel(row.job_or_customer)

    const prev = buckets.get(key)
    if (!prev) {
      const jobs = new Set<string>([job])
      buckets.set(key, {
        row: {
          ...row,
          quantity: formatAggregatedQuantity(qty),
          job_or_customer: finalizeJob(jobs),
        },
        qty,
        jobs,
      })
      continue
    }

    prev.qty += qty
    prev.jobs.add(job)
    prev.row.quantity = formatAggregatedQuantity(prev.qty)
    prev.row.job_or_customer = finalizeJob(prev.jobs)
  }

  return [...buckets.values()].map((b) => b.row)
}

export type AggregatedPoLineItem = PoLineItem & {
  /** Original `po_line_items` rows merged into this line (for locations + scan matching). */
  sourceLineIds: string[]
}

/** One row per item on a PO with total requested quantity. */
export function aggregateLineItemsForPo(
  poNumber: string,
  items: PoLineItem[]
): AggregatedPoLineItem[] {
  const poKey = normalizePoKey(poNumber)
  const buckets = new Map<
    string,
    { line: PoLineItem; qty: number; jobs: Set<string>; sourceLineIds: string[] }
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
        jobs: new Set([job]),
        sourceLineIds: [line.id],
      })
      continue
    }

    prev.qty += qty
    prev.jobs.add(job)
    prev.sourceLineIds.push(line.id)
  }

  return [...buckets.values()].map(({ line, qty, jobs, sourceLineIds }) => ({
    ...line,
    quantity: formatAggregatedQuantity(qty),
    job_or_customer: finalizeJob(jobs),
    sourceLineIds,
  }))
}
