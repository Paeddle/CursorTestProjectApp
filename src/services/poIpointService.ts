import { supabase } from '../lib/supabase'
import type { ParsedItemLocationRow } from '../lib/parseItemLocationsXlsx'
import type { ParsedPoLineItem } from '../lib/parsePoLineReportXlsx'
import type { ParsedJobRefRow } from '../lib/parseJobRefXlsx'
import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'

const BATCH = 200

async function insertBatches<T extends Record<string, unknown>>(
  table: string,
  rows: T[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) throw new Error(error.message)
  }
}

export async function fetchPoJobRefs(): Promise<PoJobRef[]> {
  const { data, error } = await supabase
    .from('po_job_refs')
    .select('*')
    .order('job_name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as PoJobRef[]
}

export async function fetchPoLineItems(): Promise<PoLineItem[]> {
  const { data, error } = await supabase
    .from('po_line_items')
    .select('*')
    .order('po_number', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as PoLineItem[]
}

export async function fetchPoItemLocations(): Promise<PoItemLocation[]> {
  const { data, error } = await supabase
    .from('po_item_locations')
    .select('*')
    .order('ref_number', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as PoItemLocation[]
}

export async function importJobRefs(rows: ParsedJobRefRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const now = new Date().toISOString()
  for (const r of rows) {
    const { error } = await supabase.from('po_job_refs').upsert(
      {
        job_name: r.job_name,
        ref_number: r.ref_number,
        updated_at: now,
      },
      { onConflict: 'ref_number' }
    )
    if (error) throw new Error(error.message)
  }
  return rows.length
}

export async function importPoLineReport(
  rows: ParsedPoLineItem[],
  sourceFile: string
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
  await insertBatches('po_line_items', payload)
  return payload.length
}

export async function importItemLocations(
  refNumber: string,
  rows: ParsedItemLocationRow[],
  sourceFile: string
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
  await insertBatches('po_item_locations', payload)
  return payload.length
}

export async function addJobRef(job_name: string, ref_number: string): Promise<PoJobRef> {
  const { data, error } = await supabase
    .from('po_job_refs')
    .insert({ job_name: job_name.trim(), ref_number: ref_number.trim() })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as PoJobRef
}

export async function updateJobRef(
  id: string,
  job_name: string,
  ref_number: string
): Promise<void> {
  const { error } = await supabase
    .from('po_job_refs')
    .update({
      job_name: job_name.trim(),
      ref_number: ref_number.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteJobRef(id: string): Promise<void> {
  const { error } = await supabase.from('po_job_refs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
