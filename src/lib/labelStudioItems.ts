import { supabase } from './supabase'
import { fetchItemsList } from '../services/itemsService'
import { getItemPicturePublicUrl } from './itemsImageStorage'
import type { ItemRecord } from '../types/items'
import type { LabelStudioItem } from '../types/labelStudio'

const ITEMS_PAGE_SIZE = 1000

function fieldsFromItem(row: Record<string, unknown>): Record<string, string> {
  const f: Record<string, string> = {}
  const set = (key: string, val: unknown) => {
    const s = val != null ? String(val).trim() : ''
    if (s) f[key] = s
  }
  set('item', row.item)
  set('part_number', row.part_number)
  set('manufacturer', row.manufacturer)
  set('barcode', row.barcode)
  set('url', row.purchase_url)
  set('description', row.description_customer)
  set('category', row.category)
  set('vendor', row.vendor_name)
  set('price', row.unit_price)
  set('color', row.color)
  set('unit', row.unit)
  set('type', row.type)
  const picture = getItemPicturePublicUrl({
    picture_path: row.picture_path as string | null | undefined,
    picture_url: row.picture_url as string | null | undefined,
  })
  if (picture) f.picture = picture
  return f
}

export function itemRowToLabelStudioItem(row: ItemRecord): LabelStudioItem {
  const fields = fieldsFromItem(row as unknown as Record<string, unknown>)
  const title = fields.item || fields.part_number || 'Item'
  return {
    id: `item-${row.id}`,
    source: 'items',
    title,
    fields,
  }
}

/** @deprecated Use fetchLabelStudioItems */
export const inventoryRowToLabelStudioItem = itemRowToLabelStudioItem

/** Load every items row (paginated). */
export async function fetchLabelStudioItems(
  onProgress?: (loaded: number, total: number | null) => void
): Promise<LabelStudioItem[]> {
  if (!supabase) return []

  const items: LabelStudioItem[] = []
  let offset = 0
  let total: number | null = null

  while (true) {
    const { rows, total: count } = await fetchItemsList({
      limit: ITEMS_PAGE_SIZE,
      offset,
      filter: 'all',
    })
    if (total === null) total = count
    for (const row of rows) {
      items.push(itemRowToLabelStudioItem(row))
    }
    onProgress?.(items.length, total)
    offset += rows.length
    if (rows.length < ITEMS_PAGE_SIZE || offset >= count) break
  }

  return items
}

/** @deprecated Use fetchLabelStudioItems */
export const fetchLabelStudioInventoryItems = fetchLabelStudioItems

/** Server-side search across the full items table. */
export async function searchLabelStudioItems(query: string, limit = 500): Promise<LabelStudioItem[]> {
  const q = query.trim()
  if (!q) return []
  const { rows } = await fetchItemsList({ search: q, limit, offset: 0, filter: 'all' })
  return rows.map((row) => itemRowToLabelStudioItem(row))
}

/** @deprecated Use searchLabelStudioItems */
export const searchLabelStudioInventoryItems = searchLabelStudioItems

function fieldsFromLocation(row: Record<string, unknown>): Record<string, string> {
  const f: Record<string, string> = {}
  const set = (key: string, val: unknown) => {
    const s = val != null ? String(val).trim() : ''
    if (s) f[key] = s
  }
  set('location', row.location_name)
  set('item', row.product_name)
  set('manufacturer', row.manufacturer)
  set('ref_number', row.ref_number)
  set('quantity', row.quantity)
  return f
}

export async function fetchLabelStudioLocationItems(limit = 500): Promise<LabelStudioItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('item_locations')
    .select('*')
    .order('location_name', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const fields = fieldsFromLocation(row)
    const title = [fields.location, fields.item].filter(Boolean).join(' — ') || 'Location'
    return {
      id: `loc-${row.id}`,
      source: 'location' as const,
      title,
      fields,
    }
  })
}

export async function fetchLabelStudioPoLineItems(limit = 500): Promise<LabelStudioItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('po_line_items')
    .select('*')
    .order('po_date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const f: Record<string, string> = {}
    const set = (key: string, val: unknown) => {
      const s = val != null ? String(val).trim() : ''
      if (s) f[key] = s
    }
    set('po_number', row.po_number)
    set('item', row.item_name)
    set('job', row.job_or_customer)
    set('quantity', row.quantity)
    const title = [f.po_number, f.item].filter(Boolean).join(' — ') || 'PO line'
    return {
      id: `po-${row.id}`,
      source: 'po_line' as const,
      title,
      fields: f,
    }
  })
}

export type LabelStudioInventorySortKey = 'name' | 'part_number' | 'manufacturer'
export type LabelStudioSortDirection = 'asc' | 'desc'

export function sortLabelStudioItems(
  items: LabelStudioItem[],
  key: LabelStudioInventorySortKey,
  dir: LabelStudioSortDirection
): LabelStudioItem[] {
  const mult = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const av = (a.fields[key === 'name' ? 'item' : key] ?? '').toLowerCase()
    const bv = (b.fields[key === 'name' ? 'item' : key] ?? '').toLowerCase()
    return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * mult
  })
}

export function filterLabelStudioItems(items: LabelStudioItem[], query: string): LabelStudioItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => {
    const blob = Object.values(item.fields).join(' ').toLowerCase()
    return blob.includes(q) || item.title.toLowerCase().includes(q)
  })
}
