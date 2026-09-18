import { supabase } from '../lib/supabase'
import {
  fieldsFromRecord,
  normalizeLookupKey,
  nullableFields,
  parseCheckInDocuments,
} from '../partsHelpers'
import {
  dtoolsEditPayload,
  findMatchingDtoolsProduct,
  keepScannedBarcodes,
  parseDtoolsCsv,
  type DtoolsEditFields,
  type DtoolsProduct,
} from '../dtoolsCatalog'
import type { CheckInDocument, PartCheckIn, PartFields, TrackedPart } from '../types'

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
  return (data ?? []).map((row) => asCheckIn(row as PartCheckIn))
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

export async function fetchParts(): Promise<TrackedPart[]> {
  const { data, error } = await requireClient()
    .from('tracked_parts')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as TrackedPart[]
}

export async function fetchDtoolsProducts(): Promise<DtoolsProduct[]> {
  try {
    return await fetchAllRows<DtoolsProduct>('dtools_products', 'csv_row')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/dtools_products|schema cache|relation/i.test(message)) {
      throw new Error('D-Tools library table is missing. Run supabase/add-dtools-products.sql.')
    }
    throw err
  }
}

export async function updateDtoolsProduct(id: string, fields: DtoolsEditFields): Promise<DtoolsProduct> {
  const payload = dtoolsEditPayload(fields)
  const { data, error } = await requireClient()
    .from('dtools_products')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as DtoolsProduct
}

