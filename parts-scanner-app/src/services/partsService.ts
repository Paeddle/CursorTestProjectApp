import { supabase } from '../lib/supabase'
import {
  fieldsFromRecord,
  normalizeLookupKey,
  nullableFields,
  parseCheckInDocuments,
} from '../partsHelpers'
import { dtoolsToPartFields, type DtoolsProduct } from '../dtoolsCatalog'
import type { CheckInDocument, PartCheckIn, PartFields, TrackedPart } from '../types'

const DOCUMENT_BUCKETS = ['checkin-documents', 'po-documents', 'inventory-images']

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function escapeIlikeExact(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function normalizeQuantity(value: number | string | undefined): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  if (!Number.isFinite(n) || (n ?? 0) < 1) return 1
  return Math.min(99999, Math.round(n as number))
}

function asCheckIn(row: PartCheckIn): PartCheckIn {
  return {
    ...row,
    quantity: normalizeQuantity(row.quantity ?? 1),
    documents: parseCheckInDocuments(row.documents),
  }
}

function storagePathFromPublicUrl(url: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (!m) return null
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

export async function fetchCheckIns(): Promise<PartCheckIn[]> {
  const { data, error } = await requireClient()
    .from('part_checkins')
    .select('*')
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => asCheckIn(row as PartCheckIn))
}

export async function fetchParts(): Promise<TrackedPart[]> {
  const { data, error } = await requireClient()
    .from('tracked_parts')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as TrackedPart[]
}

async function fetchAllRows<T>(table: string, orderColumn: string): Promise<T[]> {
  const client = requireClient()
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}

export async function fetchDtoolsProducts(): Promise<DtoolsProduct[]> {
  try {
    return await fetchAllRows<DtoolsProduct>('dtools_products', 'csv_row')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/dtools_products|schema cache|relation/i.test(message)) return []
    throw err
  }
}

export function dtoolsAsTrackedPart(row: DtoolsProduct): TrackedPart {
  const fields = dtoolsToPartFields(row)
  return {
    ...fields,
    id: row.id,
    created_at: row.imported_at,
    updated_at: row.imported_at,
  }
}

export function mergeCatalog(tracked: TrackedPart[], library: DtoolsProduct[]): TrackedPart[] {
  const mapped = library.map(dtoolsAsTrackedPart)
  const seenUpc = new Set(mapped.map((p) => normalizeLookupKey(p.upc_code)).filter(Boolean))
  const seenIpn = new Set(mapped.map((p) => normalizeLookupKey(p.ipn)).filter(Boolean))
  const extras = tracked.filter((p) => {
    const upc = normalizeLookupKey(p.upc_code)
    const ipn = normalizeLookupKey(p.ipn)
    if (upc && seenUpc.has(upc)) return false
    if (ipn && seenIpn.has(ipn)) return false
    return true
  })
  return [...mapped, ...extras]
}

export function findDtoolsInList(library: DtoolsProduct[], barcode: string): DtoolsProduct | null {
  const key = normalizeLookupKey(barcode).toLowerCase()
  if (!key) return null
  return (
    library.find((row) => normalizeLookupKey(row.upc ?? '').toLowerCase() === key) ??
    library.find((row) => normalizeLookupKey(row.ean ?? '').toLowerCase() === key) ??
    library.find((row) => normalizeLookupKey(row.itf ?? '').toLowerCase() === key) ??
    library.find((row) => normalizeLookupKey(row.part_number ?? '').toLowerCase() === key) ??
    null
  )
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

export async function uploadCheckInFile(
  checkInId: string,
  blob: Blob,
  fileName: string,
): Promise<CheckInDocument> {
  const client = requireClient()
  const safeName = fileName.replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '') || 'document.jpg'
  const ext = safeName.includes('.') ? safeName.split('.').pop() : blob.type.includes('png') ? 'png' : 'jpg'
  const path = `${checkInId}/${Date.now()}_${safeName.replace(/\.[^.]+$/, '')}.${ext}`
  let lastError = 'Could not upload document.'
  for (const bucket of DOCUMENT_BUCKETS) {
    const { error } = await client.storage.from(bucket).upload(path, blob, {
      upsert: false,
      contentType: blob.type || 'image/jpeg',
    })
    if (!error) {
      const { data } = client.storage.from(bucket).getPublicUrl(path)
      return { name: fileName, url: data.publicUrl }
    }
    lastError = error.message
  }
  throw new Error(
    `${lastError} Run supabase/add-part-checkin-documents.sql in the Supabase SQL Editor if the check-in documents bucket is missing.`,
  )
}

export async function insertCheckIn(
  fields: PartFields,
  checkInDate: string,
  partId: string | null,
  extras?: { quantity?: number; files?: { blob: Blob; name: string }[] },
): Promise<PartCheckIn> {
  const client = requireClient()
  const quantity = normalizeQuantity(extras?.quantity ?? 1)
  const base = {
    ...nullableFields(fields),
    part_id: partId,
    check_in_date: checkInDate || null,
  }
  const withQty = { ...base, quantity, documents: [] as CheckInDocument[] }

  let inserted: PartCheckIn
  const first = await client.from('part_checkins').insert(withQty).select('*').single()
  if (first.error) {
    if (!/quantity|documents|schema cache|column/i.test(first.error.message)) {
      throw new Error(first.error.message)
    }
    const fallback = await client.from('part_checkins').insert(base).select('*').single()
    if (fallback.error) throw new Error(fallback.error.message)
    inserted = asCheckIn(fallback.data as PartCheckIn)
    if (extras?.files?.length) {
      throw new Error(
        'Check-in saved, but quantity/documents columns are missing. Run supabase/add-part-checkin-documents.sql in the Supabase SQL Editor, then try again.',
      )
    }
    return inserted
  }
  inserted = asCheckIn(first.data as PartCheckIn)

  const files = extras?.files ?? []
  if (files.length === 0) return inserted

  const documents: CheckInDocument[] = []
  for (const file of files) {
    documents.push(await uploadCheckInFile(inserted.id, file.blob, file.name))
  }
  const updated = await client
    .from('part_checkins')
    .update({ documents })
    .eq('id', inserted.id)
    .select('*')
    .single()
  if (updated.error) {
    throw new Error(
      `Files uploaded, but the check-in record could not be updated: ${updated.error.message}. Run supabase/add-part-checkin-documents.sql.`,
    )
  }
  return asCheckIn(updated.data as PartCheckIn)
}

export async function deleteCheckIn(id: string): Promise<void> {
  const client = requireClient()
  const { data } = await client.from('part_checkins').select('documents').eq('id', id).maybeSingle()
  const documents = parseCheckInDocuments(data?.documents)
  const { error } = await client.from('part_checkins').delete().eq('id', id)
  if (error) throw new Error(error.message)
  for (const doc of documents) {
    const loc = storagePathFromPublicUrl(doc.url)
    if (!loc) continue
    await client.storage.from(loc.bucket).remove([loc.path]).catch(() => undefined)
  }
}

export async function deletePart(id: string): Promise<void> {
  const { error } = await requireClient().from('tracked_parts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export function partFromRow(row: TrackedPart): PartFields {
  return fieldsFromRecord(row)
}
