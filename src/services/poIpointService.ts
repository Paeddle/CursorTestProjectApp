import { supabase } from '../lib/supabase'
import type { ParsedItemLocationRow } from '../lib/parseItemLocationsXlsx'
import { aggregatePoLineReportRows, parseRequestedQuantity } from '../lib/poLineAggregate'
import type { ParsedPoLineItem } from '../lib/parsePoLineReportXlsx'
import type { ParsedJobRefRow } from '../lib/parseJobRefXlsx'
import { clearIpointCache, readIpointCache, writeIpointCache } from '../lib/poIpointCache'
import { findItemLocations, normalizeRefNumber } from '../lib/poIpointMatch'
import type { LocationFileSummary, PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'

const BATCH = 200
/** Supabase/PostgREST returns at most 1000 rows per request unless paginated. */
const PAGE = 1000

const LINE_ITEM_COLUMNS =
  'id,po_number,item_name,job_or_customer,po_date,quantity,source_file,imported_at,created_at'
const LOCATION_COLUMNS = 'id,ref_number,location_name,manufacturer,product_name,quantity,source_file,imported_at,created_at'
const LOCATION_META_COLUMNS = 'ref_number,imported_at,source_file'

async function fetchAllRows<T>(
  table: string,
  orderColumn: string,
  columns = '*'
): Promise<T[]> {
  const { count, error: countErr } = await supabase
    .from(table)
    .select(columns, { count: 'exact', head: true })
  if (countErr) throw new Error(countErr.message)

  const total = count ?? 0
  if (total === 0) return []

  const pageCount = Math.ceil(total / PAGE)
  const pageRequests = Array.from({ length: pageCount }, (_, page) => {
    const from = page * PAGE
    const to = Math.min(from + PAGE - 1, total - 1)
    return supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, to)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        return (data ?? []) as T[]
      })
  })

  const chunks = await Promise.all(pageRequests)
  const out = chunks.flat()

  if (out.length !== total) {
    throw new Error(
      `Loaded ${out.length} of ${total} rows from ${table}. Refresh the page or try again.`
    )
  }
  return out
}

export type PoIpointDataBundle = {
  lineItems: PoLineItem[]
  itemLocations: PoItemLocation[]
  fromCache: boolean
}

/** Line items + room locations (parallel pages, slim columns, optional session cache). */
export async function fetchPoIpointData(options?: {
  useCache?: boolean
}): Promise<PoIpointDataBundle> {
  const useCache = options?.useCache !== false
  const cached = useCache ? readIpointCache() : null

  if (cached) {
    void refreshPoIpointDataInBackground()
    return {
      lineItems: cached.lineItems,
      itemLocations: cached.itemLocations,
      fromCache: true,
    }
  }

  const [lineItems, itemLocations] = await Promise.all([
    fetchPoLineItems(),
    fetchPoItemLocations(),
  ])
  writeIpointCache(lineItems, itemLocations)
  return { lineItems, itemLocations, fromCache: false }
}

async function refreshPoIpointDataInBackground(): Promise<void> {
  try {
    const [lineItems, itemLocations] = await Promise.all([
      fetchPoLineItems(),
      fetchPoItemLocations(),
    ])
    writeIpointCache(lineItems, itemLocations)
  } catch {
    // Background refresh — ignore
  }
}

export function invalidatePoIpointCache(): void {
  clearIpointCache()
}

/** Remove every row for a job ref (handles legacy ref_number formats). */
async function deleteItemLocationsForRef(normRef: string): Promise<void> {
  for (;;) {
    const { data, error } = await supabase
      .from('po_item_locations')
      .select('id')
      .eq('ref_number', normRef)
      .limit(BATCH)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    const { error: delErr } = await supabase
      .from('po_item_locations')
      .delete()
      .in(
        'id',
        data.map((r) => r.id)
      )
    if (delErr) throw new Error(delErr.message)
  }

  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('po_item_locations')
      .select('id, ref_number')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break

    const ids = data
      .filter((r) => normalizeRefNumber(r.ref_number) === normRef)
      .map((r) => r.id)
    if (ids.length) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH)
        const { error: delErr } = await supabase
          .from('po_item_locations')
          .delete()
          .in('id', chunk)
        if (delErr) throw new Error(delErr.message)
      }
      offset = 0
      continue
    }

    if (data.length < PAGE) break
    offset += PAGE
  }
}

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
  return fetchAllRows<PoLineItem>('po_line_items', 'po_number', LINE_ITEM_COLUMNS)
}

