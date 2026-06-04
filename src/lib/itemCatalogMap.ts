import type { ItemRecord } from '../types/items'
import type { BarcodeCatalogItem } from '../types/poCheckin'

/** Map items row → legacy catalog shape (PO Info, barcode lookup UI). */
export function itemRecordToCatalogItem(row: ItemRecord): BarcodeCatalogItem {
  return {
    id: row.id,
    barcode_value: (row.barcode ?? '').trim(),
    manufacturer: row.manufacturer,
    item_name: row.item ?? '',
    part_number: row.part_number,
    image_url: row.picture_url,
    product_url: row.purchase_url,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  }
}

export function catalogEntryToItemPatch(entry: {
  barcode_value: string
  item_name: string
  manufacturer?: string | null
  part_number?: string | null
  image_url?: string | null
  product_url?: string | null
  notes?: string | null
}): Partial<ItemRecord> {
  return {
    barcode: entry.barcode_value.trim(),
    item: entry.item_name.trim(),
    manufacturer: entry.manufacturer?.trim() || null,
    part_number: entry.part_number?.trim() || null,
    picture_url: entry.image_url?.trim() || null,
    purchase_url: entry.product_url?.trim() || null,
    notes: entry.notes?.trim() || null,
    barcode_lookup_source: 'items_catalog',
  }
}