export async function mergeDtoolsCsv(csvText: string): Promise<{ updated: number; inserted: number }> {
  const incoming = parseDtoolsCsv(csvText)
  if (incoming.length === 0) throw new Error('That CSV has no product rows.')
  const existing = await fetchDtoolsProducts()
  const updatesById = new Map<string, DtoolsProduct>()
  const toInsert: Partial<DtoolsProduct>[] = []
  const importedAt = new Date().toISOString()

  for (const record of incoming) {
    const found = findMatchingDtoolsProduct(record as DtoolsProduct, existing)
    if (!found) {
      toInsert.push({ ...record, imported_at: importedAt, source: 'dtools' })
      continue
    }
    const merged = keepScannedBarcodes(found, {
      ...(updatesById.get(found.id) ?? found),
      ...record,
      imported_at: importedAt,
      id: found.id,
      csv_row: found.csv_row,
    } as DtoolsProduct)
    updatesById.set(found.id, merged)
  }

  const toUpdate = [...updatesById.values()]
  const client = requireClient()
  const batchSize = 80
  for (let i = 0; i < toUpdate.length; i += batchSize) {
    const batch = toUpdate.slice(i, i + batchSize)
    const { error } = await client.from('dtools_products').upsert(batch, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }

  let maxRow = existing.reduce((max, row) => Math.max(max, Number(row.csv_row) || 0), 0)
  const inserts = toInsert.map((row) => {
    maxRow += 1
    return { ...row, csv_row: maxRow, imported_at: importedAt, source: 'dtools' }
  })
  for (let i = 0; i < inserts.length; i += batchSize) {
    const batch = inserts.slice(i, i + batchSize)
    const { error } = await client.from('dtools_products').insert(batch)
    if (error) throw new Error(error.message)
  }

  return { updated: toUpdate.length, inserted: inserts.length }
}

export async function fillDtoolsUpcFromCheckIn(fields: PartFields, libraryId?: string | null): Promise<boolean> {
  const upc = normalizeLookupKey(fields.upc_code)
  if (!upc) return false
  const client = requireClient()
  let row: { id: string; upc: string | null } | null = null

  if (libraryId) {
    const { data, error } = await client
      .from('dtools_products')
      .select('id, upc')
      .eq('id', libraryId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    row = data as { id: string; upc: string | null } | null
  }

  if (!row) {
    const ipn = normalizeLookupKey(fields.ipn)
    if (ipn) {
      const { data, error } = await client
        .from('dtools_products')
        .select('id, upc')
        .ilike('part_number', escapeIlikeExact(ipn))
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      row = data as { id: string; upc: string | null } | null
    }
  }

  if (!row) return false
  if (normalizeLookupKey(row.upc ?? '')) return false
  const { error: updateError } = await client.from('dtools_products').update({ upc }).eq('id', row.id)
  if (updateError) throw new Error(updateError.message)
  return true
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

export async function insertPartIfMissing(
  fields: PartFields,
  options?: { missingFromDtools?: boolean },
): Promise<TrackedPart> {
  const existing = await findExistingPart(fields)
  if (existing) {
    if (options?.missingFromDtools && !existing.missing_from_dtools) {
      const { data, error } = await requireClient()
        .from('tracked_parts')
        .update({ missing_from_dtools: true })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data as TrackedPart
    }
    return existing
  }

  const payload = {
    ...nullableFields(fields),
    ...(options?.missingFromDtools ? { missing_from_dtools: true } : {}),
  }
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

const DOCUMENT_BUCKETS = ['checkin-documents', 'po-documents', 'inventory-images']

function asCheckIn(row: PartCheckIn): PartCheckIn {
  return {
    ...row,
    documents: parseCheckInDocuments(row.documents),
  }
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

export async function addCheckInDocuments(
  checkInId: string,
  files: { blob: Blob; name: string }[],
): Promise<PartCheckIn> {
  if (files.length === 0) {
    const { data, error } = await requireClient().from('part_checkins').select('*').eq('id', checkInId).single()
    if (error) throw new Error(error.message)
    return asCheckIn(data as PartCheckIn)
  }

  const client = requireClient()
  const { data: existingRow, error: loadError } = await client
    .from('part_checkins')
    .select('*')
    .eq('id', checkInId)
    .single()
  if (loadError) throw new Error(loadError.message)

  const uploaded: CheckInDocument[] = []
  for (const file of files) {
    uploaded.push(await uploadCheckInFile(checkInId, file.blob, file.name))
  }
  const documents = [...parseCheckInDocuments((existingRow as PartCheckIn).documents), ...uploaded]
  const { data, error } = await client
    .from('part_checkins')
    .update({ documents })
    .eq('id', checkInId)
    .select('*')
    .single()
  if (error) {
    throw new Error(
      /documents|schema cache|column/i.test(error.message)
        ? 'Documents column is missing. Run supabase/add-part-checkin-documents.sql in the Supabase SQL Editor.'
        : error.message,
    )
  }
  return asCheckIn(data as PartCheckIn)
}

export async function updateCheckIn(
  id: string,
  fields: PartFields,
  quantity: number,
): Promise<PartCheckIn> {
  const client = requireClient()
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1
  const matched = await findExistingPart(fields).catch(() => null)
  const { data: existing } = await client.from('part_checkins').select('part_id').eq('id', id).maybeSingle()
  const payload = {
    ...nullableFields(fields),
    quantity: qty,
    part_id: matched?.id ?? (existing as { part_id?: string | null } | null)?.part_id ?? null,
  }
  const first = await client.from('part_checkins').update(payload).eq('id', id).select('*').single()
  if (first.error) {
    if (!/quantity|schema cache|column/i.test(first.error.message)) {
      throw new Error(first.error.message)
    }
    const { quantity: _ignored, ...withoutQty } = payload
    const fallback = await client.from('part_checkins').update(withoutQty).eq('id', id).select('*').single()
    if (fallback.error) throw new Error(fallback.error.message)
    return asCheckIn(fallback.data as PartCheckIn)
  }
  return asCheckIn(first.data as PartCheckIn)
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

export async function updateTrackedPart(id: string, fields: PartFields): Promise<TrackedPart> {
  const payload = nullableFields({ ...fields, po: '' })
  const { data, error } = await requireClient()
    .from('tracked_parts')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as TrackedPart
}

export async function deletePart(id: string): Promise<void> {
  const { error } = await requireClient().from('tracked_parts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export function partFromRow(row: TrackedPart): PartFields {
  return fieldsFromRecord(row)
}
