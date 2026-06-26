import type { BarcodeProviderStatus } from '../../types/items'
export { findBarcodeForItem, findProductImageForItem, sleep } from './lookupProviders'

export function getBarcodeProviderStatus(): BarcodeProviderStatus[] {
  const serper = Boolean(import.meta.env.VITE_SERPER_API_KEY)
  const upcKey = Boolean(import.meta.env.VITE_UPCITEMDB_USER_KEY)
  return [
    {
      id: 'product_url',
      label: 'Product URL on row',
      enabled: true,
      note: 'Scrapes the purchase URL saved on the item (B&H, Best Buy, etc.).',
    },
    {
      id: 'barcode',
      label: 'Barcode / UPC lookup',
      enabled: true,
      note: 'Reverse lookup when the row already has a UPC/EAN barcode.',
    },
    {
      id: 'bhphoto',
      label: 'B&H Photo',
      enabled: serper,
      note: serper ? 'Searches bhphotovideo.com for model, UPC, and product image.' : 'Requires VITE_SERPER_API_KEY.',
    },
    {
      id: 'bestbuy',
      label: 'Best Buy',
      enabled: serper,
      note: serper ? 'Searches bestbuy.com for retail product data.' : 'Requires VITE_SERPER_API_KEY.',
    },
    {
      id: 'crutchfield',
      label: 'Crutchfield',
      enabled: serper,
      note: serper ? 'Searches crutchfield.com for consumer electronics.' : 'Requires VITE_SERPER_API_KEY.',
    },
    {
      id: 'samsung',
      label: 'Samsung.com',
      enabled: serper,
      note: serper ? 'Searches samsung.com for TVs and appliances.' : 'Requires VITE_SERPER_API_KEY.',
    },
    {
      id: 'av_distributor',
      label: 'AV distributors & manufacturers',
      enabled: serper,
      note: serper
        ? 'ADI, Snap One, B&H, Markertek, Lutron, Crestron, and similar pro-AV sources.'
        : 'Add VITE_SERPER_API_KEY for AV distributor lookups.',
    },
    {
      id: 'upcitemdb',
      label: 'UPCitemdb',
      enabled: true,
      note: upcKey
        ? 'Using your API user key (higher limits).'
        : 'Trial API (~100 searches/day). Add VITE_UPCITEMDB_USER_KEY for more.',
    },
    {
      id: 'serper',
      label: 'Web search (Serper)',
      enabled: serper,
      note: serper
        ? 'Extracts UPC/EAN from pro-AV web results when distributor pages lack a code.'
        : 'Add VITE_SERPER_API_KEY in .env for web search lookups.',
    },
    {
      id: 'catalog',
      label: 'Your items (local)',
      enabled: true,
      note: 'Matches part number or item name from other rows in your database.',
    },
  ]
}
