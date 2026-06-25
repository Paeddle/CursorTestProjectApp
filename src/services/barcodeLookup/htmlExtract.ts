import { invokeProductLookup, safeFetchText } from './lookupProxy'
import {
  parseProductPageFromHtml,
  type ProductPageDetails,
  isLikelyProductImageUrl,
  pickBestProductImage,
  scoreProductImageUrl,
  extractModelFromUpcTitle,
} from './productPageExtract'

export { isLikelyProductImageUrl, pickBestProductImage, scoreProductImageUrl, extractModelFromUpcTitle }
export type { ProductPageDetails }

export function jinaFetchUrl(targetUrl: string): string {
  const trimmed = targetUrl.trim()
  if (trimmed.startsWith('http://')) return `https://r.jina.ai/http://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('https://')) return `https://r.jina.ai/http://${trimmed.slice('https://'.length)}`
  return `https://r.jina.ai/http://${trimmed}`
}

/** @deprecated use ProductPageDetails */
export type PageMeta = ProductPageDetails & { title: string | null; imageUrl: string | null; partNumber: string | null }

export async function fetchProductPageDetails(
  pageUrl: string,
  partHint?: string | null
): Promise<ProductPageDetails | null> {
  const proxied = await invokeProductLookup<ProductPageDetails>('page_meta', {
    url: pageUrl,
    partHint,
  })
  if (proxied?.title || proxied?.imageUrl || proxied?.partNumber) {
    return proxied
  }

  const text = await safeFetchText(jinaFetchUrl(pageUrl), { headers: { Accept: 'text/plain' } })
  if (!text) return null
  return parseProductPageFromHtml(text, pageUrl, partHint)
}

export async function fetchPageMeta(
  pageUrl: string,
  partHint?: string | null
): Promise<ProductPageDetails | null> {
  return fetchProductPageDetails(pageUrl, partHint)
}
