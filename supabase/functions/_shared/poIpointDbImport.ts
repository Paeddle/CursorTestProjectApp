import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type {
  ParsedItemLocationRow,
  ParsedJobRefRow,
  ParsedPoLineItem,
} from './poIpointParsers.ts'

const BATCH = 200

export function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

async function insertBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) throw new Error(error.message)
  }
}

export async function importJobRefsDb(
  supabase: SupabaseClient,
  rows: ParsedJobRefRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const now = new Date().toISOString()
  for (const r of rows) {
    const { error } = await supabase.from('po_job_refs').upsert(
      { job_name: r.job_name, ref_number: r.ref_number, updated_at: now },
      { onConflict: 'ref_number' },
    )
    if (error) throw new Error(error.message)
  }
  return rows.length
}

export async function importPoLineReportDb(
  supabase: SupabaseClient,
  rows: ParsedPoLineItem[],
  sourceFile: string,
): Promise<number> {
  const { error: delErr } = await supabase
    .from('po_line_items')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (delErr) throw new Error(delErr.message)

  const imported_at = new Date().toISOString()
  const payload = rows.map((r) => ({
    po_number: r.po_number,
    item_name: r.item_name,
    job_or_customer: r.job_or_customer || null,
    po_date: r.po_date,
    quantity: r.quantity || null,
    source_file: sourceFile,
    imported_at,
  }))
  await insertBatches(supabase, 'po_line_items', payload)
  return payload.length
}

export async function importItemLocationsDb(
  supabase: SupabaseClient,
  refNumber: string,
  rows: ParsedItemLocationRow[],
  sourceFile: string,
): Promise<number> {
  const { error: delErr } = await supabase
    .from('po_item_locations')
    .delete()
    .eq('ref_number', refNumber)
  if (delErr) throw new Error(delErr.message)

  const imported_at = new Date().toISOString()
  const payload = rows.map((r) => ({
    ref_number: refNumber,
    location_name: r.location_name,
    manufacturer: r.manufacturer,
    product_name: r.product_name,
    quantity: r.quantity,
    source_file: sourceFile,
    imported_at,
  }))
  await insertBatches(supabase, 'po_item_locations', payload)
  return payload.length
}
