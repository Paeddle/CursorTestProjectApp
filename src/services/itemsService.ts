import { supabase } from '../lib/supabase'
import { catalogEntryToItemPatch, itemRecordToCatalogItem } from '../lib/itemCatalogMap'
import type { ItemBarcodeFilter, ItemRecord } from '../types/items'
import type { ItemRow } from '../types/purchaseList'
import type { BarcodeCatalogItem } from '../types/poCheckin'

export function isItemsConfigured(): boolean {
  return Boolean(supabase)
}

export type ItemsListResult = {
  rows: ItemRecord[]
  total: number
}

const ITEMS_TABLE = 'items'

const ITEMS_FETCH_BATCH = 1000

export type NewItemInput = {
  manufacturer?: string | null
  part_number?: string | null
  item?: string | null
  description_customer?: string | null
  barcode?: string | null
  vendor_name?: string | null
  category?: string | null
  picture_url?: string | null
  purchase_url?: string | null
}

export async function fetchItemsList(options: {
  search?: string
  filter?: ItemBarcodeFilter
  limit?: number
  offset?: number
}): Promise<ItemsListResult> {
  if (!supabase) return { rows: [], total: 0 }

  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const search = (options.search || '').trim()
  const filter = options.filter ?? 'all'

  let query = supabase
    .from(ITEMS_TABLE)
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
    const term = search.replace(/[%_,.()]/g, '').trim()
    if (term) {
      const q = `%${term}%`
      query = query.or(
        `part_number.ilike.${q},item.ilike.${q},manufacturer.ilike.${q},barcode.ilike.${q},description_customer.ilike.${q},purchase_url.ilike.${q},notes.ilike.${q}`
      )
    }
  }

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as ItemRecord[], total: count ?? 0 }
}

/** Load every row matching filter/search (batched) for scrollable table UI. */
export async function fetchAllItemsList(options: {
  search?: string
  filter?: ItemBarcodeFilter
}): Promise<ItemsListResult> {
  const rows: ItemRecord[] = []
  let offset = 0
  let total = 0

  while (true) {
    const batch = await fetchItemsList({
      ...options,
      limit: ITEMS_FETCH_BATCH,
      offset,
    })
    if (offset === 0) total = batch.total
    rows.push(...batch.rows)
    offset += batch.rows.length
    if (batch.rows.length < ITEMS_FETCH_BATCH || rows.length >= total) break
  }

  return { rows, total }
}

export async function fetchItemsStats(): Promise<{
  total: number
  missingBarcode: number
  hasBarcode: number
}> {
  if (!supabase) return { total: 0, missingBarcode: 0, hasBarcode: 0 }

  const [totalRes, missingRes] = await Promise.all([
    supabase.from(ITEMS_TABLE).select('*', { count: 'exact', head: true }),
    supabase
      .from(ITEMS_TABLE)
      .select('*', { count: 'exact', head: true })
      .or('barcode.is.null,barcode.eq.""'),
  ])

  if (totalRes.error) throw new Error(totalRes.error.message)
  if (missingRes.error) throw new Error(missingRes.error.message)

  const total = totalRes.count ?? 0
  const missingBarcode = missingRes.count ?? 0
  return { total, missingBarcode, hasBarcode: total - missingBarcode }
}

export async function fetchItemById(id: string): Promise<ItemRecord | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from(ITEMS_TABLE).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ItemRecord | null) ?? null
}

export async function fetchItemByBarcode(barcode: string): Promise<ItemRecord | null> {
  if (!supabase) return null
  const trimmed = barcode.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits) {
    const { data } = await supabase.from(ITEMS_TABLE).select('*').eq('barcode', digits).maybeSingle()
    if (data) return data as ItemRecord
  }
  if (trimmed) {
    const { data } = await supabase.from(ITEMS_TABLE).select('*').eq('barcode', trimmed).maybeSingle()
    if (data) return data as ItemRecord
  }
  return null
}

export async function createItemRow(input: NewItemInput): Promise<ItemRecord> {
  if (!supabase) throw new Error('Supabase is not configured.')

  const item = input.item?.trim() || null
  const partNumber = input.part_number?.trim() || null
  if (!item && !partNumber) {
    throw new Error('Item name or part number is required.')
  }

  const barcodeRaw = input.barcode?.trim()
  const row = {
    manufacturer: input.manufacturer?.trim() || null,
    part_number: partNumber,
    item,
    description_customer: input.description_customer?.trim() || null,
    barcode: barcodeRaw ? barcodeRaw.replace(/\D/g, '') : null,
    vendor_name: input.vendor_name?.trim() || null,
    category: input.category?.trim() || null,
    picture_url: input.picture_url?.trim() || null,
    purchase_url: input.purchase_url?.trim() || null,
    uploaded_at: new Date().toISOString(),
  }

  const { data, error } = await supabase.from(ITEMS_TABLE).insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data as ItemRecord
}

export async function deleteItemRow(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.from(ITEMS_TABLE).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateItemRow(
  id: string,
  patch: Partial<ItemRow> & {
    notes?: string | null
    barcode_lookup_source?: string | null
    barcode_lookup_at?: string | null
  }
): Promise<ItemRecord> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from(ITEMS_TABLE).update(patch).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as ItemRecord
}

export async function applyBarcodeLookupToItem(
  id: string,
  barcode: string,
  source: string,
  options?: { purchaseUrl?: string | null; pictureUrl?: string | null }
): Promise<ItemRecord> {
  const patch: Parameters<typeof updateItemRow>[1] = {
    barcode: barcode.replace(/\D/g, ''),
    barcode_lookup_source: source,
    barcode_lookup_at: new Date().toISOString(),
  }
  const purchaseUrl = options?.purchaseUrl?.trim()
  if (purchaseUrl) patch.purchase_url = purchaseUrl
  const pictureUrl = options?.pictureUrl?.trim()
  if (pictureUrl) patch.picture_url = pictureUrl
  return updateItemRow(id, patch)
}

/** All items with a barcode, as catalog rows (replaces barcode_catalog queries). */
export async function fetchItemsAsCatalog(limit = 10000): Promise<BarcodeCatalogItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(ITEMS_TABLE)
    .select('*')
    .not('barcode', 'is', null)
    .neq('barcode', '')
    .order('item', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ItemRecord[]).map(itemRecordToCatalogItem)
}

export async function upsertItemFromCatalogEntry(entry: {
  barcode_value: string
  item_name: string
  manufacturer?: string | null
  part_number?: string | null
  image_url?: string | null
  product_url?: string | null
  notes?: string | null
}): Promise<BarcodeCatalogItem> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const patch = catalogEntryToItemPatch(entry)
  const { data, error } = await supabase
    .from(ITEMS_TABLE)
    .upsert(
      {
        ...patch,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: 'barcode' }
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return itemRecordToCatalogItem(data as ItemRecord)
}
