import type { ImageProviderAttempt, ProductImageResult, ProductLookupInput } from './types'
import { buildAvImageSearchQueries, buildAvProductSearchQueries, linkMatchesAvSource } from './avSources'
import { fetchPageMeta, isLikelyProductImageUrl } from './htmlExtract'
import { lookupUpcItemDbSearch } from './providers'
import { serperImageSearch, serperWebSearch } from './serperClient'

const CONFIDENCE_RANK: Record<ProductImageResult['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

function pickBestImage(hits: ProductImageResult[]): ProductImageResult | null {
  if (hits.length === 0) return null
  return hits.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0]
}

async function runImageProvider(
  id: string,
  label: string,
  fn: () => Promise<ProductImageResult | null>
): Promise<ImageProviderAttempt> {
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

async function lookupAvDistributorImage(
  input: ProductLookupInput,
  apiKey: string
): Promise<ProductImageResult | null> {
  for (const q of buildAvProductSearchQueries(input)) {
    const organic = await serperWebSearch(q, apiKey, 6)
    const row = organic.find((r) => r.link && linkMatchesAvSource(r.link)) ?? organic[0]
    if (!row?.link) continue

    const meta = await fetchPageMeta(row.link, input.part_number)
    if (meta?.imageUrl && isLikelyProductImageUrl(meta.imageUrl)) {
      return {
        imageUrl: meta.imageUrl,
        source: linkMatchesAvSource(row.link) ? 'AV distributor / manufacturer' : 'Web product page',
        confidence: 'high',
        productUrl: row.link,
        title: meta.title,
      }
    }
  }
  return null
}

async function lookupSerperImages(
  input: ProductLookupInput,
  apiKey: string
): Promise<ProductImageResult | null> {
  for (const q of buildAvImageSearchQueries(input)) {
    const images = await serperImageSearch(q, apiKey, 6)
    for (const img of images) {
      if (!img.imageUrl || !isLikelyProductImageUrl(img.imageUrl)) continue
      const confidence: ProductImageResult['confidence'] =
        img.link && linkMatchesAvSource(img.link) ? 'medium' : 'low'
      return {
        imageUrl: img.imageUrl,
        source: 'Image search (Serper)',
        confidence,
        productUrl: img.link ?? null,
        title: img.title ?? null,
      }
    }
  }
  return null
}

async function lookupUpcItemDbImage(input: ProductLookupInput): Promise<ProductImageResult | null> {
  const part = (input.part_number || '').trim()
  const mfr = (input.manufacturer || '').trim()
  const item = (input.item || '').trim()
  const queries = [part, mfr && part ? `${mfr} ${part}` : '', item].filter(Boolean)
  for (const q of queries) {
    const hit = await lookupUpcItemDbSearch(q)
    if (hit?.imageUrl) {
      return {
        imageUrl: hit.imageUrl,
        source: 'UPCitemdb',
        confidence: 'medium',
        productUrl: hit.productUrl,
        title: hit.title,
      }
    }
  }
  return null
}

/**
 * Find a product image for an inventory row (part # / manufacturer / item name).
 * Prioritizes AV distributor pages, then UPCitemdb, then image search.
 */
export async function findProductImageForItem(
  input: ProductLookupInput,
  options?: { skipSerper?: boolean }
): Promise<{ best: ProductImageResult | null; attempts: ImageProviderAttempt[] }> {
  const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined
  const hasQuery = Boolean(
    (input.part_number || '').trim() || (input.item || '').trim() || (input.manufacturer || '').trim()
  )
  if (!hasQuery) return { best: null, attempts: [] }

  const attempts = await Promise.all([
    ...(options?.skipSerper || !serperKey
      ? []
      : [
          runImageProvider('av_pages', 'AV distributor / manufacturer pages', () =>
            lookupAvDistributorImage(input, serperKey)
          ),
        ]),
    runImageProvider('upcitemdb', 'UPCitemdb images', () => lookupUpcItemDbImage(input)),
    ...(options?.skipSerper || !serperKey
      ? []
      : [
          runImageProvider('serper_images', 'Image search (Serper)', () =>
            lookupSerperImages(input, serperKey)
          ),
        ]),
  ])

  const hits = attempts.map((a) => a.hit).filter((h): h is ProductImageResult => h != null)
  return { best: pickBestImage(hits), attempts }
}

export function getImageProviderStatus(): Array<{ id: string; label: string; enabled: boolean; note: string }> {
  const serper = Boolean(import.meta.env.VITE_SERPER_API_KEY)
  return [
    {
      id: 'av_pages',
      label: 'AV distributor pages',
      enabled: serper,
      note: serper
        ? 'ADI, Snap One, B&H, Markertek, and manufacturer sites.'
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
      note: serper ? 'Fallback image search across the web.' : 'Requires VITE_SERPER_API_KEY.',
    },
  ]
}
