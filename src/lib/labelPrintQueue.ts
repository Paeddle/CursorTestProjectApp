import { supabase } from './supabase'
import { sanitizeQueueText } from './labelKey'
import type { PoLabelPrintRow } from '../types/poIpoint'

export type LabelPrintQueueStatus = 'pending' | 'printing' | 'done' | 'failed'

export type LabelPrintQueueRecord = {
  id: string
  batch_id: string
  po_number: string
  item_name: string
  job_name: string | null
  location_name: string | null
  label_key: string | null
  barcode_value: string | null
  status: LabelPrintQueueStatus
  error_message: string | null
  created_at: string
  processed_at: string | null
}

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL) && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function queueRecordToPrintRow(row: LabelPrintQueueRecord): PoLabelPrintRow {
  return {
    key: row.label_key ?? row.id,
    po_number: row.po_number,
    item_name: row.item_name,
    job_name: row.job_name,
    location_name: row.location_name,
    barcode_value: row.barcode_value,
  }
}

export async function queueLabelsForPrint(
  rows: PoLabelPrintRow[]
): Promise<{ batchId: string; queued: number }> {
  if (rows.length === 0) return { batchId: '', queued: 0 }
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Cannot queue labels for remote printing.')
  }

  const batchId = crypto.randomUUID()
  const payload = rows.map((row) => ({
    batch_id: batchId,
    po_number: sanitizeQueueText(row.po_number) ?? row.po_number,
    item_name: sanitizeQueueText(row.item_name) ?? row.item_name,
    job_name: sanitizeQueueText(row.job_name),
    location_name: sanitizeQueueText(row.location_name),
    label_key: sanitizeQueueText(row.key),
    barcode_value: sanitizeQueueText(row.barcode_value ?? null),
    status: 'pending' as const,
  }))

  const { error } = await supabase.from('label_print_queue').insert(payload)
  if (error) throw new Error(error.message)

  return { batchId, queued: rows.length }
}

export async function fetchPendingQueueRows(limit = 100): Promise<LabelPrintQueueRecord[]> {
  const { data, error } = await supabase
    .from('label_print_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as LabelPrintQueueRecord[]
}

export async function fetchOldestPendingBatchId(): Promise<string | null> {
  const { data, error } = await supabase
    .from('label_print_queue')
    .select('batch_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data?.batch_id ?? null
}

export async function fetchPendingBatchRows(batchId: string): Promise<LabelPrintQueueRecord[]> {
  const { data, error } = await supabase
    .from('label_print_queue')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as LabelPrintQueueRecord[]
}

export async function markBatchStatus(
  batchId: string,
  fromStatus: LabelPrintQueueStatus,
  toStatus: LabelPrintQueueStatus,
  errorMessage?: string | null
): Promise<void> {
  const patch: Record<string, unknown> = { status: toStatus }
  if (toStatus === 'done' || toStatus === 'failed') {
    patch.processed_at = new Date().toISOString()
  }
  if (errorMessage !== undefined) {
    patch.error_message = errorMessage
  }

  const { error } = await supabase
    .from('label_print_queue')
    .update(patch)
    .eq('batch_id', batchId)
    .eq('status', fromStatus)

  if (error) throw new Error(error.message)
}

export async function countPendingLabels(): Promise<number> {
  const { count, error } = await supabase
    .from('label_print_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function countFailedLabels(): Promise<number> {
  const { count, error } = await supabase
    .from('label_print_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')

  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function retryFailedQueueItems(): Promise<number> {
  const { data, error } = await supabase
    .from('label_print_queue')
    .update({ status: 'pending', error_message: null, processed_at: null })
    .eq('status', 'failed')
    .select('id')

  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

export async function fetchRecentQueueActivity(limit = 12): Promise<LabelPrintQueueRecord[]> {
  const { data, error } = await supabase
    .from('label_print_queue')
    .select('*')
    .in('status', ['done', 'failed', 'printing'])
    .order('processed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as LabelPrintQueueRecord[]
}
