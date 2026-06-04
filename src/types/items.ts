import type { ItemRow } from './purchaseList'

export type ItemRecord = ItemRow & {
  id: string
  uploaded_at: string
  created_at: string
  updated_at?: string | null
  notes?: string | null
  barcode_lookup_source: string | null
  barcode_lookup_at: string | null
}

export type ItemBarcodeFilter = 'all' | 'missing' | 'has_barcode'

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
