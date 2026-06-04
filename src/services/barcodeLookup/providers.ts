import { fetchItemsAsCatalog } from '../itemsService'
import { normalizePartKey, extractBarcodesFromText, buildSearchQueries } from './barcodeExtract'
import type { BarcodeFindResult, ProductLookupInput } from './types'
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
  productUrl: string | null
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
  }
}

/** Local items table (formerly barcode_catalog) — match by part number or item name. */
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
      return resultFromBarcode(
        exact.barcode_value,
        'Your items',
        'high',
        exact.item_name,
        exact.part_number ?? null,
        exact.product_url ?? null
      )
    }
  }

  const itemKey = normalizePartKey(input.item || '')
  if (itemKey.length >= 4) {
    const hit = rows.find((r) => {
      const ik = normalizePartKey(r.item_name || '')
      return ik === itemKey || ik.includes(itemKey) || itemKey.includes(ik)
    })
    if (hit?.barcode_value) {
      return resultFromBarcode(
        hit.barcode_value,
        'Your items (item name)',
        'medium',
        hit.item_name,
        hit.part_number ?? null,
        hit.product_url ?? null
      )
    }
  }

  return null
}

/** Open Food Facts — search by product text (not only by scanning a code). */
export async function lookupOpenFoodFactsSearch(query: string): Promise<BarcodeFindResult | null> {
  const q = query.trim()
  if (!q) return null
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=5`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = (await res.json()) as {
    products?: Array<{ code?: string; product_name?: string; brands?: string }>
  }
  for (const p of data.products ?? []) {
    const code = (p.code || '').replace(/\D/g, '')
    if (!validBarcode(code)) continue
    const title = p.product_name || p.brands || null
    return resultFromBarcode(
      code,
      'Open Food Facts',
      'medium',
      title,
      null,
      `https://world.openfoodfacts.org/product/${code}`
    )
  }
  return null
}

/** Open Food Facts — lookup when barcode is already known. */
export async function lookupOpenFoodFactsByBarcode(barcode: string): Promise<BarcodeFindResult | null> {
  const code = encodeURIComponent(barcode.replace(/\D/g, ''))
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { status?: number; product?: { product_name?: string } }
  if (data.status !== 1 || !data.product) return null
  return resultFromBarcode(
    barcode,
    'Open Food Facts',
    'high',
    data.product.product_name ?? null,
    null,
    `https://world.openfoodfacts.org/product/${code}`
  )
}

/** UPCitemdb trial search — 100 req/day without key; optional user key for prod tier. */
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
    items?: Array<{ ean?: string; upc?: string; title?: string; brand?: string }>
  }
  const item = data.items?.[0]
  if (!item) return null
  const code = (item.ean || item.upc || '').replace(/\D/g, '')
  if (!validBarcode(code)) return null
  const title = item.title || item.brand || null
  return resultFromBarcode(code, 'UPCitemdb', 'medium', title, null, null)
}

/** Serper Google search — extract UPC from result titles/snippets. */
export async function lookupSerperForBarcode(
  query: string,
  apiKey: string
): Promise<BarcodeFindResult | null> {
  const q = query.trim()
  if (!q || !apiKey) return null
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: `${q} UPC EAN barcode`, num: 8 }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; snippet?: string; link?: string }>
  }
  for (const row of data.organic ?? []) {
    const blob = `${row.title ?? ''} ${row.snippet ?? ''}`
    const codes = extractBarcodesFromText(blob)
    if (codes.length > 0) {
      return resultFromBarcode(
        codes[0],
        'Web search (Serper)',
        'low',
        row.title ?? null,
        null,
        row.link ?? null
      )
    }
  }
  return null
}

/** Run Open Food Facts + UPCitemdb for each search query until one hits. */
export async function lookupMarketplaceSearch(
  input: ProductLookupInput
): Promise<BarcodeFindResult | null> {
  const queries = buildSearchQueries(input)
  for (const q of queries) {
    const upc = await lookupUpcItemDbSearch(q)
    if (upc) return upc
    const off = await lookupOpenFoodFactsSearch(q)
    if (off) return off
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
