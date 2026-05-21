import * as XLSX from 'xlsx'
import { parseRequestedQuantity } from './poLineAggregate'
import { formatPoDisplay } from './poIpointMatch'
import { parsePoLineReportText, type PoLineReportCsvRow } from './parsePoLineReport'

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function parseExcelDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v)
    if (parsed) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d)
      return d.toISOString().slice(0, 10)
    }
  }
  const s = cellStr(v)
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_').replace(/\./g, '')
}

/** Quantity requested (Req. column in iPoint PO Line Report — not Pending Rec.). */
function quantityFromRow(map: Map<string, unknown>): string {
  const req =
    cellStr(map.get('req')) ||
    cellStr(map.get('req.')) ||
    cellStr(map.get('quantity_requested')) ||
    cellStr(map.get('quantity_req')) ||
    cellStr(map.get('qty_req')) ||
    cellStr(map.get('requested')) ||
    ''
  if (req) return req

  return cellStr(map.get('quantity')) || cellStr(map.get('qty')) || ''
}

function isStockForType(map: Map<string, unknown>): boolean {
  const forType =
    cellStr(map.get('for')) ||
    cellStr(map.get('for_type')) ||
    cellStr(map.get('description')) ||
    ''
  return /for:\s*stock/i.test(forType) || /^stock$/i.test(forType)
}

export type ParsedPoLineItem = PoLineReportCsvRow & { po_date: string | null }

/** Structured column export (header row with PO / Item / Customer / Date). */
function parseStructuredSheet(sheet: XLSX.WorkSheet): ParsedPoLineItem[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedPoLineItem[] = []
  let currentCustomer = ''

  for (const row of rows) {
    const map = new Map<string, unknown>()
    for (const k of Object.keys(row)) {
      map.set(normalizeHeader(k), row[k])
    }

    const firstCol = cellStr(Object.values(row)[0])
    if (firstCol.toLowerCase().startsWith('customer:')) {
      currentCustomer = firstCol.slice(9).trim() || cellStr(map.get('job_or_customer')) || ''
      continue
    }

    const poRaw =
      cellStr(map.get('po_number')) ||
      cellStr(map.get('po')) ||
      cellStr(map.get('ponumber'))
    const item =
      cellStr(map.get('item_name')) ||
      cellStr(map.get('item')) ||
      cellStr(map.get('product'))
    let job =
      cellStr(map.get('job_or_customer')) ||
      cellStr(map.get('customer')) ||
      cellStr(map.get('job')) ||
      currentCustomer
    if (!job && (isStockForType(map) || !currentCustomer)) {
      job = ''
    }
    const poDate =
      parseExcelDate(map.get('po_date')) ||
      parseExcelDate(map.get('date')) ||
      parseExcelDate(map.get('order_date'))

    if (!poRaw && !item) {
      const line = Object.values(row)
        .map((c) => cellStr(c))
        .filter(Boolean)
        .join('\t')
      if (line.toLowerCase().startsWith('customer:')) {
        currentCustomer = line.slice(9).trim()
      }
      continue
    }

    const po = formatPoDisplay(poRaw)
    if (!po || !item) continue

    out.push({
      po_number: po,
      item_name: item,
      part_number: cellStr(map.get('part_number')),
      description: cellStr(map.get('description')),
      color: cellStr(map.get('color')),
      quantity: quantityFromRow(map),
      job_or_customer: job || '',
      po_date: poDate,
    })
  }
  return out
}

/** Hierarchical iPoint export: join each row to text and reuse PDF line parser. */
function parseHierarchicalSheet(sheet: XLSX.WorkSheet): ParsedPoLineItem[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const lines: string[] = []
  for (const row of matrix) {
    if (!Array.isArray(row)) continue
    const parts = row.map((c) => cellStr(c)).filter(Boolean)
    if (parts.length) lines.push(parts.join('\t'))
  }
  const text = lines.join('\n')
  return parsePoLineReportText(text).map((r) => ({ ...r, po_date: null }))
}

function sheetLooksStructured(sheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (rows.length === 0) return false
  const headers = Object.keys(rows[0] ?? {}).map(normalizeHeader)
  return headers.some(
    (h) =>
      h === 'po_number' ||
      h === 'po' ||
      h === 'item_name' ||
      h === 'item' ||
      h === 'job_or_customer' ||
      h === 'customer'
  )
}

/** Parse POLineReport .xlsx (structured columns or hierarchical Customer/PO lines). */
export function parsePoLineReportXlsx(buf: ArrayBuffer): ParsedPoLineItem[] {
  const wb = XLSX.read(buf, { type: 'array' })
  let best: ParsedPoLineItem[] = []

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue

    const structured = sheetLooksStructured(sheet) ? parseStructuredSheet(sheet) : []
    const hierarchical = parseHierarchicalSheet(sheet)
    const pick =
      hierarchical.length > structured.length ? hierarchical : structured
    if (pick.length > best.length) best = pick
  }

  return best
}

/** Summary stats for import feedback (job names, empty jobs, sample POs). */
export function summarizePoLineReportRows(rows: ParsedPoLineItem[]): {
  total: number
  withJob: number
  withoutJob: number
  withQuantity: number
  uniquePos: number
  uniqueJobs: number
} {
  const pos = new Set<string>()
  const jobs = new Set<string>()
  let withJob = 0
  let withQuantity = 0
  for (const r of rows) {
    if (r.po_number) pos.add(r.po_number)
    if (parseRequestedQuantity(r.quantity) > 0) withQuantity++
    const job = (r.job_or_customer || '').trim()
    if (job && job !== 'Stock') {
      withJob++
      jobs.add(job)
    }
  }
  const stockLines = rows.filter((r) => (r.job_or_customer || '').trim() === 'Stock').length
  return {
    total: rows.length,
    withJob,
    withoutJob: stockLines,
    withQuantity,
    uniquePos: pos.size,
    uniqueJobs: jobs.size,
  }
}
