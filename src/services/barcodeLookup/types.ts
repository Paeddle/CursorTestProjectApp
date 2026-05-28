export type ProductLookupInput = {
  part_number?: string | null
  manufacturer?: string | null
  item?: string | null
  description?: string | null
}

export type BarcodeFindResult = {
  barcode: string
  source: string
  confidence: 'high' | 'medium' | 'low'
  title: string | null
  matchedPartNumber: string | null
  productUrl: string | null
}

export type ProviderAttempt = {
  providerId: string
  label: string
  hit: BarcodeFindResult | null
  error: string | null
  durationMs: number
}
