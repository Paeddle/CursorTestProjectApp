import type { BarcodeCatalogItem } from '../../types/poCheckin'
import type {
  BarcodeFindResult,
  BarcodeLookupProviderId,
  ImageLookupProviderId,
  ImageProviderAttempt,
  ProductLookupInput,
  ProviderAttempt,
} from './types'
import { enrichLookupInput } from './barcodeExtract'
import {
  lookupCatalogByProduct,
  lookupAvProductByPart,
  lookupMarketplaceSearch,
  lookupSerperProduct,
  lookupFromProductUrl,
  lookupByBarcodeInput,
  lookupRetailerSite,
  lookupUpcItemDbSearch,
} from './providers'
import {
  fetchProductPageDetails,
  isLikelyProductImageUrl,
  scoreProductImageUrl,
} from './htmlExtract'
import { buildAvProductSearchQueries, linkMatchesAvSource } from './avSources'
import { serperImageSearch, serperWebSearch } from './serperClient'
import { extractModelFromTitle } from './productPageExtract'
import type { ProductImageResult } from './types'

const SOURCE_RANK: Record<string, number> = {
  'Product URL': 98,
  'B&H Photo': 96,
  'Best Buy': 94,
  Crutchfield: 92,
  'Samsung.com': 90,
  'AV distributor': 85,
  'AV manufacturer': 75,
  UPCitemdb: 65,
  'Barcode lookup': 88,
  'Web search (Serper)': 45,
  'Your items': 35,
  'Your items (item name)': 30,
}

