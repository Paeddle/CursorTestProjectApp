import * as XLSX from 'xlsx'
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

function normalizePoNumber(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^PO-/i.test(t)) return t.replace(/^po-/i, 'PO-')
  const digits = t.replace(/\D/g, '')
  if (digits) return `PO-${digits}`
  return t
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_')
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
    const job =
      cellStr(map.get('job_or_customer')) ||
      cellStr(map.get('customer')) ||
      cellStr(map.get('job')) ||
      currentCustomer
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

    const po = normalizePoNumber(poRaw)
    if (!po || !item) continue

    out.push({
      po_number: po,
      item_name: item,
      part_number: cellStr(map.get('part_number')),
      description: cellStr(map.get('description')),
      color: cellStr(map.get('color')),
      quantity: cellStr(map.get('quantity')),
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

/** Parse POLineReport .xlsx (structured columns or hierarchical Customer/PO lines). */
export function parsePoLineReportXlsx(buf: ArrayBuffer): ParsedPoLineItem[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []

  const structured = parseStructuredSheet(sheet)
  if (structured.length > 0) return structured
  return parseHierarchicalSheet(sheet)
}
