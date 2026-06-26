import type { BarcodeProviderStatus } from '../../types/items'
export { findBarcodeForItem, sleep } from './lookupProviders'

export function getBarcodeProviderStatus(): BarcodeProviderStatus[] {
  const serper = Boolean(import.meta.env.VITE_SERPER_API_KEY)
  const upcKey = Boolean(import.meta.env.VITE_UPCITEMDB_USER_KEY)
  return [
    {
      id: 'catalog',
      label: 'Your items',
      enabled: true,
      note: 'Matches part number or item name from saved items.',
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
  ]
}
