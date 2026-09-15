import { supabase } from '../lib/supabase'
import type { ReorderRequestInput, ReorderRequestRecord } from '../types'

export type ReorderColumnSchema = 'inventree' | 'legacy'

let cachedSchema: ReorderColumnSchema | null = null

export async function getReorderColumnSchema(): Promise<ReorderColumnSchema> {
  if (cachedSchema) return cachedSchema
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase.from('reorder_requests').select('ipn').limit(1)
  if (!error) {
    cachedSchema = 'inventree'
    return cachedSchema
  }

  const missingIpn =
    error.code === '42703' || /column .*ipn.* does not exist/i.test(error.message)
  if (missingIpn) {
    cachedSchema = 'legacy'
    return cachedSchema
  }

  throw new Error(error.message)
}

function pickText(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value
    if (value != null && value !== '' && typeof value !== 'object') return String(value)
  }
  return null
}

export function mapReorderRow(row: Record<string, unknown>): ReorderRequestRecord {
  const status = row.status
  const allowed = status === 'ordered' || status === 'received' || status === 'cancelled' ? status : 'pending'

  return {
    id: String(row.id),
    item_id: typeof row.item_id === 'string' ? row.item_id : null,
    ipn: pickText(row, 'ipn', 'part_number'),
    name: pickText(row, 'name', 'item_name'),
    category_name: pickText(row, 'category_name', 'manufacturer'),
    vendor_name: pickText(row, 'vendor_name'),
    barcode_hash: pickText(row, 'barcode_hash', 'barcode'),
    link: pickText(row, 'link', 'description'),
    quantity: Number(row.quantity) || 0,
    job: pickText(row, 'job'),
    requested_by: pickText(row, 'requested_by'),
    notes: pickText(row, 'notes'),
    status: allowed,
    ordered_at: pickText(row, 'ordered_at'),
    received_at: pickText(row, 'received_at'),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export function toInsertRow(input: ReorderRequestInput, schema: ReorderColumnSchema): Record<string, unknown> {
  if (schema === 'inventree') {
    return {
      item_id: input.item_id,
      ipn: input.ipn,
      name: input.name,
      category_name: input.category_name,
      vendor_name: input.vendor_name,
      barcode_hash: input.barcode_hash,
      link: input.link,
      quantity: input.quantity,
      job: input.job,
      requested_by: input.requested_by,
      notes: input.notes,
      status: 'pending',
    }
  }

  return {
    item_id: input.item_id,
    part_number: input.ipn,
    item_name: input.name,
    manufacturer: input.category_name,
    vendor_name: input.vendor_name,
    barcode: input.barcode_hash,
    description: input.link,
    quantity: input.quantity,
    job: input.job,
    requested_by: input.requested_by,
    notes: input.notes,
    status: 'pending',
  }
}

export function toStatusUpdate(
  schema: ReorderColumnSchema,
  patch: { status: ReorderRequestRecord['status']; ordered?: boolean; received?: boolean },
): Record<string, unknown> {
  const row: Record<string, unknown> = { status: patch.status }
  if (schema === 'inventree') {
    if (patch.ordered === true) row.ordered_at = new Date().toISOString()
    if (patch.ordered === false) row.ordered_at = null
    if (patch.received === true) row.received_at = new Date().toISOString()
  }
  return row
}
