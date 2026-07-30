export type InventreePartRecord = {
  id: string
  inventree_id: number
  name: string
  ipn: string | null
  category_name: string | null
  link: string | null
  maximum_stock: number | null
  active: boolean
  barcode_hash: string | null
  creation_date: string | null
}

export type ReorderRequestInput = {
  item_id: string | null
  part_number: string | null
  item_name: string | null
  manufacturer: string | null
  vendor_name: string | null
  barcode: string | null
  description: string | null
  stock_available: number | null
  quantity: number
  job: string | null
  requested_by: string | null
  notes: string | null
}
