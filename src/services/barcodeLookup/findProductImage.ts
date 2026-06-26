export { findProductImageForItem } from './lookupProviders'

export function getImageProviderStatus(): Array<{ id: string; label: string; enabled: boolean; note: string }> {
  const serper = Boolean(import.meta.env.VITE_SERPER_API_KEY)
  return [
    {
      id: 'product_page',
      label: 'Product page scrape',
      enabled: serper,
      note: serper
        ? 'Extracts images from the retailer product page (B&H, Best Buy, etc.).'
        : 'Requires VITE_SERPER_API_KEY.',
    },
    {
      id: 'upcitemdb',
      label: 'UPCitemdb',
      enabled: true,
      note: 'Product photos when a retail UPC exists.',
    },
    {
      id: 'serper_images',
      label: 'Google image search (Serper)',
      enabled: serper,
      note: serper ? 'Fallback only — scored against model number.' : 'Requires VITE_SERPER_API_KEY.',
    },
  ]
}
