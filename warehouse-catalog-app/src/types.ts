export interface WarehouseCatalogItem {
  id: string
  part_number: string | null
  name: string | null
  upc_code: string | null
  alt_upc_code: string | null
  vendor: string | null
  manufacturer: string | null
  category: string | null
  maximum_stock: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type WarehouseCatalogForm = {
  part_number: string
  name: string
  upc_code: string
  alt_upc_code: string
  vendor: string
  manufacturer: string
  category: string
  maximum_stock: string
  notes: string
}

export const emptyForm = (): WarehouseCatalogForm => ({
  part_number: '',
  name: '',
  upc_code: '',
  alt_upc_code: '',
  vendor: '',
  manufacturer: '',
  category: '',
  maximum_stock: '',
  notes: '',
})

export function formFromItem(item: WarehouseCatalogItem): WarehouseCatalogForm {
  return {
    part_number: item.part_number ?? '',
    name: item.name ?? '',
    upc_code: item.upc_code ?? '',
    alt_upc_code: item.alt_upc_code ?? '',
    vendor: item.vendor ?? '',
    manufacturer: item.manufacturer ?? '',
    category: item.category ?? '',
    maximum_stock:
      item.maximum_stock != null && !Number.isNaN(item.maximum_stock)
        ? String(item.maximum_stock)
        : '',
    notes: item.notes ?? '',
  }
}
