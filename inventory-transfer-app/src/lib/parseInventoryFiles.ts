import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export type SourceKind = 'ipoint' | 'dtools'

export type ParsedItem = {
  sourceIndex: number
  partNumber: string
  partKey: string
  qtyRaw: string
  qty: number
  itemName: string
  manufacturer: string
  brand: string
  model: string
  original: Record<string, string>
}

export type OriginalRow = {
  sourceIndex: number
  record: Record<string, string>
}

export type ParsedWorkbook = {
  kind: SourceKind
  fileName: string
  headers: string[]
  partNumberHeader: string
  qtyHeader: string
  items: ParsedItem[]
  originalRows: OriginalRow[]
  warnings: string[]
  blankPartRows: number
}

const IPOINT_PART_HEADERS = ['part number', 'partnumber', 'part_number', 'part', 'sku', 'item number']
const IPOINT_ITEM_HEADERS = ['item', 'item name', 'itemname']
const IPOINT_QTY_HEADERS = ['stock_available', 'stock available', 'stockavailable', 'available']
const DTOOLS_PART_HEADERS = ['part number', 'partnumber', 'part_number']
const DTOOLS_MODEL_HEADERS = ['model']
const DTOOLS_QTY_HEADERS = ['quantity on hand', 'qty on hand', 'quantityonhand', 'qoh']

export function normalizePartKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function parseQty(value: unknown): { raw: string; qty: number } {
  if (value === null || value === undefined) return { raw: '', qty: 0 }
  const raw = String(value).trim()
  if (!raw) return { raw: '', qty: 0 }
  const n = Number.parseFloat(raw.replace(/,/g, ''))
  return { raw, qty: Number.isFinite(n) ? n : 0 }
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ')
}

function compactHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function pickHeader(headers: string[], candidates: string[]): string | null {
  const wanted = new Set(candidates.map((c) => c.trim().toLowerCase()))
  for (const h of headers) {
    const n = normHeader(h)
    const c = compactHeader(h)
    if (wanted.has(n) || wanted.has(c) || wanted.has(h.trim().toLowerCase())) return h
  }
  return null
}

function cell(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function pickAlt(row: Record<string, unknown>, names: string[]): string {
  const map = new Map(Object.keys(row).map((k) => [compactHeader(k), k]))
  for (const name of names) {
    const key = map.get(compactHeader(name))
    if (key) return cell(row, key)
  }
  return ''
}

function recordsFromCsv(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const headers = (parsed.meta.fields || []).map((h) => h.trim()).filter(Boolean)
  return { headers, rows: parsed.data }
}

function recordsFromXlsx(buf: ArrayBuffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })
  const headerRow = (matrix[0] || []).map((h) => String(h ?? '').trim())
  const headers = headerRow.filter(Boolean)
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] || []
    const rec: Record<string, unknown> = {}
    headerRow.forEach((h, idx) => {
      if (!h) return
      rec[h] = line[idx] ?? ''
    })
    if (Object.values(rec).some((v) => String(v ?? '').trim())) rows.push(rec)
  }
  return { headers, rows }
}

async function recordsFromFile(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return recordsFromXlsx(await file.arrayBuffer())
  }
  return recordsFromCsv(await file.text())
}

function stringifyOriginal(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = v === null || v === undefined ? '' : String(v)
  }
  return out
}

export async function parseInventoryFile(file: File, kind: SourceKind): Promise<ParsedWorkbook> {
  const { headers, rows } = await recordsFromFile(file)
  const partNumberHeader =
    pickHeader(headers, kind === 'ipoint' ? IPOINT_PART_HEADERS : DTOOLS_PART_HEADERS) ||
    pickHeader(headers, ['part number'])
  const itemHeader = kind === 'ipoint' ? pickHeader(headers, IPOINT_ITEM_HEADERS) : null
  const modelHeader = kind === 'dtools' ? pickHeader(headers, DTOOLS_MODEL_HEADERS) : null
  const qtyHeader =
    pickHeader(headers, kind === 'ipoint' ? IPOINT_QTY_HEADERS : DTOOLS_QTY_HEADERS)

  const warnings: string[] = []
  if (kind === 'ipoint' && !partNumberHeader && !itemHeader) {
    throw new Error(
      `${file.name}: could not find a Part Number or Item column. Headers were: ${headers.join(', ') || '(none)'}`,
    )
  }
  if (kind === 'dtools' && !partNumberHeader && !modelHeader) {
    throw new Error(
      `${file.name}: could not find a Part Number or Model column. Headers were: ${headers.join(', ') || '(none)'}`,
    )
  }
  if (!qtyHeader) {
    const expected = kind === 'ipoint' ? 'Stock available / stock_Available' : 'Quantity on Hand'
    throw new Error(`${file.name}: could not find ${expected}. Headers were: ${headers.join(', ') || '(none)'}`)
  }
  if (!partNumberHeader) {
    warnings.push(
      kind === 'ipoint'
        ? 'No Part Number column; matching will use the Item column only.'
        : 'No Part Number column; matching will use the Model column only.',
    )
  }

  const items: ParsedItem[] = []
  const originalRows: OriginalRow[] = []
  let blankPartRows = 0
  rows.forEach((row, idx) => {
    const sourceIndex = idx + 2
    const original = stringifyOriginal(row)
    originalRows.push({ sourceIndex, record: original })
    const partNumber = partNumberHeader ? cell(row, partNumberHeader) : ''
    const itemName = itemHeader
      ? cell(row, itemHeader)
      : pickAlt(row, ['item', 'description_customer', 'short description', 'description'])
    const model = modelHeader ? cell(row, modelHeader) : pickAlt(row, ['model'])
    const hasIdentity =
      kind === 'ipoint' ? Boolean(partNumber || itemName) : Boolean(partNumber || model)
    if (!hasIdentity) {
      blankPartRows += 1
      return
    }
    const { raw, qty } = parseQty(row[qtyHeader])
    items.push({
      sourceIndex,
      partNumber,
      partKey: normalizePartKey(partNumber),
      qtyRaw: raw,
      qty,
      itemName,
      manufacturer: pickAlt(row, ['manufacturer']),
      brand: pickAlt(row, ['brand']),
      model,
      original,
    })
  })

  if (blankPartRows) {
    warnings.push(
      kind === 'ipoint'
        ? `${blankPartRows} row(s) had a blank part number and item and were skipped.`
        : `${blankPartRows} row(s) had a blank part number and model and were skipped.`,
    )
  }
  const sci = items.filter((i) => /^\d+\.\d+E\+\d+$/i.test(i.partNumber)).length
  if (sci) {
    warnings.push(
      `${sci} part number(s) look like Excel scientific notation (example: 8.87277E+11). Those will not match a real part number until the export is fixed.`,
    )
  }

  return {
    kind,
    fileName: file.name,
    headers,
    partNumberHeader: partNumberHeader || '(missing)',
    qtyHeader,
    items,
    originalRows,
    warnings,
    blankPartRows,
  }
}
