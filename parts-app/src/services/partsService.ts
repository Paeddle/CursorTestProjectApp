import { supabase } from '../lib/supabase'
import {
  fieldsFromRecord,
  normalizeLookupKey,
  nullableFields,
  parseCheckInDocuments,
} from '../partsHelpers'
import type { PartCheckIn, PartFields, TrackedPart } from '../types'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function escapeIlikeExact(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export async function fetchCheckIns(): Promise<PartCheckIn[]> {
  const { data, error } = await requireClient()
    .from('part_checkins')
    .select('*')
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    ...(row as PartCheckIn),
    documents: parseCheckInDocuments((row as PartCheckIn).documents),
  }))
}

export async function fetchParts(): Promise<TrackedPart[]> {
  const { data, error } = await requireClient()
    .from('tracked_parts')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as TrackedPart[]
}

export async function findExistingPart(fields: PartFields): Promise<TrackedPart | null> {
  const client = requireClient()
  const upc = normalizeLookupKey(fields.upc_code)
  if (upc) {
    const { data, error } = await client
      .from('tracked_parts')
      .select('*')
      .ilike('upc_code', escapeIlikeExact(upc))
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return data as TrackedPart
  }

  const ipn = normalizeLookupKey(fields.ipn)
  if (ipn) {
    const { data, error } = await client
      .from('tracked_parts')
      .select('*')
      .ilike('ipn', escapeIlikeExact(ipn))
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return data as TrackedPart
  }

  return null
}

export async function insertPartIfMissing(fields: PartFields): Promise<TrackedPart> {
  const existing = await findExistingPart(fields)
  if (existing) return existing

  const payload = nullableFields(fields)
  const { data, error } = await requireClient()
    .from('tracked_parts')
    .insert(payload)
    .select('*')
    .single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const again = await findExistingPart(fields)
      if (again) return again
    }
    throw new Error(error.message)
  }
  return data as TrackedPart
}

export async function insertCheckIn(
  fields: PartFields,
  checkInDate: string,
  partId: string | null,
): Promise<PartCheckIn> {
  const payload = {
    ...nullableFields(fields),
    part_id: partId,
    check_in_date: checkInDate || null,
  }
  const { data, error } = await requireClient()
    .from('part_checkins')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PartCheckIn
}

export async function deleteCheckIn(id: string): Promise<void> {
  const client = requireClient()
  const { data } = await client.from('part_checkins').select('documents').eq('id', id).maybeSingle()
  const documents = parseCheckInDocuments(data?.documents)
  const { error } = await client.from('part_checkins').delete().eq('id', id)
  if (error) throw new Error(error.message)
  for (const doc of documents) {
    try {
      const u = new URL(doc.url)
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
      if (!m) continue
      await client.storage.from(decodeURIComponent(m[1])).remove([decodeURIComponent(m[2])])
    } catch {
      /* ignore storage cleanup */
    }
  }
}

export async function deletePart(id: string): Promise<void> {
  const { error } = await requireClient().from('tracked_parts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export function partFromRow(row: TrackedPart): PartFields {
  return fieldsFromRecord(row)
}
