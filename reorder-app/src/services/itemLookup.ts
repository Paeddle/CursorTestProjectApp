import { supabase } from '../lib/supabase'
import type { InventreePartRecord } from '../types'

const PARTS_TABLE = 'inventree_parts'

function normalizeIpn(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

const RESERVED_PATHS = new Set(['reorder', 'portal', 'r', 'index.html', ''])

function lastPathSegment(pathname: string): string {
  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const last = segments[segments.length - 1] ?? ''
  if (!last || RESERVED_PATHS.has(last.toLowerCase())) return ''
  try {
    return decodeURIComponent(last.trim())
  } catch {
    return last.trim()
  }
}

/** Pull the IPN off a typed/scanned value, including full reorder URLs from a barcode scanner. */
export function ipnFromScannedValue(raw: string): string {
  let trimmed = raw.trim().replace(/^(URL|URI)\s*:\s*/i, '').trim()
  if (!trimmed) return ''

  const looksLikeUrl =
    /^https?:\/\//i.test(trimmed) ||
    /(?:www\.)?(?:shswebapp\.site|ondigitalocean\.app)/i.test(trimmed) ||
    /\/reorder\//i.test(trimmed)

  if (looksLikeUrl) {
    const href = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed.replace(/^\/\//, '')}`
    try {
      const url = new URL(href.split(/\s+/)[0])
      const fromQuery = url.searchParams.get('ipn') ?? url.searchParams.get('sku') ?? url.searchParams.get('s')
      if (fromQuery?.trim()) return decodeURIComponent(fromQuery.trim())
      const rMatch = url.pathname.match(/\/r\/([^/]+)\/?$/i)
      if (rMatch?.[1]) return decodeURIComponent(rMatch[1])
      const last = lastPathSegment(url.pathname)
      if (last) return last
    } catch {
      /* ignore parse errors */
    }
    const rMatch = trimmed.match(/\/r\/([^/?#\s]+)\/?$/i)
    if (rMatch?.[1]) {
      try {
        return decodeURIComponent(rMatch[1])
      } catch {
        return rMatch[1]
      }
    }
    return ''
  }

  const rMatch = trimmed.match(/\/r\/([^/?#\s]+)\/?$/i)
  if (rMatch?.[1]) {
    try {
      return decodeURIComponent(rMatch[1])
    } catch {
      return rMatch[1]
    }
  }

  const normalized = normalizeIpn(trimmed)
  if (RESERVED_PATHS.has(normalized.toLowerCase())) return ''
  if (/^https?:\/\//i.test(normalized)) return ''
  return normalized
}

export async function fetchPartByIpn(ipn: string): Promise<InventreePartRecord | null> {
  if (!supabase) return null
  const trimmed = normalizeIpn(ipnFromScannedValue(ipn))
  if (!trimmed) return null

  const select =
    'id, inventree_id, name, ipn, category_name, link, maximum_stock, active, barcode_hash, creation_date'

  const { data: exact } = await supabase
    .from(PARTS_TABLE)
    .select(select)
    .eq('ipn', trimmed)
    .maybeSingle()
  if (exact) return exact as InventreePartRecord

  const { data: ilike } = await supabase
    .from(PARTS_TABLE)
    .select(select)
    .ilike('ipn', trimmed)
    .limit(1)
    .maybeSingle()
  if (ilike) return ilike as InventreePartRecord

  const { data: byName } = await supabase
    .from(PARTS_TABLE)
    .select(select)
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle()
  if (byName) return byName as InventreePartRecord

  return null
}

/** Read IPN from the page URL or a scanned reorder URL in the address bar. */
export function ipnFromLocation(): string {
  return ipnFromScannedValue(window.location.href)
}

export function reorderUrlForIpn(baseUrl: string, ipn: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/r/${encodeURIComponent(ipn.trim())}`
}
