import { fetchItemsAsCatalog } from '../itemsService'
import { normalizePartKey, extractBarcodesFromText, buildSearchQueries, enrichLookupInput } from './barcodeExtract'
import {
  buildAvBarcodeSearchQueries,
  buildAvProductSearchQueries,
  linkMatchesAvDistributor,
  linkMatchesAvSource,
} from './avSources'
import { fetchProductPageDetails, isLikelyProductImageUrl, pickBestProductImage, scoreProductImageUrl } from './htmlExtract'
import {
  extractModelFromTitle,
  extractModelFromUpcTitle,
  extractModelFromUrl,
  cleanProductTitle,
  MIN_PRODUCT_IMAGE_SCORE,
} from './productPageExtract'
import { invokeProductLookup, safeFetchJson } from './lookupProxy'
import { serperWebSearch } from './serperClient'
import type { BarcodeFindResult, ProductLookupInput, ProductLookupResult } from './types'
import type { BarcodeCatalogItem } from '../../types/poCheckin'

function validBarcode(digits: string): boolean {
  return digits.length === 8 || digits.length === 12 || digits.length === 13
}

function resultFromBarcode(
  barcode: string,
  source: string,
  confidence: BarcodeFindResult['confidence'],
  title: string | null,
  matchedPartNumber: string | null,
  productUrl: string | null,
  imageUrl: string | null = null
): BarcodeFindResult | null {
  const digits = barcode.replace(/\D/g, '')
  if (!validBarcode(digits)) return null
  return {
    barcode: digits,
    source,
    confidence,
    title,
    matchedPartNumber,
    productUrl,
    imageUrl,
  }
}

function catalogToFindResult(c: BarcodeCatalogItem, source: string, confidence: BarcodeFindResult['confidence']): BarcodeFindResult | null {
  return resultFromBarcode(
    c.barcode_value,
    source,
    confidence,
    c.item_name,
    c.part_number ?? null,
    c.product_url ?? null,
    c.image_url ?? null
  )
}

/** Local items table — match by part number or item name. */
export async function lookupCatalogByProduct(
  input: ProductLookupInput,
  catalog?: BarcodeCatalogItem[]
): Promise<BarcodeFindResult | null> {
  let rows = catalog
  if (!rows) {
    rows = await fetchItemsAsCatalog()
  }

  const enriched = enrichLookupInput(input)
  const partKey = normalizePartKey(enriched.part_number || '')
  if (partKey) {
    const exact = rows.find((r) => normalizePartKey(r.part_number || '') === partKey)
    if (exact?.barcode_value) {
      return catalogToFindResult(exact, 'Your items', 'high')
    }
    const partial = rows.find((r) => {
      const pk = normalizePartKey(r.part_number || '')
      return pk && pk.length >= 5 && (pk.includes(partKey) || partKey.includes(pk))
    })
    if (partial?.barcode_value) {
      return catalogToFindResult(partial, 'Your items', 'medium')
    }
  }

  const itemKey = normalizePartKey(input.item || '')
  if (itemKey.length >= 4) {
    const hit = rows.find((r) => {
      const ik = normalizePartKey(r.item_name || '')
      return ik === itemKey || ik.includes(itemKey) || itemKey.includes(ik)
    })
    if (hit?.barcode_value) {
      return catalogToFindResult(hit, 'Your items (item name)', 'medium')
    }
  }

  return null
}

/** UPCitemdb trial search — works for many AV SKUs with retail barcodes. */
export async function lookupUpcItemDbSearch(query: string): Promise<BarcodeFindResult | null> {
  const q = query.trim()
  if (!q) return null
  const userKey = import.meta.env.VITE_UPCITEMDB_USER_KEY as string | undefined

  type UpcResponse = {
    items?: Array<{
      ean?: string
      upc?: string
      title?: string
      brand?: string
      images?: string[]
      offers?: Array<{ merchant?: string; link?: string }>
    }>
  }

  const data =
    (await invokeProductLookup<UpcResponse>('upc_search', { query: q })) ??
    (await safeFetchJson<UpcResponse>(
      userKey
        ? `https://api.upcitemdb.com/prod/v1/search?s=${encodeURIComponent(q)}`
        : `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(q)}`,
      {
        headers: {
          Accept: 'application/json',
          ...(userKey ? { user_key: userKey } : {}),
        },
      }
    ))

  const item = data?.items?.[0]
  if (!item) return null
  const code = (item.ean || item.upc || '').replace(/\D/g, '')
  if (!validBarcode(code)) return null
  const title = item.title || item.brand || null
  const partNumber = extractModelFromUpcTitle(item.title ?? null, item.brand ?? null)
  const imageUrl =
    pickBestProductImage(item.images ?? [], partNumber) ??
    item.images?.find((u) => isLikelyProductImageUrl(u)) ??
    null
  const productUrl = item.offers?.[0]?.link ?? null
  return resultFromBarcode(code, 'UPCitemdb', 'medium', title, partNumber, productUrl, imageUrl)
}

