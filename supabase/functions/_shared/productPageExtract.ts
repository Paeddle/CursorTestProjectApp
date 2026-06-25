/**
 * Shared product page parsing for the product-lookup Edge Function.
 * Keep in sync with src/services/barcodeLookup/productPageExtract.ts
 */

export type ProductPageDetails = {
  title: string | null
  cleanTitle: string | null
  partNumber: string | null
  manufacturer: string | null
  imageUrl: string | null
}

const BAD_IMAGE_RE =
  /logo|icon|sprite|pixel|placeholder|avatar|badge|banner|favicon|social|share|spacer|1x1|tracking|blank\.|default-image|no-image|loading/i

const THUMB_RE = /[\/_-](thumb|thumbnail|small|tiny|xs|sm|50x|100x|150x)([\/_.-]|$)/i

const MODEL_PATTERNS = [
  /\b(UN\d{2}[A-Z0-9]{4,}[A-Z]?(?:FXZA|FXZC|FXZP)?)\b/i,
  /\b(QN\d{2}[A-Z0-9]{4,}[A-Z]?)\b/i,
  /\b(LST\d{2,}[A-Z0-9-]*)\b/i,
  /\b(XR\d{2}[A-Z0-9]{2,}[A-Z]?)\b/i,
  /\b(XBR-[A-Z0-9-]+)\b/i,
  /\b(KD-\d{2}[A-Z0-9]+)\b/i,
  /\b(OLED\d{2}[A-Z0-9]{3,})\b/i,
  /\b(55[A-Z]{2}\d{4}[A-Z]{2,})\b/i,
  /\b([A-Z]{2,5}\d{2}[A-Z0-9]{3,}[A-Z]?)\b/,
  /\b([A-Z]{1,4}[-_]?\d{3,}[A-Z0-9-]{0,12})\b/,
]

const MANUFACTURER_ALIASES: Record<string, string> = {
  samsung: 'Samsung',
  sony: 'Sony',
  lg: 'LG',
  panasonic: 'Panasonic',
  vizio: 'Vizio',
  tcl: 'TCL',
  hisense: 'Hisense',
  sharp: 'Sharp',
  philips: 'Philips',
  denon: 'Denon',
  marantz: 'Marantz',
  yamaha: 'Yamaha',
  lutron: 'Lutron',
  crestron: 'Crestron',
  extron: 'Extron',
  shure: 'Shure',
  sonos: 'Sonos',
  epson: 'Epson',
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractMetaContent(htmlText: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta\\s+[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*property=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta\\s+[^>]*name=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
  ]
  for (const re of patterns) {
    const m = htmlText.match(re)
    if (m?.[1]) return decodeHtmlEntities(m[1].trim())
  }
  return null
}

function extractTitle(htmlText: string): string | null {
  const m = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m?.[1] ? decodeHtmlEntities(m[1].trim()) : null
}

function cleanProductTitle(raw: string | null): string | null {
  if (!raw?.trim()) return null
  let t = raw.trim()
  t = t.replace(/\s*[\|–—-]\s*(B&H Photo|Best Buy|Amazon\.com|Adorama|Markertek|ADI).*$/i, '')
  t = t.replace(/\s+/g, ' ').trim()
  return t || raw.trim()
}

function extractModelFromUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl)
    const path = decodeURIComponent(u.pathname)
    const slug = path.split('/').filter(Boolean).pop() ?? ''
    for (const re of MODEL_PATTERNS) {
      const m = slug.replace(/[-_]+/g, ' ').match(re)
      if (m?.[1] && m[1].length >= 4) return m[1].toUpperCase()
    }
    const slugModel = slug.match(
      /(?:^|[-_])([a-z]{2,5}\d{2}[a-z0-9]{3,}|[a-z]{2}\d{2}[a-z0-9]{4,})(?:[-_]|$)/i
    )
    if (slugModel?.[1]) return slugModel[1].toUpperCase()
  } catch {
    /* ignore */
  }
  return null
}

function extractModelFromTitle(title: string | null | undefined): string | null {
  if (!title?.trim()) return null
  for (const re of MODEL_PATTERNS) {
    const m = title.match(re)
    if (m?.[1] && m[1].length >= 4 && m[1].length <= 24) return m[1].toUpperCase()
  }
  const series = title.match(/\b([A-Z]{2,4}\d{3,}[A-Z0-9]*)\s+Series\b/i)
  if (series?.[1]) return series[1].toUpperCase()
  return null
}

function extractManufacturerFromTitle(title: string | null): string | null {
  if (!title) return null
  const lower = title.toLowerCase()
  for (const [key, label] of Object.entries(MANUFACTURER_ALIASES)) {
    if (lower.includes(key)) return label
  }
  return null
}

function parseJsonLdProducts(htmlText: string): Array<Record<string, unknown>> {
  const products: Array<Record<string, unknown>> = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(htmlText))) {
    try {
      const json = JSON.parse(m[1]) as unknown
      const nodes = Array.isArray(json) ? json : [json]
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue
        const obj = node as Record<string, unknown>
        const type = String(obj['@type'] ?? '')
        if (type === 'Product' || type.includes('Product')) products.push(obj)
        const graph = obj['@graph']
        if (Array.isArray(graph)) {
          for (const g of graph) {
            if (g && typeof g === 'object') {
              const gt = String((g as Record<string, unknown>)['@type'] ?? '')
              if (gt === 'Product' || gt.includes('Product')) products.push(g as Record<string, unknown>)
            }
          }
        }
      }
    } catch {
      /* skip */
    }
  }
  return products
}

