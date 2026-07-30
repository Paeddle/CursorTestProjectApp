import { supabase } from '../lib/supabase'
import type { ItemRecord } from '../types'

const ITEMS_TABLE = 'items'

function normalizeSku(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export async function fetchItemBySku(sku: string): Promise<ItemRecord | null> {
  if (!supabase) return null
  const trimmed = normalizeSku(sku)
  if (!trimmed) return null

  const { data: exact } = await supabase
    .from(ITEMS_TABLE)
    .select(
      'id, manufacturer, item, part_number, description_customer, vendor_name, barcode, stock_available, picture_url'
    )
    .eq('part_number', trimmed)
    .maybeSingle()
  if (exact) return exact as ItemRecord

  const { data: ilike } = await supabase
    .from(ITEMS_TABLE)
    .select(
      'id, manufacturer, item, part_number, description_customer, vendor_name, barcode, stock_available, picture_url'
    )
    .ilike('part_number', trimmed)
    .limit(1)
    .maybeSingle()
  if (ilike) return ilike as ItemRecord

  const digits = trimmed.replace(/\D/g, '')
  if (digits) {
    const { data: byBarcode } = await supabase
      .from(ITEMS_TABLE)
      .select(
        'id, manufacturer, item, part_number, description_customer, vendor_name, barcode, stock_available, picture_url'
      )
      .eq('barcode', digits)
      .maybeSingle()
    if (byBarcode) return byBarcode as ItemRecord
  }

  const { data: byItemName } = await supabase
    .from(ITEMS_TABLE)
    .select(
      'id, manufacturer, item, part_number, description_customer, vendor_name, barcode, stock_available, picture_url'
    )
    .ilike('item', trimmed)
    .limit(1)
    .maybeSingle()
  if (byItemName) return byItemName as ItemRecord

  return null
}

/** Read SKU from URL: /r/SKU, ?sku=SKU, or ?s=SKU */
export function skuFromLocation(): string {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('sku') ?? params.get('s') ?? ''
  if (fromQuery.trim()) return decodeURIComponent(fromQuery.trim())

  const match = window.location.pathname.match(/^\/r\/(.+)$/i)
  if (match?.[1]) return decodeURIComponent(match[1].trim())

  return ''
}

export function reorderUrlForSku(baseUrl: string, sku: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/r/${encodeURIComponent(sku.trim())}`
}
