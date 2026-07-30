import { supabase } from '../lib/supabase'
import type { ReorderRequestRecord } from '../types'

const TABLE = 'reorder_requests'

const SELECT_COLUMNS =
  'id, item_id, ipn, name, category_name, vendor_name, barcode_hash, link, quantity, job, requested_by, notes, status, ordered_at, received_at, created_at, updated_at'

export async function fetchOpenReorderRequests(): Promise<ReorderRequestRecord[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_COLUMNS)
    .in('status', ['pending', 'ordered'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as ReorderRequestRecord[]
}

export async function fetchOrderHistory(): Promise<ReorderRequestRecord[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_COLUMNS)
    .eq('status', 'received')
    .order('received_at', { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as ReorderRequestRecord[]
}

export async function setReorderOrdered(id: string, ordered: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from(TABLE)
    .update({
      status: ordered ? 'ordered' : 'pending',
      ordered_at: ordered ? new Date().toISOString() : null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function setReorderReceived(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from(TABLE)
    .update({
      status: 'received',
      received_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
}