function imageFromJsonLdValue(val: unknown): string[] {
  const urls: string[] = []
  if (typeof val === 'string') urls.push(val)
  else if (Array.isArray(val)) {
    for (const v of val) {
      if (typeof v === 'string') urls.push(v)
      else if (v && typeof v === 'object' && typeof (v as { url?: string }).url === 'string') {
        urls.push((v as { url: string }).url)
      }
    }
  } else if (val && typeof val === 'object' && typeof (val as { url?: string }).url === 'string') {
    urls.push((val as { url: string }).url)
  }
  return urls
}

function extractImageUrlsFromHtml(htmlText: string): string[] {
  const found = new Set<string>()
  const add = (u: string | null | undefined) => {
    if (u?.trim() && u.startsWith('http')) found.add(decodeHtmlEntities(u.trim()))
  }
  for (const key of ['og:image', 'twitter:image']) add(extractMetaContent(htmlText, key))
  const imgRe = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(htmlText))) add(m[0])
  for (const product of parseJsonLdProducts(htmlText)) {
    for (const u of imageFromJsonLdValue(product.image)) add(u)
  }
  return [...found]
}

function scoreProductImageUrl(url: string, modelHint?: string | null): number {
  if (!url?.trim()) return -100
  const u = url.toLowerCase()
  if (BAD_IMAGE_RE.test(u)) return -50
  if (THUMB_RE.test(u)) return -20
  let score = 10
  if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) score += 5
  if (u.includes('product') || u.includes('/images/') || u.includes('/media/')) score += 8
  if (u.includes('gallery') || u.includes('hero') || u.includes('large') || u.includes('main')) score += 6
  if (modelHint) {
    const hint = modelHint.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (hint.length >= 4 && u.replace(/[^a-z0-9]/g, '').includes(hint)) score += 25
  }
  const sizeMatch = u.match(/(\d{3,4})x(\d{3,4})/)
  if (sizeMatch) {
    const w = Number(sizeMatch[1])
    if (w >= 400) score += 10
    if (w < 200) score -= 15
  }
  return score
}

function pickBestProductImage(urls: string[], modelHint?: string | null): string | null {
  const ranked = urls
    .map((u) => ({ u, score: scoreProductImageUrl(u, modelHint) }))
    .filter((x) => x.score >= 5)
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.u ?? null
}

function extractPartNumberFromText(text: string, hint?: string | null): string | null {
  if (hint?.trim() && new RegExp(`\\b${hint.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
    return hint.trim()
  }
  const fromTitle = extractModelFromTitle(text)
  if (fromTitle) return fromTitle
  const labeled =
    /(?:model\s*(?:number|#|no\.?)?|mpn|sku|part\s*(?:#|number)?)\s*[:.]?\s*([A-Z0-9][A-Z0-9._\-/]{2,28})/i.exec(
      text
    )
  if (labeled?.[1]) return labeled[1].trim()
  return null
}

export function parseProductPageFromHtml(
  htmlText: string,
  pageUrl: string,
  partHint?: string | null
): ProductPageDetails {
  const products = parseJsonLdProducts(htmlText)
  const jsonLd = products[0]
  const ogTitle = extractMetaContent(htmlText, 'og:title')
  const pageTitle = extractTitle(htmlText)
  const title = (jsonLd?.name as string) || ogTitle || pageTitle || null
  const cleanTitle = cleanProductTitle(title)
  const modelFromUrl = extractModelFromUrl(pageUrl)
  const modelFromTitle = extractModelFromTitle(title)
  const modelFromBody = extractPartNumberFromText(htmlText, partHint)
  const jsonPart =
    (jsonLd?.sku as string) || (jsonLd?.mpn as string) || (jsonLd?.model as string) || null
  const partNumber =
    jsonPart?.trim() ?? modelFromUrl ?? modelFromTitle ?? modelFromBody ?? null
  const brand = (jsonLd?.brand as { name?: string } | string | undefined) ?? extractMetaContent(htmlText, 'product:brand')
  const manufacturer =
    (typeof brand === 'string' ? brand : brand?.name) || extractManufacturerFromTitle(title) || null
  const modelHint = partNumber ?? modelFromTitle ?? modelFromUrl
  const imageUrl = pickBestProductImage(extractImageUrlsFromHtml(htmlText), modelHint)
  return {
    title,
    cleanTitle,
    partNumber: partNumber?.trim() || null,
    manufacturer: manufacturer?.trim() || null,
    imageUrl,
  }
}

export function extractModelFromUpcTitle(title: string | null, brand: string | null): string | null {
  return extractModelFromTitle(title) ?? extractModelFromTitle(brand ? `${brand} ${title}` : title)
}

export function pickBestUpcImage(images: string[] | undefined, modelHint: string | null): string | null {
  if (!images?.length) return null
  return pickBestProductImage(images, modelHint)
}
