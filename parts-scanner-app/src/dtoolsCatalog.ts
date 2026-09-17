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
