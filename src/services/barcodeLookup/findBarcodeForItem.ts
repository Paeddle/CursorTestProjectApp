import type { BarcodeCatalogItem } from '../../types/poCheckin'
import type { BarcodeProviderStatus } from '../../types/items'
import type { BarcodeFindResult, ProductLookupInput, ProviderAttempt } from './types'
import {
  lookupCatalogByProduct,
  lookupMarketplaceSearch,
  lookupSerperProduct,
} from './providers'

const CONFIDENCE_RANK: Record<BarcodeFindResult['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

function pickBest(hits: BarcodeFindResult[]): BarcodeFindResult | null {
  if (hits.length === 0) return null
  return hits.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0]
}

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
      id: 'upcitemdb',
      label: 'UPCitemdb',
      enabled: true,
      note: upcKey
        ? 'Using your API user key (higher limits).'
        : 'Trial API (~100 searches/day). Add VITE_UPCITEMDB_USER_KEY for more.',
    },
    {
      id: 'openfoodfacts',
      label: 'Open Food Facts',
      enabled: true,
      note: 'Free product search; best for consumer packaged goods.',
    },
    {
      id: 'serper',
      label: 'Google search (Serper)',
      enabled: serper,
      note: serper
        ? 'Searches the web and extracts UPC/EAN from results — good for ADI/Lutron/low-voltage SKUs.'
        : 'Add VITE_SERPER_API_KEY in .env for web search lookups.',
    },
  ]
}

async function runProvider(
  id: string,
  label: string,
  fn: () => Promise<BarcodeFindResult | null>
): Promise<ProviderAttempt> {
  const start = performance.now()
  try {
    const hit = await fn()
    return {
      providerId: id,
      label,
      hit,
      error: null,
      durationMs: Math.round(performance.now() - start),
    }
  } catch (e) {
    return {
      providerId: id,
      label,
      hit: null,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Math.round(performance.now() - start),
    }
  }
}

/**
 * Find a barcode for an inventory row (part # / item / manufacturer).
 * Queries multiple sources and returns the best-confidence match.
 */
export async function findBarcodeForItem(
  input: ProductLookupInput,
  options?: { catalog?: BarcodeCatalogItem[]; skipSerper?: boolean }
): Promise<{ best: BarcodeFindResult | null; attempts: ProviderAttempt[] }> {
  const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined

  const attempts = await Promise.all([
    runProvider('catalog', 'Barcode catalog', () => lookupCatalogByProduct(input, options?.catalog)),
    runProvider('marketplace', 'UPCitemdb + Open Food Facts', () => lookupMarketplaceSearch(input)),
    ...(options?.skipSerper || !serperKey
      ? []
      : [
          runProvider('serper', 'Web search (Serper)', () =>
            lookupSerperProduct(input, serperKey)
          ),
        ]),
  ])

  const hits = attempts.map((a) => a.hit).filter((h): h is BarcodeFindResult => h != null)
  return { best: pickBest(hits), attempts }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
