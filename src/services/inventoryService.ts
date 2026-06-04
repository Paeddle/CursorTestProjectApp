import { supabase } from '../lib/supabase'
import type { InventoryBarcodeFilter, InventoryRecord } from '../types/inventory'
import type { InventoryRow } from '../types/purchaseList'

export function isInventoryConfigured(): boolean {
  return Boolean(supabase)
}

export type InventoryListResult = {
  rows: InventoryRecord[]
  total: number
}

export async function fetchInventoryList(options: {
  search?: string
  filter?: InventoryBarcodeFilter
  limit?: number
  offset?: number
}): Promise<InventoryListResult> {
  if (!supabase) return { rows: [], total: 0 }

  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const search = (options.search || '').trim()
  const filter = options.filter ?? 'all'

  let query = supabase
    .from('inventory')
    .select('*', { count: 'exact' })
    .order('manufacturer', { ascending: true, nullsFirst: false })
    .order('part_number', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (filter === 'missing') {
    query = query.or('barcode.is.null,barcode.eq.""')
  } else if (filter === 'has_barcode') {
    query = query.not('barcode', 'is', null).neq('barcode', '')
  }

  if (search) {
    const term = search.replace(/[%_,]/g, '').trim()
    if (term) {
      const q = `%${term}%`
      query = query.or(
        `part_number.ilike.${q},item.ilike.${q},manufacturer.ilike.${q},barcode.ilike.${q},description_customer.ilike.${q},purchase_url.ilike.${q}`
      )
    }
  }

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as InventoryRecord[], total: count ?? 0 }
}

export async function fetchInventoryStats(): Promise<{
  total: number
  missingBarcode: number
  hasBarcode: number
}> {
  if (!supabase) return { total: 0, missingBarcode: 0, hasBarcode: 0 }

  const [totalRes, missingRes] = await Promise.all([
    supabase.from('inventory').select('*', { count: 'exact', head: true }),
    supabase
      .from('inventory')
      .select('*', { count: 'exact', head: true })
      .or('barcode.is.null,barcode.eq.""'),
  ])

  if (totalRes.error) throw new Error(totalRes.error.message)
  if (missingRes.error) throw new Error(missingRes.error.message)

  const total = totalRes.count ?? 0
  const missingBarcode = missingRes.count ?? 0
  return { total, missingBarcode, hasBarcode: total - missingBarcode }
}

export async function updateInventoryRow(
  id: string,
  patch: Partial<InventoryRow> & {
    barcode_lookup_source?: string | null
    barcode_lookup_at?: string | null
  }
): Promise<InventoryRecord> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('inventory').update(patch).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as InventoryRecord
}

export async function applyBarcodeLookupToInventory(
  id: string,
  barcode: string,
  source: string,
  options?: { purchaseUrl?: string | null }
): Promise<InventoryRecord> {
  const patch: Parameters<typeof updateInventoryRow>[1] = {
    barcode: barcode.replace(/\D/g, ''),
    barcode_lookup_source: source,
    barcode_lookup_at: new Date().toISOString(),
  }
  const purchaseUrl = options?.purchaseUrl?.trim()
  if (purchaseUrl) patch.purchase_url = purchaseUrl
  return updateInventoryRow(id, patch)
}
