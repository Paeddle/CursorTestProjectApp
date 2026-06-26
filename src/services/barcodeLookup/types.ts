export type BarcodeLookupProviderId =
  | 'auto'
  | 'catalog'
  | 'av_distributor'
  | 'bhphoto'
  | 'bestbuy'
  | 'crutchfield'
  | 'samsung'
  | 'barcode'
  | 'product_url'
  | 'upcitemdb'
  | 'serper'

export type ImageLookupProviderId = 'product_page' | 'upcitemdb' | 'serper_images' | 'auto'

export const BARCODE_LOOKUP_PROVIDER_OPTIONS: Array<{
  id: BarcodeLookupProviderId
  label: string
}> = [
  { id: 'auto', label: 'Auto (best match)' },
  { id: 'product_url', label: 'Product URL on row' },
  { id: 'barcode', label: 'Barcode / UPC lookup' },
  { id: 'bhphoto', label: 'B&H Photo' },
  { id: 'bestbuy', label: 'Best Buy' },
  { id: 'crutchfield', label: 'Crutchfield' },
  { id: 'samsung', label: 'Samsung.com' },
  { id: 'av_distributor', label: 'AV distributors (ADI, Snap One…)' },
  { id: 'upcitemdb', label: 'UPCitemdb' },
  { id: 'serper', label: 'Web search (Serper)' },
  { id: 'catalog', label: 'Your items (local)' },
]

export type ProductLookupInput = {
  part_number?: string | null
  manufacturer?: string | null
  item?: string | null
  description?: string | null
  barcode?: string | null
  purchase_url?: string | null
}

export type BarcodeFindResult = {
  barcode: string
  source: string
  confidence: 'high' | 'medium' | 'low'
  title: string | null
  matchedPartNumber: string | null
  manufacturer: string | null
  productUrl: string | null
  imageUrl: string | null
}

export type ProductLookupResult = {
  barcode: string
  name: string | null
  partNumber: string | null
  manufacturer: string | null
  imageUrl: string | null
  sourceUrl: string | null
  sourceLabel: string
  confidence: 'high' | 'medium' | 'low'
}

export type ProductImageResult = {
  imageUrl: string
  source: string
  confidence: 'high' | 'medium' | 'low'
  productUrl: string | null
  title: string | null
}

export type ProviderAttempt = {
  providerId: string
  label: string
  hit: BarcodeFindResult | null
  error: string | null
  durationMs: number
}

export type ImageProviderAttempt = {
  providerId: string
  label: string
  hit: ProductImageResult | null
  error: string | null
  durationMs: number
}
