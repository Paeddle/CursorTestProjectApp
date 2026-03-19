import * as XLSX from 'xlsx'
import type { InventoryRow } from '../types/purchaseList'

const TARGET_FIELDS = [
  'manufacturer',
  'category',
  'type',
  'item',
  'part_number',
  'description_customer',
  'unit',
  'color',
  'unit_hard_cost',
  'unit_price',
  'margin',
  'markup',
  'id_class',
  'vendor_name',
  'barcode',
  'stock_total',
  'stock_available',
  'stock_on_order',
] as const

type TargetKey = (typeof TARGET_FIELDS)[number]

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

/** Map many possible spreadsheet headers → canonical snake_case keys */
function headerSynonyms(): Map<string, TargetKey> {
  const m = new Map<string, TargetKey>()
  const add = (keys: string[], field: TargetKey) => {
    for (const k of keys) m.set(normalizeHeader(k), field)
  }
  add(['manufacturer', 'man', 'mfg'], 'manufacturer')
  add(['category'], 'category')
  add(['type'], 'type')
  add(['item'], 'item')
  add(['partnumber', 'part_number', 'part', 'partno', 'sku'], 'part_number')
  add(['descriptioncustomer', 'description_customer', 'description', 'custdescription'], 'description_customer')
  add(['unit'], 'unit')
  add(['color'], 'color')
  add(['unithardcost', 'unit_hard_cost', 'hardcost', 'cost'], 'unit_hard_cost')
  add(['unitprice', 'unit_price', 'price'], 'unit_price')
  add(['margin'], 'margin')
  add(['markup'], 'markup')
  add(['idclass', 'id_class', 'class'], 'id_class')
  add(['vendorname', 'vendor_name', 'vendor'], 'vendor_name')
  add(['barcode', 'upc', 'ean'], 'barcode')
  add(['stocktotal', 'stock_total', 'totalstock', 'qtytotal'], 'stock_total')
  add(['stockavailable', 'stock_available', 'available', 'qtyavailable', 'onhand'], 'stock_available')
  add(['stockonorder', 'stock_on_order', 'onorder', 'qtyonorder'], 'stock_on_order')
  return m
}

const SYNONYMS = headerSynonyms()

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number' && Number.isFinite(val)) return val
  const s = String(val).trim().replace(/[$,%]/g, '').replace(/,/g, '')
  if (!s) return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function parseString(val: unknown): string | null {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  return s.length ? s : null
}

export function parseInventoryXlsxArrayBuffer(buf: ArrayBuffer): InventoryRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const first = wb.SheetNames[0]
  if (!first) return []
  const sheet = wb.Sheets[first]
  if (!sheet) return []

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })

  const out: InventoryRow[] = []
  for (const row of rows) {
    const keys = Object.keys(row)
    const colMap = new Map<TargetKey, unknown>()
    for (const k of keys) {
      const nk = normalizeHeader(k)
      const field = SYNONYMS.get(nk)
      if (field) colMap.set(field, row[k])
    }

    const inv: InventoryRow = {
      manufacturer: parseString(colMap.get('manufacturer')),
      category: parseString(colMap.get('category')),
      type: parseString(colMap.get('type')),
      item: parseString(colMap.get('item')),
      part_number: parseString(colMap.get('part_number')),
      description_customer: parseString(colMap.get('description_customer')),
      unit: parseString(colMap.get('unit')),
      color: parseString(colMap.get('color')),
      unit_hard_cost: parseNumber(colMap.get('unit_hard_cost')),
      unit_price: parseNumber(colMap.get('unit_price')),
      margin: parseNumber(colMap.get('margin')),
      markup: parseNumber(colMap.get('markup')),
      id_class: parseString(colMap.get('id_class')),
      vendor_name: parseString(colMap.get('vendor_name')),
      barcode: parseString(colMap.get('barcode')),
      stock_total: parseNumber(colMap.get('stock_total')),
      stock_available: parseNumber(colMap.get('stock_available')),
      stock_on_order: parseNumber(colMap.get('stock_on_order')),
    }

    const hasAny =
      inv.part_number ||
      inv.barcode ||
      inv.item ||
      inv.manufacturer ||
      inv.stock_available != null
    if (hasAny) out.push(inv)
  }

  return out
}
