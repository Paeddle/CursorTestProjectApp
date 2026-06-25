import { supabase } from '../lib/supabase'
import type { EbayScanGroup, EbayScanRow } from '../types/ebay'
import type { ItemRecord } from '../types/items'

const TABLE = 'ebay_scans'

export function isEbayScansConfigured(): boolean {
  return Boolean(supabase)
}

export async function fetchEbayScans(): Promise<EbayScanRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as EbayScanRow[]
}

export async function fetchEbayItemsByIds(ids: string[]): Promise<ItemRecord[]> {
  if (!supabase || ids.length === 0) return []
  const { data, error } = await supabase.from('items').select('*').in('id', ids)
  if (error) throw new Error(error.message)
  return (data ?? []) as ItemRecord[]
}

export async function fetchEbayItemsByBarcodes(barcodes: string[]): Promise<ItemRecord[]> {
  if (!supabase || barcodes.length === 0) return []
  const keys = new Set(
    barcodes.flatMap((b) => {
      const t = b.trim()
      const d = t.replace(/\D/g, '')
      return [normalizeBarcodeKey(t), d ? normalizeBarcodeKey(d) : ''].filter(Boolean)
    })
  )
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .not('barcode', 'is', null)
    .neq('barcode', '')
  if (error) throw new Error(error.message)
  return ((data ?? []) as ItemRecord[]).filter((item) => {
    const code = (item.barcode ?? '').trim()
    if (!code) return false
    return keys.has(normalizeBarcodeKey(code)) || keys.has(normalizeBarcodeKey(code.replace(/\D/g, '')))
  })
}

function normalizeBarcodeKey(barcode: string): string {
  return barcode.trim().toLowerCase()
}

/** Group raw scans by barcode with linked item details and quantities. */
export async function fetchEbayScanGroups(): Promise<EbayScanGroup[]> {
  const scans = await fetchEbayScans()
  if (scans.length === 0) return []

  const byBarcode = new Map<string, EbayScanRow[]>()
  for (const s of scans) {
    const key = normalizeBarcodeKey(s.barcode_value)
    const list = byBarcode.get(key) ?? []
    list.push(s)
    byBarcode.set(key, list)
  }

  const itemIds = [...new Set(scans.map((s) => s.item_id).filter(Boolean))] as string[]
  const barcodes = [...byBarcode.keys()]
  const [itemsById, itemsByBarcode] = await Promise.all([
    fetchEbayItemsByIds(itemIds),
    fetchEbayItemsByBarcodes(barcodes),
  ])

  const itemById = new Map(itemsById.map((i) => [i.id, i]))
  const itemByBarcode = new Map<string, ItemRecord>()
  for (const item of itemsByBarcode) {
    const code = (item.barcode ?? '').trim()
    if (code) {
      itemByBarcode.set(normalizeBarcodeKey(code), item)
      const digits = code.replace(/\D/g, '')
      if (digits) itemByBarcode.set(normalizeBarcodeKey(digits), item)
    }
  }

  const groups: EbayScanGroup[] = []
  for (const [key, rows] of byBarcode) {
    const sorted = [...rows].sort(
      (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
    )
    const linkedId = sorted.find((r) => r.item_id)?.item_id ?? null
    const item =
      (linkedId ? itemById.get(linkedId) : null) ??
      itemByBarcode.get(key) ??
      itemByBarcode.get(normalizeBarcodeKey(sorted[0].barcode_value.replace(/\D/g, ''))) ??
      null

    groups.push({
      barcode_value: sorted[0].barcode_value,
      scan_count: sorted.length,
      first_scanned_at: sorted[0].scanned_at,
      last_scanned_at: sorted[sorted.length - 1].scanned_at,
      item_id: linkedId ?? item?.id ?? null,
      item,
      scan_ids: sorted.map((r) => r.id),
    })
  }

  return groups.sort(
    (a, b) => new Date(b.last_scanned_at).getTime() - new Date(a.last_scanned_at).getTime()
  )
}

export async function linkEbayScansToItem(barcodeValue: string, itemId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase
    .from(TABLE)
    .update({ item_id: itemId })
    .eq('barcode_value', barcodeValue)
  if (error) throw new Error(error.message)
}

export async function deleteEbayScanGroup(barcodeValue: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.from(TABLE).delete().eq('barcode_value', barcodeValue)
  if (error) throw new Error(error.message)
}
