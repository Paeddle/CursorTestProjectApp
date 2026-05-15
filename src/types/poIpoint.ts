export interface PoJobRef {
  id: string
  job_name: string
  ref_number: string
  created_at: string
  updated_at: string
}

export interface PoLineItem {
  id: string
  po_number: string
  item_name: string
  job_or_customer: string | null
  po_date: string | null
  quantity: string | null
  source_file: string | null
  imported_at: string
  created_at: string
}

export interface PoItemLocation {
  id: string
  ref_number: string
  location_name: string
  manufacturer: string | null
  product_name: string
  quantity: number | null
  source_file: string | null
  imported_at: string
  created_at: string
}

/** One uploaded location spreadsheet (grouped by ref number in storage). */
export interface LocationFileSummary {
  ref_number: string
  source_file: string | null
  row_count: number
  imported_at: string
  has_job_ref: boolean
}

/** Row ready for label printing (merged iPoint + location data). */
export interface PoLabelPrintRow {
  key: string
  po_number: string
  item_name: string
  job_name: string | null
  location_name: string | null
  barcode_value?: string | null
}