const CONFIDENCE_RANK: Record<BarcodeFindResult['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

function pickBestBarcode(hits: BarcodeFindResult[]): BarcodeFindResult | null {
  if (hits.length === 0) return null
  return hits.sort((a, b) => {
    const src = (SOURCE_RANK[b.source] ?? 0) - (SOURCE_RANK[a.source] ?? 0)
    if (src !== 0) return src
    const partScore =
      (b.matchedPartNumber?.length ?? 0) - (a.matchedPartNumber?.length ?? 0)
    if (partScore !== 0) return partScore
    return CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
  })[0]
}

async function runBarcodeProvider(
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

function modelHintFromInput(input: ProductLookupInput): string | null {
  return (
    (input.part_number || '').trim() ||
    extractModelFromTitle(input.item) ||
    extractModelFromTitle(`${input.manufacturer ?? ''} ${input.item ?? ''}`)
  )
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

async function lookupProductPageImage(
  input: ProductLookupInput,
  apiKey: string,
  productUrl?: string | null
): Promise<ProductImageResult | null> {
  const hint = modelHintFromInput(input)
  if (productUrl) {
    const details = await fetchProductPageDetails(productUrl, hint)
    if (details?.imageUrl && isLikelyProductImageUrl(details.imageUrl)) {
      return {
        imageUrl: details.imageUrl,
        source: 'Product page',
        confidence: 'high',
        productUrl,
        title: details.cleanTitle ?? details.title,
      }
    }
  }
  if (!apiKey) return null
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

async function lookupUpcItemDbImage(input: ProductLookupInput): Promise<ProductImageResult | null> {
  const part = (input.part_number || '').trim()
  const mfr = (input.manufacturer || '').trim()
  const item = (input.item || '').trim()
  const barcode = (input.barcode || '').replace(/\D/g, '')
  const queries = [barcode, part, mfr && part ? `${mfr} ${part}` : '', item].filter(Boolean)
  for (const q of queries) {
    const hit = await lookupUpcItemDbSearch(q)
    if (hit?.imageUrl && isLikelyProductImageUrl(hit.imageUrl)) {
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

async function lookupSerperImages(
  input: ProductLookupInput,
  apiKey: string
): Promise<ProductImageResult | null> {
  const hint = modelHintFromInput(input)
  if (!hint || hint.length < 4) return null
  const images = await serperImageSearch(
    `${input.manufacturer ? `${input.manufacturer} ` : ''}${hint} product`,
    apiKey,
    10
  )
  for (const img of images) {
    if (img.imageUrl && isLikelyProductImageUrl(img.imageUrl)) {
      return {
        imageUrl: img.imageUrl,
        source: 'Image search (Serper)',
        confidence: img.link && linkMatchesAvSource(img.link) ? 'medium' : 'low',
        productUrl: img.link ?? null,
        title: img.title ?? null,
      }
    }
  }
  return null
}

function imageProvidersForBarcodeChoice(
  providerId: BarcodeLookupProviderId
): ImageLookupProviderId[] {
  if (providerId === 'product_url' || providerId === 'bhphoto' || providerId === 'bestbuy') {
    return ['product_page', 'upcitemdb']
  }
  if (providerId === 'upcitemdb' || providerId === 'barcode') return ['product_page', 'upcitemdb']
  if (providerId === 'serper') return ['product_page', 'serper_images']
  if (providerId === 'catalog') return ['product_page', 'upcitemdb']
  return ['product_page', 'upcitemdb', 'serper_images']
}

function buildProviderList(
  enriched: ProductLookupInput,
  catalog: BarcodeCatalogItem[] | undefined,
  serperKey: string | undefined,
  skipSerper: boolean | undefined
): Array<{ id: BarcodeLookupProviderId; label: string; run: () => Promise<BarcodeFindResult | null> }> {
  const list: Array<{
    id: BarcodeLookupProviderId
    label: string
    run: () => Promise<BarcodeFindResult | null>
  }> = []

  if (enriched.purchase_url?.trim()) {
    list.push({
      id: 'product_url',
      label: 'Product URL on row',
      run: () => lookupFromProductUrl(enriched),
    })
  }
  if (enriched.barcode?.replace(/\D/g, '').length) {
    list.push({
      id: 'barcode',
      label: 'Barcode / UPC lookup',
      run: () => lookupByBarcodeInput(enriched, catalog),
    })
  }
  if (serperKey && !skipSerper) {
    list.push(
      {
        id: 'bhphoto',
        label: 'B&H Photo',
        run: () => lookupRetailerSite(enriched, serperKey, 'bhphotovideo.com', 'B&H Photo'),
      },
      {
        id: 'bestbuy',
        label: 'Best Buy',
        run: () => lookupRetailerSite(enriched, serperKey, 'bestbuy.com', 'Best Buy'),
      },
      {
        id: 'crutchfield',
        label: 'Crutchfield',
        run: () => lookupRetailerSite(enriched, serperKey, 'crutchfield.com', 'Crutchfield'),
      },
      {
        id: 'samsung',
        label: 'Samsung.com',
        run: () => lookupRetailerSite(enriched, serperKey, 'samsung.com', 'Samsung.com'),
      },
      {
        id: 'av_distributor',
        label: 'AV distributors & manufacturers',
        run: () => lookupAvProductByPart(enriched, serperKey),
      }
    )
  }
  list.push({
    id: 'upcitemdb',
    label: 'UPCitemdb',
    run: () => lookupMarketplaceSearch(enriched),
  })
  if (serperKey && !skipSerper) {
    list.push({
      id: 'serper',
      label: 'Web search (Serper)',
      run: () => lookupSerperProduct(enriched, serperKey),
    })
  }
  list.push({
    id: 'catalog',
    label: 'Your items',
    run: () => lookupCatalogByProduct(enriched, catalog),
  })
  return list
}

export async function findBarcodeForItem(
  input: ProductLookupInput,
  options?: {
    catalog?: BarcodeCatalogItem[]
    skipSerper?: boolean
    providerId?: BarcodeLookupProviderId
  }
): Promise<{ best: BarcodeFindResult | null; attempts: ProviderAttempt[] }> {
  const enriched = enrichLookupInput(input)
  const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined
  const providerId = options?.providerId ?? 'auto'

  const allProviders = buildProviderList(enriched, options?.catalog, serperKey, options?.skipSerper)

  const selected =
    providerId === 'auto' ? allProviders : allProviders.filter((p) => p.id === providerId)

  const attempts = await Promise.all(
    selected.map((p) => runBarcodeProvider(p.id, p.label, p.run))
  )

  const hits = attempts.map((a) => a.hit).filter((h): h is BarcodeFindResult => h != null)
  const best = providerId === 'auto' ? pickBestBarcode(hits) : attempts.find((a) => a.hit)?.hit ?? null
  return { best, attempts }
}

export async function findProductImageForItem(
  input: ProductLookupInput,
  options?: {
    skipSerper?: boolean
    productUrl?: string | null
    providerId?: BarcodeLookupProviderId
    imageProviderId?: ImageLookupProviderId
    forceReplace?: boolean
    existingPictureUrl?: string | null
  }
): Promise<{ best: ProductImageResult | null; attempts: ImageProviderAttempt[] }> {
  const enriched = enrichLookupInput(input)
  const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined
  const hasQuery = Boolean(
    (enriched.part_number || '').trim() ||
      (enriched.item || '').trim() ||
      (enriched.manufacturer || '').trim() ||
      (enriched.barcode || '').trim()
  )
  if (!hasQuery && !options?.productUrl) return { best: null, attempts: [] }

  const imageProviderId = options?.imageProviderId ?? 'auto'
  const barcodeProviderId = options?.providerId ?? 'auto'
  const providerIds =
    imageProviderId === 'auto'
      ? imageProvidersForBarcodeChoice(barcodeProviderId)
      : [imageProviderId]

  const runners: Array<{ id: string; label: string; run: () => Promise<ProductImageResult | null> }> = []
  const productUrl = options?.productUrl ?? enriched.purchase_url
  if (providerIds.includes('product_page') && (serperKey || productUrl) && !options?.skipSerper) {
    runners.push({
      id: 'product_page',
      label: 'Product page scrape',
      run: () => lookupProductPageImage(enriched, serperKey ?? '', productUrl),
    })
  }
  if (providerIds.includes('upcitemdb')) {
    runners.push({
      id: 'upcitemdb',
      label: 'UPCitemdb images',
      run: () => lookupUpcItemDbImage(enriched),
    })
  }
  if (providerIds.includes('serper_images') && serperKey && !options?.skipSerper) {
    runners.push({
      id: 'serper_images',
      label: 'Image search (Serper)',
      run: () => lookupSerperImages(enriched, serperKey),
    })
  }

  const attempts = await Promise.all(runners.map((r) => runImageProvider(r.id, r.label, r.run)))
  const hint = modelHintFromInput(enriched)
  const existingScore = scoreProductImageUrl(options?.existingPictureUrl ?? '', hint)
  const hits = attempts
    .map((a) => a.hit)
    .filter((h): h is ProductImageResult => {
      if (!h) return false
      if (!options?.forceReplace) return true
      return scoreProductImageUrl(h.imageUrl, hint) >= existingScore
    })

  if (hits.length === 0) return { best: null, attempts }

  const CONFIDENCE_RANK: Record<ProductImageResult['confidence'], number> = {
    high: 3,
    medium: 2,
    low: 1,
  }
  const best = hits.sort((a, b) => {
    const scoreDiff =
      scoreProductImageUrl(b.imageUrl, hint) - scoreProductImageUrl(a.imageUrl, hint)
    if (scoreDiff !== 0) return scoreDiff
    return CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
  })[0]
  return { best, attempts }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
