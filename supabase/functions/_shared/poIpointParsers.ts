/**
 * iPoint file parsers for Edge Functions (mirrors src/lib/* parsers).
 */
import * as XLSX from 'npm:xlsx@0.18.5'

export type ParsedJobRefRow = { job_name: string; ref_number: string }

export type ParsedPoLineItem = {
  po_number: string
  item_name: string
  part_number: string
  description: string
  color: string
  quantity: string
  job_or_customer: string
  po_date: string | null
}

export type ParsedItemLocationRow = {
  location_name: string
  manufacturer: string | null
  product_name: string
  quantity: number | null
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_')
}

function normalizeRef(v: unknown): string {
  const s = cellStr(v)
  if (!s) return ''
  const n = Number.parseFloat(s)
  if (Number.isFinite(n) && Number.isInteger(n)) return String(Math.trunc(n))
  return s.replace(/\D/g, '').slice(0, 8) || s
}

function normalizePoNumber(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^PO-/i.test(t)) return t.replace(/^po-/i, 'PO-')
  const digits = t.replace(/\D/g, '')
  if (digits) return `PO-${digits}`
  return t
}

function parseExcelDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v)
    if (parsed) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d)
      return d.toISOString().slice(0, 10)
    }
  }
  const d = new Date(cellStr(v))
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

export function parseJobRefXlsx(buf: ArrayBuffer): ParsedJobRefRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedJobRefRow[] = []
  for (const row of rows) {
    const keys = Object.keys(row)
    let jobName = ''
    let ref = ''
    for (const k of keys) {
      const nk = normalizeHeader(k)
      const val = cellStr(row[k])
      if (!val) continue
      if (nk.includes('job') && nk.includes('name')) jobName = val
      else if (nk === 'job_name' || nk === 'jobname') jobName = val
      else if (nk.includes('ref')) ref = normalizeRef(row[k])
    }
    if (!jobName && keys.length >= 2) {
      jobName = cellStr(row[keys[0]!])
      ref = normalizeRef(row[keys[1]!])
    }
    if (jobName && ref) out.push({ job_name: jobName, ref_number: ref })
  }
  return out
}

export function parsePoLineReportText(text: string): ParsedPoLineItem[] {
  const lines = text.split(/\r?\n/)
  const rows: ParsedPoLineItem[] = []
  const poRegex = /PO:(\d+)\s*\|\s*Item:([^|]+)\s*\|\s*For:([^\d$]+?)(\d+)/g
  const customerRegex = /^Customer:(.+?)\s+\d+\s+\d+\s+/
  let currentCustomer = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Customer:')) {
      const afterLabel = trimmed.slice(9).trim()
      if (afterLabel && !/^\d/.test(afterLabel)) {
        const match = trimmed.match(customerRegex)
        if (match) currentCustomer = match[1].trim()
        else currentCustomer = afterLabel.replace(/\s+\d+.*$/, '').trim()
      }
      continue
    }
    if (!trimmed.includes('PO:') || !trimmed.includes('| Item:')) continue
    let m: RegExpExecArray | null
    const re = new RegExp(poRegex.source, 'g')
    while ((m = re.exec(trimmed)) !== null) {
      rows.push({
        po_number: `PO-${m[1]}`,
        item_name: m[2].trim(),
        part_number: '',
        description: m[3].trim() ? `For: ${m[3].trim().replace(/\s+/g, ' ')}` : '',
        color: '',
        quantity: m[4],
        job_or_customer: currentCustomer,
        po_date: null,
      })
    }
  }
  return rows
}

function parseStructuredPoLineSheet(sheet: XLSX.WorkSheet): ParsedPoLineItem[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedPoLineItem[] = []
  let currentCustomer = ''
  for (const row of rows) {
    const map = new Map<string, unknown>()
    for (const k of Object.keys(row)) map.set(normalizeHeader(k), row[k])
    const firstCol = cellStr(Object.values(row)[0])
    if (firstCol.toLowerCase().startsWith('customer:')) {
      currentCustomer = firstCol.slice(9).trim()
      continue
    }
    const poRaw =
      cellStr(map.get('po_number')) || cellStr(map.get('po')) || cellStr(map.get('ponumber'))
    const item =
      cellStr(map.get('item_name')) || cellStr(map.get('item')) || cellStr(map.get('product'))
    const job =
      cellStr(map.get('job_or_customer')) ||
      cellStr(map.get('customer')) ||
      cellStr(map.get('job')) ||
      currentCustomer
    const poDate =
      parseExcelDate(map.get('po_date')) ||
      parseExcelDate(map.get('date')) ||
      parseExcelDate(map.get('order_date'))
    if (!poRaw && !item) continue
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

export function parsePoLineReportXlsx(buf: ArrayBuffer): ParsedPoLineItem[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []
  const structured = parseStructuredPoLineSheet(sheet)
  if (structured.length > 0) return structured
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const lines: string[] = []
  for (const row of matrix) {
    if (!Array.isArray(row)) continue
    const parts = row.map((c) => cellStr(c)).filter(Boolean)
    if (parts.length) lines.push(parts.join('\t'))
  }
  return parsePoLineReportText(lines.join('\n'))
}

export async function parsePoLineReportPdf(buf: ArrayBuffer): Promise<ParsedPoLineItem[]> {
  const { PDFParse } = await import('npm:pdf-parse@2.4.5')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const result = await parser.getText()
  const text = result?.text ?? result?.pages?.map((p: { text: string }) => p.text).join('\n') ?? ''
  if (!text.trim()) throw new Error('No text extracted from PO Line Report PDF')
  return parsePoLineReportText(text)
}

export function refNumberFromFilename(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, '').trim()
  const m = base.match(/^(\d{3,6})$/)
  return m ? m[1]! : null
}

export function parseItemLocationsXlsx(buf: ArrayBuffer): ParsedItemLocationRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedItemLocationRow[] = []
  for (const row of raw) {
    const map = new Map<string, unknown>()
    for (const k of Object.keys(row)) map.set(normalizeHeader(k), row[k])
    const location =
      cellStr(map.get('locationname')) ||
      cellStr(map.get('location_name')) ||
      cellStr(map.get('location'))
    const product =
      cellStr(map.get('c_product_name')) ||
      cellStr(map.get('product_name')) ||
      cellStr(map.get('item')) ||
      cellStr(map.get('product'))
    const manufacturer = cellStr(map.get('manufacturer')) || null
    const qty =
      parseQty(map.get('c_quantity_modified_total_to_order')) ??
      parseQty(map.get('quantity')) ??
      parseQty(map.get('qty'))
    if (location && product) {
      out.push({ location_name: location, manufacturer, product_name: product, quantity: qty })
    }
  }
  return out
}

function parseQty(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number.parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
