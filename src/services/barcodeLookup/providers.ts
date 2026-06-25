import { fetchItemsAsCatalog } from '../itemsService'
import { normalizePartKey, extractBarcodesFromText, buildSearchQueries } from './barcodeExtract'
import {
  buildAvBarcodeSearchQueries,
  buildAvProductSearchQueries,
  linkMatchesAvDistributor,
  linkMatchesAvSource,
} from './avSources'
import { fetchPageMeta, isLikelyProductImageUrl } from './htmlExtract'
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

  const partKey = normalizePartKey(input.part_number || '')
  if (partKey) {
    const exact = rows.find((r) => normalizePartKey(r.part_number || '') === partKey)
    if (exact?.barcode_value) {
      return catalogToFindResult(exact, 'Your items', 'high')
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
  const base = userKey
    ? `https://api.upcitemdb.com/prod/v1/search?s=${encodeURIComponent(q)}`
    : `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(q)}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (userKey) headers.user_key = userKey

  const res = await fetch(base, { headers })
  if (!res.ok) return null
  const data = (await res.json()) as {
    items?: Array<{
      ean?: string
      upc?: string
      title?: string
      brand?: string
      images?: string[]
      offers?: Array<{ merchant?: string; link?: string }>
    }>
  }
  const item = data.items?.[0]
  if (!item) return null
  const code = (item.ean || item.upc || '').replace(/\D/g, '')
  if (!validBarcode(code)) return null
  const title = item.title || item.brand || null
  const imageUrl = item.images?.find((u) => isLikelyProductImageUrl(u)) ?? item.images?.[0] ?? null
  const productUrl = item.offers?.[0]?.link ?? null
  return resultFromBarcode(code, 'UPCitemdb', 'medium', title, null, productUrl, imageUrl)
}

/** UPCitemdb — lookup when barcode is already known. */
export async function lookupUpcItemDbByBarcode(barcode: string): Promise<BarcodeFindResult | null> {
  const code = barcode.replace(/\D/g, '')
  if (!validBarcode(code)) return null
  const userKey = import.meta.env.VITE_UPCITEMDB_USER_KEY as string | undefined
  const base = userKey
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(code)}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (userKey) headers.user_key = userKey

  const res = await fetch(base, { headers })
  if (!res.ok) return null
  const data = (await res.json()) as {
    items?: Array<{
      ean?: string
      upc?: string
      title?: string
      brand?: string
      images?: string[]
      offers?: Array<{ link?: string }>
    }>
  }
  const item = data.items?.[0]
  if (!item) return null
  const title = item.title || item.brand || null
  const imageUrl = item.images?.find((u) => isLikelyProductImageUrl(u)) ?? item.images?.[0] ?? null
  const productUrl = item.offers?.[0]?.link ?? null
  return resultFromBarcode(code, 'UPCitemdb', 'high', title, null, productUrl, imageUrl)
}

async function pickAvOrganicResult(
  organic: Array<{ title?: string; snippet?: string; link?: string }>,
  preferDistributor = true
): Promise<{ link: string; title?: string } | null> {
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

/** AV distributor / manufacturer pages — barcode → product info. */
export async function lookupAvProductByBarcode(
  barcode: string,
  apiKey: string | undefined
): Promise<ProductLookupResult | null> {
  if (!apiKey) return null
  const code = barcode.replace(/\D/g, '')
  if (!code) return null

  for (const q of buildAvBarcodeSearchQueries(code)) {
    const organic = await serperWebSearch(q, apiKey, 8)
    const chosen = await pickAvOrganicResult(organic, true)
    if (!chosen) continue

    const meta = await fetchPageMeta(chosen.link)
    const title = meta?.title || chosen.title || null
    const imageUrl = meta?.imageUrl && isLikelyProductImageUrl(meta.imageUrl) ? meta.imageUrl : null
    const sourceLabel = linkMatchesAvDistributor(chosen.link) ? 'AV distributor' : 'AV manufacturer'

    return {
      barcode: code,
      name: title,
      partNumber: meta?.partNumber ?? null,
      manufacturer: null,
      imageUrl,
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
  const part = (input.part_number || '').trim()
  if (!part) return null

  for (const q of buildAvProductSearchQueries(input)) {
    const organic = await serperWebSearch(q, apiKey, 8)
    const chosen = await pickAvOrganicResult(organic, true)
    if (!chosen) continue

    const blob = `${chosen.title ?? ''} ${organic.find((r) => r.link === chosen.link)?.snippet ?? ''}`
    const codes = extractBarcodesFromText(blob)
    const meta = await fetchPageMeta(chosen.link, part)
    const pageCodes = meta ? extractBarcodesFromText(`${meta.title ?? ''}`) : []
    const allCodes = [...new Set([...codes, ...pageCodes])]

    const imageUrl = meta?.imageUrl && isLikelyProductImageUrl(meta.imageUrl) ? meta.imageUrl : null
    const title = meta?.title || chosen.title || null
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
    const upc = await lookupUpcItemDbByBarcode(code)
    if (upc) {
      return {
        barcode: upc.barcode,
        name: upc.title,
        partNumber: upc.matchedPartNumber,
        manufacturer: null,
        imageUrl: upc.imageUrl,
        sourceUrl: upc.productUrl,
        sourceLabel: upc.source,
        confidence: upc.confidence,
      }
    }
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
