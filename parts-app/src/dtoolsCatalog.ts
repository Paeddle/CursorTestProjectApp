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