export async function fetchPoItemLocations(): Promise<PoItemLocation[]> {
  return fetchAllRows<PoItemLocation>('po_item_locations', 'ref_number', LOCATION_COLUMNS)
}

type LocationMetaRow = Pick<PoItemLocation, 'ref_number' | 'imported_at' | 'source_file'>

/** Accurate per-ref row counts from DB (not limited to first 1000 location rows). */
export async function fetchLocationUploadSummaries(
  jobRefs: PoJobRef[]
): Promise<LocationFileSummary[]> {
  const rows = await fetchAllRows<LocationMetaRow>(
    'po_item_locations',
    'ref_number',
    LOCATION_META_COLUMNS
  )
  const asLocations = rows.map((r) => ({
    id: '',
    ref_number: r.ref_number,
    imported_at: r.imported_at,
    source_file: r.source_file,
    location_name: '',
    manufacturer: null,
    product_name: '',
    quantity: null,
    created_at: '',
  })) as PoItemLocation[]
  return summarizeLocationUploads(asLocations, jobRefs)
}

/** Search location rows in Supabase (works even when the in-memory list is incomplete). */
export async function searchPoItemLocations(query: string): Promise<PoItemLocation[]> {
  const q = query.trim()
  if (!q) return []

  const escaped = q.replace(/[%_\\]/g, '')
  const pattern = `%${escaped}%`
  const out: PoItemLocation[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('po_item_locations')
      .select('*')
      .or(`product_name.ilike.${pattern},manufacturer.ilike.${pattern}`)
      .order('ref_number', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data ?? []) as PoItemLocation[]
    out.push(...chunk)
    if (chunk.length < PAGE) break
    from += PAGE
  }

  return findItemLocations(q, null, out)
}

/** Group location rows by ref → latest upload batch (file name, row count, job link status). */
export function summarizeLocationUploads(
  locations: PoItemLocation[],
  jobRefs: PoJobRef[]
): LocationFileSummary[] {
  const linkedRefs = new Set(jobRefs.map((j) => normalizeRefNumber(j.ref_number)))
  const byRef = new Map<
    string,
    { source_file: string | null; imported_at: string; row_count: number }
  >()

  for (const loc of locations) {
    const ref = normalizeRefNumber(loc.ref_number)
    if (!ref) continue
    const cur = byRef.get(ref)
    if (!cur) {
      byRef.set(ref, {
        source_file: loc.source_file,
        imported_at: loc.imported_at,
        row_count: 1,
      })
      continue
    }
    if (loc.imported_at > cur.imported_at) {
      byRef.set(ref, {
        source_file: loc.source_file,
        imported_at: loc.imported_at,
        row_count: 1,
      })
    } else if (loc.imported_at === cur.imported_at) {
      cur.row_count++
      if (loc.source_file) cur.source_file = loc.source_file
    }
  }

  return [...byRef.entries()]
    .map(([ref_number, v]) => ({
      ref_number,
      source_file: v.source_file,
      row_count: v.row_count,
      imported_at: v.imported_at,
      has_job_ref: linkedRefs.has(ref_number),
    }))
    .sort((a, b) =>
      a.ref_number.localeCompare(b.ref_number, undefined, { numeric: true })
    )
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

  const aggregated = aggregatePoLineReportRows(rows)
  const imported_at = new Date().toISOString()
  const payload = aggregated.map((r) => ({
    po_number: r.po_number,
    item_name: r.item_name,
    job_or_customer: (r.job_or_customer || '').trim() || 'Stock',
    po_date: r.po_date,
    quantity: (() => {
      const n = parseRequestedQuantity(r.quantity)
      return n > 0 ? String(n) : null
    })(),
    source_file: sourceFile,
    imported_at,
  }))
  await insertBatches('po_line_items', payload)
  invalidatePoIpointCache()
  return payload.length
}

export async function importItemLocations(
  refNumber: string,
  rows: ParsedItemLocationRow[],
  sourceFile: string
): Promise<number> {
  const normRef = normalizeRefNumber(refNumber)
  if (!normRef) throw new Error('Invalid ref number in filename.')

  await deleteItemLocationsForRef(normRef)

  const imported_at = new Date().toISOString()
  const payload = rows.map((r) => ({
    ref_number: normRef,
    location_name: r.location_name,
    manufacturer: r.manufacturer,
    product_name: r.product_name,
    quantity: r.quantity,
    source_file: sourceFile,
    imported_at,
  }))
  await insertBatches('po_item_locations', payload)
  invalidatePoIpointCache()
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
