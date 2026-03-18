export interface POBarcode {
  id: string
  po_number: string
  barcode_value: string
  scanned_at: string
  created_at: string
}

export interface PODocument {
  id: string
  po_number: string
  file_url: string
  document_type: string
  name: string | null
  scanned_at: string
  created_at: string
}

export interface POCheckinSummary {
  po_number: string
  barcodes: POBarcode[]
  documents: PODocument[]
}
