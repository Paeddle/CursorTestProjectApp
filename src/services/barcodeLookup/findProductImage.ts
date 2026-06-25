import type { ImageProviderAttempt, ProductImageResult, ProductLookupInput } from './types'
import { buildAvImageSearchQueries, buildAvProductSearchQueries, linkMatchesAvSource } from './avSources'
import {
  fetchProductPageDetails,
  isLikelyProductImageUrl,
  pickBestProductImage,
  scoreProductImageUrl,
} from './htmlExtract'
import { extractModelFromTitle } from './productPageExtract'
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

function modelHintFromInput(input: ProductLookupInput): string | null {
  return (
    (input.part_number || '').trim() ||
    extractModelFromTitle(input.item) ||
    extractModelFromTitle(`${input.manufacturer ?? ''} ${input.item ?? ''}`)
  )
}

async function lookupProductPageImage(
  input: ProductLookupInput,
  apiKey: string
): Promise<ProductImageResult | null> {
  const hint = modelHintFromInput(input)
  for (const q of buildAvProductSearchQueries(input)) {
    const organic = await serperWebSearch(q, apiKey, 8)
    const row =
      organic.find((r) => r.link && linkMatchesAvSource(r.link)) ??
      organic.find((r) => /\/product|\/p\/|\/dp\//i.test(r.link ?? '')) ??
      organic[0]
    if (!row?.link) continue

    const details = await fetchProductPageDetails(row.link, hint)
    if (details?.imageUrl && isLikelyProductImageUrl(details.imageUrl)) {
      return {
        imageUrl: details.imageUrl,
        source: 'Product page',
        confidence: 'high',
        productUrl: row.link,
        title: details.cleanTitle ?? details.title,
      }
    }
  }
  return null
}

async function lookupSerperImages(
  input: ProductLookupInput,
  apiKey: string
): Promise<ProductImageResult | null> {
  const hint = modelHintFromInput(input)
  let best: ProductImageResult | null = null
  let bestScore = 0

  for (const q of buildAvImageSearchQueries(input)) {
    const images = await serperImageSearch(q, apiKey, 10)
    for (const img of images) {
      if (!img.imageUrl || !isLikelyProductImageUrl(img.imageUrl)) continue
      const score = scoreProductImageUrl(img.imageUrl, hint)
      if (score <= bestScore) continue
      bestScore = score
      best = {
        imageUrl: img.imageUrl,
        source: 'Image search (Serper)',
        confidence: img.link && linkMatchesAvSource(img.link) ? 'medium' : 'low',
        productUrl: img.link ?? null,
        title: img.title ?? null,
      }
    }
  }
  return best
}

async function lookupUpcItemDbImage(input: ProductLookupInput): Promise<ProductImageResult | null> {
  const hint = modelHintFromInput(input)
  const part = (input.part_number || '').trim()
  const mfr = (input.manufacturer || '').trim()
  const item = (input.item || '').trim()
  const queries = [part, mfr && part ? `${mfr} ${part}` : '', item].filter(Boolean)
  for (const q of queries) {
    const hit = await lookupUpcItemDbSearch(q)
    if (hit?.imageUrl) {
      const imageUrl = pickBestProductImage([hit.imageUrl], hint) ?? hit.imageUrl
      return {
        imageUrl,
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
 * Prioritizes product page scrape, then UPCitemdb, then scored image search.
 */
export async function findProductImageForItem(
  input: ProductLookupInput,
  options?: { skipSerper?: boolean; productUrl?: string | null }
): Promise<{ best: ProductImageResult | null; attempts: ImageProviderAttempt[] }> {
  const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined
  const hasQuery = Boolean(
    (input.part_number || '').trim() || (input.item || '').trim() || (input.manufacturer || '').trim()
  )
  if (!hasQuery && !options?.productUrl) return { best: null, attempts: [] }

  const hint = modelHintFromInput(input)

  if (options?.productUrl) {
    const details = await fetchProductPageDetails(options.productUrl, hint)
    if (details?.imageUrl) {
      return {
        best: {
          imageUrl: details.imageUrl,
          source: 'Product page',
          confidence: 'high',
          productUrl: options.productUrl,
          title: details.cleanTitle ?? details.title,
        },
        attempts: [],
      }
    }
  }

  const attempts = await Promise.all([
    ...(options?.skipSerper || !serperKey
      ? []
      : [
          runImageProvider('product_page', 'Product page scrape', () =>
            lookupProductPageImage(input, serperKey)
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
