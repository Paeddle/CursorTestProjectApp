export interface PurchaseListBatch {
  id: string
  source_filename: string | null
  created_at: string
}

export interface PurchaseListItemRow {
  batch_id: string
  vendor: string | null
  /** Same as PDF blue/teal manufacturer row (Purchase Manager). */
  manufacturer: string | null
  job: string | null
  part: string
  required: number
  received: number | null
  ordered: number | null
  cost: string | null
  context_line: string | null
  raw_line: string | null
  /** 0-based index within the PDF parse sequence for this batch. */
  parse_order?: number
}

export interface InventoryRow {
  manufacturer: string | null
  category: string | null
  type: string | null
  item: string | null
  part_number: string | null
  description_customer: string | null
  unit: string | null
  color: string | null
  unit_hard_cost: number | null
  unit_price: number | null
  margin: number | null
  markup: number | null
  id_class: string | null
  vendor_name: string | null
  barcode: string | null
  stock_total: number | null
  stock_available: number | null
  stock_on_order: number | null
}

export interface PullSuggestion {
  part: string
  required: number
  job: string | null
  vendor: string | null
  manufacturer: string | null
  stock_available: number | null
  can_pull: number
  match_type: 'part_number' | 'item' | 'none'
  inventory_part_number: string | null
}
