export type ItemRecord = {
  id: string
  manufacturer: string | null
  item: string | null
  part_number: string | null
  description_customer: string | null
  vendor_name: string | null
  barcode: string | null
  stock_available: number | null
  picture_url: string | null
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
