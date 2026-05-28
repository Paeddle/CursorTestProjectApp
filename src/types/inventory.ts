import type { InventoryRow } from './purchaseList'

export type InventoryRecord = InventoryRow & {
  id: string
  uploaded_at: string
  created_at: string
  barcode_lookup_source: string | null
  barcode_lookup_at: string | null
}

export type InventoryBarcodeFilter = 'all' | 'missing' | 'has_barcode'

export type BarcodeLookupHit = {
  barcode: string
  source: string
  confidence: 'high' | 'medium' | 'low'
  title: string | null
  matchedPartNumber: string | null
  productUrl: string | null
}

export type BarcodeProviderStatus = {
  id: string
  label: string
  enabled: boolean
  note: string
}
