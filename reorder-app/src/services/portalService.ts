import { supabase } from '../lib/supabase'
import type { ReorderRequestRecord } from '../types'
import { getReorderColumnSchema, mapReorderRow, toStatusUpdate } from './reorderSchema'

const TABLE = 'reorder_requests'

export async function fetchOpenReorderRequests(): Promise<ReorderRequestRecord[]> {
  if (!supabase) return []
  await getReorderColumnSchema()

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .in('status', ['pending', 'ordered'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapReorderRow(row as Record<string, unknown>))
}

export async function fetchOrderHistory(): Promise<ReorderRequestRecord[]> {
  if (!supabase) return []
  await getReorderColumnSchema()

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('status', 'received')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapReorderRow(row as Record<string, unknown>))
}

export async function setReorderOrdered(id: string, ordered: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const schema = await getReorderColumnSchema()
  const { error } = await supabase
    .from(TABLE)
    .update(toStatusUpdate(schema, { status: ordered ? 'ordered' : 'pending', ordered }))
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function setReorderReceived(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const schema = await getReorderColumnSchema()
  const { error } = await supabase
    .from(TABLE)
    .update(toStatusUpdate(schema, { status: 'received', ordered: true, received: true }))
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function reopenReorderRequest(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const schema = await getReorderColumnSchema()
  const { error } = await supabase
    .from(TABLE)
    .update(toStatusUpdate(schema, { status: 'ordered', received: false }))
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteReorderRequest(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw new Error(error.message)
}
