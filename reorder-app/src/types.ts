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
  ipn: string | null
  name: string | null
  category_name: string | null
  vendor_name: string | null
  barcode_hash: string | null
  link: string | null
  quantity: number
  job: string | null
  requested_by: string | null
  notes: string | null
}

export type ReorderRequestRecord = {
  id: string
  item_id: string | null
  ipn: string | null
  name: string | null
  category_name: string | null
  vendor_name: string | null
  barcode_hash: string | null
  link: string | null
  quantity: number
  job: string | null
  requested_by: string | null
  notes: string | null
  status: 'pending' | 'ordered' | 'received' | 'cancelled'
  ordered_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
}

export type ReorderRequestStatus = ReorderRequestRecord['status']
