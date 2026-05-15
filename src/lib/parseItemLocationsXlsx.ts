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

/** Strip zero-width / BOM characters that break exact matches (e.g. VX80R). */
function cleanCellText(v: unknown): string {
  return cellStr(v).replace(/[\u200B-\u200D\uFEFF]/g, '')
}

/** Extract job ref number from filename (4152.xlsx, SalesOrder_4152.xlsx, etc.). */
export function refNumberFromFilename(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, '').trim()
  const exact = base.match(/^(\d{3,6})$/)
  if (exact) return exact[1]!
  const embedded = base.match(/(?:^|[^0-9])(\d{3,6})(?:[^0-9]|$)/)
  return embedded ? embedded[1]! : null
}

function sheetHasLocationColumns(sheet: XLSX.WorkSheet): boolean {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (raw.length === 0) return false
  const headers = Object.keys(raw[0] ?? {}).map(normalizeHeader)
  return headers.some(
    (h) =>
      h === 'locationname' ||
      h === 'location_name' ||
      h === 'location' ||
      h === 'c_product_name' ||
      h === 'product_name'
  )
}

/**
 * Parse one worksheet. Forward-fills location/manufacturer for merged Excel cells
 * (common in iPoint exports — product rows under a room often have blank location cells).
 */
function parseLocationSheet(sheet: XLSX.WorkSheet): ParsedItemLocationRow[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedItemLocationRow[] = []
  let lastLocation = ''
  let lastManufacturer = ''

  for (const row of raw) {
    const map = new Map<string, unknown>()
    for (const k of Object.keys(row)) {
      map.set(normalizeHeader(k), row[k])
    }

    let location =
      cleanCellText(map.get('locationname')) ||
      cleanCellText(map.get('location_name')) ||
      cleanCellText(map.get('location')) ||
      cleanCellText(map.get('room')) ||
      cleanCellText(map.get('room_name'))
    if (location) lastLocation = location
    else if (lastLocation) location = lastLocation

    let manufacturer = cleanCellText(map.get('manufacturer')) || null
    if (manufacturer) lastManufacturer = manufacturer
    else if (lastManufacturer) manufacturer = lastManufacturer

    const partOrModel =
      cleanCellText(map.get('part_number')) ||
      cleanCellText(map.get('partnumber')) ||
      cleanCellText(map.get('part')) ||
      cleanCellText(map.get('model')) ||
      cleanCellText(map.get('model_number')) ||
      cleanCellText(map.get('sku')) ||
      cleanCellText(map.get('item_number'))
    let product =
      cleanCellText(map.get('c_product_name')) ||
      cleanCellText(map.get('c_productname')) ||
      cleanCellText(map.get('product_name')) ||
      cleanCellText(map.get('productname')) ||
      cleanCellText(map.get('item')) ||
      cleanCellText(map.get('product')) ||
      cleanCellText(map.get('description'))

    if (partOrModel) {
      if (!product) product = partOrModel
      else if (!product.toLowerCase().includes(partOrModel.toLowerCase())) {
        product = `${partOrModel} ${product}`
      }
    } else if (!product && manufacturer) {
      product = manufacturer
    }

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

/** Parse job location spreadsheet (4152.xlsx / 4846.xlsx). Uses the sheet with the most location rows. */
export function parseItemLocationsXlsx(buf: ArrayBuffer): ParsedItemLocationRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  let best: ParsedItemLocationRow[] = []

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet || !sheetHasLocationColumns(sheet)) continue
    const rows = parseLocationSheet(sheet)
    if (rows.length > best.length) best = rows
  }

  return best
}