/** UPCitemdb — lookup when barcode is already known. */
export async function lookupUpcItemDbByBarcode(barcode: string): Promise<BarcodeFindResult | null> {
  const code = barcode.replace(/\D/g, '')
  if (!validBarcode(code)) return null
  const userKey = import.meta.env.VITE_UPCITEMDB_USER_KEY as string | undefined

  type UpcResponse = {
    items?: Array<{
      ean?: string
      upc?: string
      title?: string
      brand?: string
      images?: string[]
      offers?: Array<{ link?: string }>
    }>
  }

  const data =
    (await invokeProductLookup<UpcResponse>('upc_lookup', { barcode: code })) ??
    (await safeFetchJson<UpcResponse>(
      userKey
        ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(code)}`
        : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
      {
        headers: {
          Accept: 'application/json',
          ...(userKey ? { user_key: userKey } : {}),
        },
      }
    ))

  const item = data?.items?.[0]
  if (!item) return null
  const title = item.title || item.brand || null
  const partNumber = extractModelFromUpcTitle(item.title ?? null, item.brand ?? null)
  const imageUrl =
    pickBestProductImage(item.images ?? [], partNumber) ??
    item.images?.find((u) => isLikelyProductImageUrl(u)) ??
    null
  const productUrl = item.offers?.[0]?.link ?? null
  return resultFromBarcode(code, 'UPCitemdb', 'high', title, partNumber, productUrl, imageUrl)
}

async function scoreOrganicProductResult(
  row: { title?: string; snippet?: string; link?: string },
  barcode: string
): Promise<number> {
  const link = (row.link ?? '').toLowerCase()
  const blob = `${row.title ?? ''} ${row.snippet ?? ''}`.toLowerCase()
  let score = 0
  if (linkMatchesAvDistributor(link)) score += 40
  else if (linkMatchesAvSource(link)) score += 30
  if (/\/product|\/p\/|\/dp\/|\/sku\/|item=/i.test(link)) score += 25
  if (blob.includes(barcode.replace(/\D/g, ''))) score += 20
  if (/bestbuy|bhphoto|amazon|samsung|sony|lg\.com|crutchfield/i.test(link)) score += 15
  if (/support\.|manual|pdf|warranty|forum/i.test(link)) score -= 30
  return score
}

async function pickBestOrganicResult(
  organic: Array<{ title?: string; snippet?: string; link?: string }>,
  barcode: string
): Promise<{ link: string; title?: string } | null> {
  const ranked = await Promise.all(
    organic
      .filter((r) => r.link?.startsWith('http'))
      .map(async (r) => ({ r, score: await scoreOrganicProductResult(r, barcode) }))
  )
  ranked.sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best || best.score < 5) return null
  return { link: best.r.link!, title: best.r.title }
}

async function pickAvOrganicResult(
  organic: Array<{ title?: string; snippet?: string; link?: string }>,
  preferDistributor = true,
  barcode = ''
): Promise<{ link: string; title?: string } | null> {
  if (barcode) {
    const best = await pickBestOrganicResult(organic, barcode)
    if (best) return best
  }
  const pick = (fn: (url: string) => boolean) =>
    organic.find((r) => r.link && fn(r.link)) ?? null

  if (preferDistributor) {
    const dist = pick(linkMatchesAvDistributor)
    if (dist?.link) return { link: dist.link, title: dist.title }
  }
  const av = pick(linkMatchesAvSource)
  if (av?.link) return { link: av.link, title: av.title }
  const any = organic.find((r) => r.link?.startsWith('http'))
  if (any?.link) return { link: any.link, title: any.title }
  return null
}

function mergePageDetails(
  chosen: { link: string; title?: string },
  details: Awaited<ReturnType<typeof fetchProductPageDetails>>,
  upcTitle: string | null,
  upcBrand: string | null
) {
  const title = details?.cleanTitle ?? details?.title ?? chosen.title ?? upcTitle
  const partNumber =
    details?.partNumber ??
    extractModelFromUrl(chosen.link) ??
    extractModelFromUpcTitle(upcTitle, upcBrand) ??
    extractModelFromTitle(title)
  const manufacturer = details?.manufacturer ?? upcBrand ?? null
  const imageUrl =
    details?.imageUrl && isLikelyProductImageUrl(details.imageUrl) ? details.imageUrl : null
  return { title, partNumber, manufacturer, imageUrl }
}

function barcodeFindToProductLookup(hit: BarcodeFindResult): ProductLookupResult {
  return {
    barcode: hit.barcode,
    name: hit.title,
    partNumber: hit.matchedPartNumber,
    manufacturer: null,
    imageUrl: hit.imageUrl,
    sourceUrl: hit.productUrl,
    sourceLabel: hit.source,
    confidence: hit.confidence,
  }
}

function pickBetterImage(
  a: string | null | undefined,
  b: string | null | undefined,
  hint: string | null
): string | null {
  const scoreA = a ? scoreProductImageUrl(a, hint) : -100
  const scoreB = b ? scoreProductImageUrl(b, hint) : -100
  const best = scoreB > scoreA ? b : a
  const bestScore = Math.max(scoreA, scoreB)
  return best && bestScore >= MIN_PRODUCT_IMAGE_SCORE ? best : null
}

function mergeBarcodeLookupResults(
  upc: ProductLookupResult | null,
  av: ProductLookupResult | null
): ProductLookupResult | null {
  if (!upc && !av) return null
  if (!upc) return av
  if (!av) return upc

  const partNumber =
    av.partNumber ??
    upc.partNumber ??
    extractModelFromUrl(av.sourceUrl ?? '') ??
    extractModelFromUrl(upc.sourceUrl ?? '') ??
    null
  const hint = partNumber ?? extractModelFromTitle(av.name ?? upc.name ?? null)
  const imageUrl = pickBetterImage(upc.imageUrl, av.imageUrl, hint)
  const preferAvMeta = Boolean(
    av.partNumber || linkMatchesAvDistributor(av.sourceUrl ?? '') || (imageUrl && imageUrl === av.imageUrl)
  )

  return {
    barcode: upc.barcode || av.barcode,
    name: cleanProductTitle(av.name ?? upc.name ?? null) ?? upc.name ?? av.name,
    partNumber,
    manufacturer: av.manufacturer ?? upc.manufacturer,
    imageUrl,
    sourceUrl: preferAvMeta ? av.sourceUrl ?? upc.sourceUrl : upc.sourceUrl ?? av.sourceUrl,
    sourceLabel: preferAvMeta ? av.sourceLabel : upc.sourceLabel,
    confidence:
      av.confidence === 'high' || linkMatchesAvDistributor(av.sourceUrl ?? '') ? 'high' : upc.confidence,
  }
}

/** AV distributor / manufacturer pages — barcode → product info. */
export async function lookupAvProductByBarcode(
  barcode: string,
  apiKey: string | undefined
): Promise<ProductLookupResult | null> {
  if (!apiKey) return null
  const code = barcode.replace(/\D/g, '')
  if (!code) return null

  for (const q of buildAvBarcodeSearchQueries(code)) {
    const organic = await serperWebSearch(q, apiKey, 10)
    const chosen = await pickAvOrganicResult(organic, true, code)
    if (!chosen) continue

    const details = await fetchProductPageDetails(chosen.link, null)
    const merged = mergePageDetails(chosen, details, null, null)
    const sourceLabel = linkMatchesAvDistributor(chosen.link) ? 'AV distributor' : 'Product page'

    return {
      barcode: code,
      name: merged.title ? cleanProductTitle(merged.title) : null,
      partNumber: merged.partNumber ?? extractModelFromUrl(chosen.link),
      manufacturer: merged.manufacturer,
      imageUrl: merged.imageUrl,
      sourceUrl: chosen.link,
      sourceLabel,
      confidence: linkMatchesAvDistributor(chosen.link) ? 'high' : 'medium',
    }
  }

  return null
}

/** AV distributor / manufacturer pages — part number → barcode + product info. */
export async function lookupAvProductByPart(
  input: ProductLookupInput,
  apiKey: string | undefined
): Promise<BarcodeFindResult | null> {
  if (!apiKey) return null
  const enriched = enrichLookupInput(input)
  const part = (enriched.part_number || '').trim()
  if (!part) return null

  for (const q of buildAvProductSearchQueries(enriched)) {
    const organic = await serperWebSearch(q, apiKey, 8)
    const chosen = await pickAvOrganicResult(organic, true)
    if (!chosen) continue

    const blob = `${chosen.title ?? ''} ${organic.find((r) => r.link === chosen.link)?.snippet ?? ''}`
    const codes = extractBarcodesFromText(blob)
    const meta = await fetchProductPageDetails(chosen.link, part)
    const pageCodes = meta ? extractBarcodesFromText(`${meta.title ?? ''}`) : []
    const allCodes = [...new Set([...codes, ...pageCodes])]

    const imageUrl = meta?.imageUrl && isLikelyProductImageUrl(meta.imageUrl) ? meta.imageUrl : null
    const title = meta?.cleanTitle ?? meta?.title ?? chosen.title ?? null
    const source = linkMatchesAvDistributor(chosen.link) ? 'AV distributor' : 'AV manufacturer'
    const confidence: BarcodeFindResult['confidence'] = linkMatchesAvDistributor(chosen.link)
      ? 'high'
      : 'medium'

    if (allCodes.length > 0) {
      return resultFromBarcode(
        allCodes[0],
        source,
        confidence,
        title,
        meta?.partNumber ?? part,
        chosen.link,
        imageUrl
      )
    }

    // Page found but no barcode on listing — still useful for image/title via image search path
    if (imageUrl || title) {
      const digits = part.replace(/\D/g, '')
      if (validBarcode(digits)) {
        return resultFromBarcode(digits, source, 'low', title, part, chosen.link, imageUrl)
      }
    }
  }

  return null
}

/** Serper — extract UPC from AV-focused web results. */
export async function lookupSerperForBarcode(
  query: string,
  apiKey: string
): Promise<BarcodeFindResult | null> {
  const q = query.trim()
  if (!q || !apiKey) return null
  const organic = await serperWebSearch(`${q} UPC EAN barcode pro AV`, apiKey, 8)
  for (const row of organic) {
    const blob = `${row.title ?? ''} ${row.snippet ?? ''}`
    const codes = extractBarcodesFromText(blob)
    if (codes.length > 0) {
      const confidence: BarcodeFindResult['confidence'] = row.link && linkMatchesAvSource(row.link)
        ? 'medium'
        : 'low'
      return resultFromBarcode(
        codes[0],
        'Web search (Serper)',
        confidence,
        row.title ?? null,
        null,
        row.link ?? null,
        null
      )
    }
  }
  return null
}

/** UPCitemdb for each search query until one hits. */
export async function lookupMarketplaceSearch(
  input: ProductLookupInput
): Promise<BarcodeFindResult | null> {
  const queries = buildSearchQueries(input)
  for (const q of queries) {
    const upc = await lookupUpcItemDbSearch(q)
    if (upc) return upc
  }
  return null
}

export async function lookupSerperProduct(
  input: ProductLookupInput,
  apiKey: string | undefined
): Promise<BarcodeFindResult | null> {
  if (!apiKey) return null
  const queries = buildSearchQueries(input)
  for (const q of queries) {
    const hit = await lookupSerperForBarcode(q, apiKey)
    if (hit) return hit
  }
  return null
}

/** Reverse lookup: barcode → product details (for scan modal). */
export async function lookupProductByBarcode(
  barcode: string,
  options?: { catalog?: BarcodeCatalogItem[] }
): Promise<ProductLookupResult | null> {
  const code = barcode.replace(/\D/g, '')
  const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined

  let catalog = options?.catalog
  if (!catalog) {
    try {
      catalog = await fetchItemsAsCatalog()
    } catch {
      catalog = []
    }
  }

  const catalogHit = catalog.find(
    (c) => c.barcode_value.replace(/\D/g, '') === code || c.barcode_value === barcode
  )
  if (catalogHit) {
    return {
      barcode: catalogHit.barcode_value.replace(/\D/g, '') || code,
      name: catalogHit.item_name,
      partNumber: catalogHit.part_number ?? null,
      manufacturer: catalogHit.manufacturer ?? null,
      imageUrl: catalogHit.image_url,
      sourceUrl: catalogHit.product_url,
      sourceLabel: catalogHit.manufacturer ? `Your items (${catalogHit.manufacturer})` : 'Your items',
      confidence: 'high',
    }
  }

  if (validBarcode(code)) {
    const upcHit = await lookupUpcItemDbByBarcode(code)
    const upc = upcHit ? barcodeFindToProductLookup(upcHit) : null
    const av = serperKey ? await lookupAvProductByBarcode(code, serperKey) : null
    const merged = mergeBarcodeLookupResults(upc, av)
    if (merged) return merged
  }

  if (serperKey) {
    const av = await lookupAvProductByBarcode(code, serperKey)
    if (av) return av
  }

  return null
}

export function productLookupToFindResult(r: ProductLookupResult): BarcodeFindResult {
  return {
    barcode: r.barcode,
    source: r.sourceLabel,
    confidence: r.confidence,
    title: r.name,
    matchedPartNumber: r.partNumber,
    productUrl: r.sourceUrl,
    imageUrl: r.imageUrl,
  }
}
