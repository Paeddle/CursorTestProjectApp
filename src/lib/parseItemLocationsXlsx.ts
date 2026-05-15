import * as XLSX from 'xlsx'

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

function parseQty(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number.parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_')
}

/** Extract job ref number from filename (4152.xlsx, SalesOrder_4152.xlsx, etc.). */
export function refNumberFromFilename(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, '').trim()
  const exact = base.match(/^(\d{3,6})$/)
  if (exact) return exact[1]!
  const embedded = base.match(/(?:^|[^0-9])(\d{3,6})(?:[^0-9]|$)/)
  return embedded ? embedded[1]! : null
}

/** Parse job location spreadsheet (4152.xlsx / 4973.xlsx). */
export function parseItemLocationsXlsx(buf: ArrayBuffer): ParsedItemLocationRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedItemLocationRow[] = []

  for (const row of raw) {
    const map = new Map<string, unknown>()
    for (const k of Object.keys(row)) {
      map.set(normalizeHeader(k), row[k])
    }

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

    if (!location || !product) continue
    out.push({
      location_name: location,
      manufacturer,
      product_name: product,
      quantity: qty,
    })
  }
  return out
}
