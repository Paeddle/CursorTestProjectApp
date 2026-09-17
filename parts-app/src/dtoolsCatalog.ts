export type DtoolsProduct = {
  id: string
  csv_row: number
  brand: string | null
  model: string | null
  part_number: string | null
  short_description: string | null
  description: string | null
  category: string | null
  keywords: string | null
  image_url: string | null
  msrp: string | null
  unit_cost: string | null
  unit_price: string | null
  taxable: string | null
  supplier: string | null
  system: string | null
  phase: string | null
  upc: string | null
  ean: string | null
  itf: string | null
  quantity_on_hand: string | null
  minimum_stock_level: string | null
  reorder_level: string | null
  discontinued: string | null
  height: string | null
  width: string | null
  depth: string | null
  weight: string | null
  rack_mounted: string | null
  rack_units: string | null
  amps: string | null
  volts: string | null
  watts: string | null
  btu: string | null
  installation_hours: string | null
  tax: string | null
  unit_of_measure: string | null
  margin: string | null
  markup: string | null
  length_based: string | null
  inventory_value: string | null
  inherited_labor_items: string | null
  inherited_accessories: string | null
  item_dtin: string | null
  active: string | null
  created_date: string | null
  modified_date: string | null
  imported_at: string
}

export const DTOOLS_FIELD_LABELS: { key: keyof DtoolsProduct; label: string }[] = [
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'part_number', label: 'Part number' },
  { key: 'short_description', label: 'Short description' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'image_url', label: 'Image URL' },
  { key: 'msrp', label: 'MSRP' },
  { key: 'unit_cost', label: 'Unit cost' },
  { key: 'unit_price', label: 'Unit price' },
  { key: 'taxable', label: 'Taxable' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'system', label: 'System' },
  { key: 'phase', label: 'Phase' },
  { key: 'upc', label: 'UPC' },
  { key: 'ean', label: 'EAN' },
  { key: 'itf', label: 'ITF' },
  { key: 'quantity_on_hand', label: 'Quantity on hand' },
  { key: 'minimum_stock_level', label: 'Minimum stock level' },
  { key: 'reorder_level', label: 'Reorder level' },
  { key: 'discontinued', label: 'Discontinued' },
  { key: 'height', label: 'Height' },
  { key: 'width', label: 'Width' },
  { key: 'depth', label: 'Depth' },
  { key: 'weight', label: 'Weight' },
  { key: 'rack_mounted', label: 'Rack mounted' },
  { key: 'rack_units', label: 'Rack units' },
  { key: 'amps', label: 'Amps' },
  { key: 'volts', label: 'Volts' },
  { key: 'watts', label: 'Watts' },
  { key: 'btu', label: 'BTU' },
  { key: 'installation_hours', label: 'Installation hours' },
  { key: 'tax', label: 'Tax' },
  { key: 'unit_of_measure', label: 'Unit of measure' },
  { key: 'margin', label: 'Margin' },
  { key: 'markup', label: 'Markup' },
  { key: 'length_based', label: 'Length based' },
  { key: 'inventory_value', label: 'Inventory value' },
  { key: 'inherited_labor_items', label: 'Inherited labor items' },
  { key: 'inherited_accessories', label: 'Inherited accessories' },
  { key: 'item_dtin', label: 'Item DTIN' },
  { key: 'active', label: 'Active' },
  { key: 'created_date', label: 'Created date' },
  { key: 'modified_date', label: 'Modified date' },
]

export function textField(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export type DtoolsEditKey = (typeof DTOOLS_FIELD_LABELS)[number]['key']

export type DtoolsEditFields = Record<DtoolsEditKey, string>

export const DTOOLS_LONG_FIELDS = new Set<DtoolsEditKey>([
  'short_description',
  'description',
  'keywords',
  'inherited_labor_items',
  'inherited_accessories',
])

export function emptyDtoolsEditFields(): DtoolsEditFields {
  const out = {} as DtoolsEditFields
  for (const { key } of DTOOLS_FIELD_LABELS) out[key] = ''
  return out
}

export function dtoolsToEditFields(row: DtoolsProduct): DtoolsEditFields {
  const out = emptyDtoolsEditFields()
  for (const { key } of DTOOLS_FIELD_LABELS) {
    out[key] = textField(row[key] as string | null)
  }
  return out
}

export function dtoolsEditPayload(fields: DtoolsEditFields): Record<DtoolsEditKey, string | null> {
  const payload = {} as Record<DtoolsEditKey, string | null>
  for (const { key } of DTOOLS_FIELD_LABELS) {
    const value = fields[key].trim()
    payload[key] = value || null
  }
  return payload
}

export function dtoolsTitle(row: DtoolsProduct): string {
  return (
    textField(row.short_description) ||
    [textField(row.brand), textField(row.model)].filter(Boolean).join(' ') ||
    textField(row.part_number) ||
    textField(row.upc) ||
    'Untitled product'
  )
}

export function dtoolsMeta(row: DtoolsProduct): string {
  const bits: string[] = []
  if (textField(row.brand)) bits.push(row.brand as string)
  if (textField(row.model)) bits.push(row.model as string)
  if (textField(row.part_number)) bits.push(row.part_number as string)
  if (textField(row.supplier)) bits.push(row.supplier as string)
  return bits.join(' · ')
}

export function dtoolsMatchesQuery(row: DtoolsProduct, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return DTOOLS_FIELD_LABELS.some(({ key }) => textField(row[key] as string | null).toLowerCase().includes(q))
}

export function uniqueSorted(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>()
  for (const value of values) {
    const trimmed = textField(value)
    if (trimmed) set.add(trimmed)
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

export function categorySegments(category: string | null | undefined): string[] {
  return textField(category)
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function matchesCategory(
  row: DtoolsProduct,
  root: string,
  child: string,
): boolean {
  if (!root) return true
  const segments = categorySegments(row.category)
  if (segments[0] !== root) return false
  if (!child) return true
  return segments[1] === child
}

export type DtoolsSort = 'name' | 'brand' | 'supplier' | 'part_number'

function compareText(a: string, b: string): number {
  const left = a.trim()
  const right = b.trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortDtoolsProducts(rows: DtoolsProduct[], sort: DtoolsSort): DtoolsProduct[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (sort === 'name') return compareText(dtoolsTitle(a), dtoolsTitle(b))
    if (sort === 'brand') return compareText(textField(a.brand), textField(b.brand))
    if (sort === 'supplier') return compareText(textField(a.supplier), textField(b.supplier))
    return compareText(textField(a.part_number), textField(b.part_number))
  })
  return copy
}

export function dtoolsToPartFields(row: DtoolsProduct): {
  manufacturer: string
  vendor: string
  upc_code: string
  part_name: string
  ipn: string
  description: string
  po: string
  link: string
} {
  return {
    manufacturer: textField(row.brand),
    vendor: textField(row.supplier),
    upc_code: textField(row.upc) || textField(row.ean) || textField(row.itf),
    part_name: dtoolsTitle(row),
    ipn: textField(row.part_number),
    description: textField(row.description) || textField(row.short_description),
    po: '',
    link: textField(row.image_url),
  }
}

export function dtoolsSearchHaystack(row: DtoolsProduct): string {
  return [
    row.brand,
    row.model,
    row.part_number,
    row.short_description,
    row.description,
    row.category,
    row.keywords,
    row.supplier,
    row.upc,
    row.ean,
    row.itf,
    row.item_dtin,
  ]
    .map((v) => (v ?? '').toLowerCase())
    .join(' ')
}
