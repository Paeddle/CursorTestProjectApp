import { supabase } from '../lib/supabase'
import type { InventreePartRecord } from '../types'

const PARTS_TABLE = 'inventree_parts'

function normalizeIpn(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export async function fetchPartByIpn(ipn: string): Promise<InventreePartRecord | null> {
  if (!supabase) return null
  const trimmed = normalizeIpn(ipn)
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

/** Read IPN from URL: /r/IPN, ?ipn=IPN, ?sku=IPN, or ?s=IPN */
export function ipnFromLocation(): string {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('ipn') ?? params.get('sku') ?? params.get('s') ?? ''
  if (fromQuery.trim()) return decodeURIComponent(fromQuery.trim())

  const match = window.location.pathname.match(/^\/r\/(.+)$/i)
  if (match?.[1]) return decodeURIComponent(match[1].trim())

  return ''
}

export function reorderUrlForIpn(baseUrl: string, ipn: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/r/${encodeURIComponent(ipn.trim())}`
}
