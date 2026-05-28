import { supabase } from './supabase'
import type { LabelStudioItem } from '../types/labelStudio'

function fieldsFromInventory(row: Record<string, unknown>): Record<string, string> {
  const f: Record<string, string> = {}
  const set = (key: string, val: unknown) => {
    const s = val != null ? String(val).trim() : ''
    if (s) f[key] = s
  }
  set('item', row.item)
  set('part_number', row.part_number)
  set('manufacturer', row.manufacturer)
  set('barcode', row.barcode)
  set('description', row.description_customer)
  set('category', row.category)
  set('vendor', row.vendor_name)
  set('price', row.unit_price)
  set('color', row.color)
  set('unit', row.unit)
  set('type', row.type)
  return f
}

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

function fieldsFromBarcode(row: Record<string, unknown>): Record<string, string> {
  const f: Record<string, string> = {}
  const set = (key: string, val: unknown) => {
    const s = val != null ? String(val).trim() : ''
    if (s) f[key] = s
  }
  set('barcode', row.barcode_value)
  set('item', row.item_name)
  set('manufacturer', row.manufacturer)
  set('part_number', row.part_number)
  return f
}

function fieldsFromPoLine(row: Record<string, unknown>): Record<string, string> {
  const f: Record<string, string> = {}
  const set = (key: string, val: unknown) => {
    const s = val != null ? String(val).trim() : ''
    if (s) f[key] = s
  }
  set('po_number', row.po_number)
  set('item', row.item_name)
  set('job', row.job_or_customer)
  set('quantity', row.quantity)
  return f
}

export async function fetchLabelStudioInventoryItems(limit = 500): Promise<LabelStudioItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .order('item', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const fields = fieldsFromInventory(row)
    const title = fields.item || fields.part_number || 'Inventory item'
    return {
      id: `inv-${row.id}`,
      source: 'inventory' as const,
      title,
      fields,
    }
  })
}

export async function fetchLabelStudioLocationItems(limit = 500): Promise<LabelStudioItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('po_item_locations')
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

export async function fetchLabelStudioBarcodeItems(limit = 500): Promise<LabelStudioItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('barcode_catalog')
    .select('*')
    .order('item_name', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const fields = fieldsFromBarcode(row)
    const title = fields.item || fields.barcode || 'Barcode item'
    return {
      id: `bc-${row.id}`,
      source: 'barcode' as const,
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
    const fields = fieldsFromPoLine(row)
    const title = [fields.po_number, fields.item].filter(Boolean).join(' — ') || 'PO line'
    return {
      id: `po-${row.id}`,
      source: 'po_line' as const,
      title,
      fields,
    }
  })
}

export function filterLabelStudioItems(items: LabelStudioItem[], query: string): LabelStudioItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true
    return Object.values(item.fields).some((v) => v.toLowerCase().includes(q))
  })
}
