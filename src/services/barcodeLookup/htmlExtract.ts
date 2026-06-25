import { invokeProductLookup, safeFetchText } from './lookupProxy'

export function jinaFetchUrl(targetUrl: string): string {
  const trimmed = targetUrl.trim()
  if (trimmed.startsWith('http://')) return `https://r.jina.ai/http://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('https://')) return `https://r.jina.ai/http://${trimmed.slice('https://'.length)}`
  return `https://r.jina.ai/http://${trimmed}`
}

export function extractMetaContent(
  htmlText: string,
  key: 'og:title' | 'og:image' | 'og:description'
): string | null {
  const re = new RegExp(
    `<meta\\s+[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  )
  const m = htmlText.match(re)
  if (!m) return null
  return m[1]?.trim() || null
}

export function extractTitle(htmlText: string): string | null {
  const m = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (!m) return null
  return m[1]?.trim() || null
}

/** Pull a manufacturer part / model number from page text when present. */
export function extractPartNumberFromText(text: string, hint?: string | null): string | null {
  if (hint?.trim()) {
    const escaped = hint.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const exact = new RegExp(`\\b(${escaped})\\b`, 'i')
    if (exact.test(text)) return hint.trim()
  }
  const patterns = [
    /(?:model|part|sku|mpn|item)\s*(?:#|no\.?|number)?\s*[:.]?\s*([A-Z0-9][A-Z0-9._\-/]{2,30})/i,
    /\b([A-Z]{1,4}[-_]?[A-Z0-9]{2,}[-_]?[A-Z0-9]*)\b/,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1] && m[1].length >= 3) return m[1]
  }
  return null
}

export type PageMeta = {
  title: string | null
  imageUrl: string | null
  partNumber: string | null
}

export async function fetchPageMeta(
  pageUrl: string,
  partHint?: string | null
): Promise<PageMeta | null> {
  const proxied = await invokeProductLookup<PageMeta>('page_meta', { url: pageUrl, partHint })
  if (proxied) {
    const partNumber = proxied.partNumber ?? extractPartNumberFromText(proxied.title ?? '', partHint)
    return { ...proxied, partNumber }
  }

  const text = await safeFetchText(jinaFetchUrl(pageUrl), { headers: { Accept: 'text/plain' } })
  if (!text) return null
  const ogTitle = extractMetaContent(text, 'og:title')
  const ogImage = extractMetaContent(text, 'og:image')
  const title = ogTitle || extractTitle(text)
  const partNumber = extractPartNumberFromText(text, partHint)
  return { title, imageUrl: ogImage, partNumber }
}

export function isLikelyProductImageUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false
  const u = url.toLowerCase()
  if (u.includes('logo') || u.includes('icon') || u.includes('sprite') || u.includes('pixel')) {
    return false
  }
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(u) || u.includes('/image') || u.includes('/media')
}
