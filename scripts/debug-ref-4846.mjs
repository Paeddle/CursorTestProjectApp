import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

function loadEnv() {
  const env = {}
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
  return env
}

const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

async function fetchAllForRef(ref) {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from('po_item_locations')
      .select('id,ref_number,product_name,location_name,imported_at,source_file')
      .eq('ref_number', ref)
      .order('imported_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all
}

async function fetchAllLocations() {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from('po_item_locations')
      .select('ref_number,product_name,location_name,imported_at')
      .order('ref_number', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all
}

const exact = await fetchAllForRef('4846')
console.log('exact ref_number=4846:', exact.length)
const byAt = {}
for (const r of exact) byAt[r.imported_at] = (byAt[r.imported_at] || 0) + 1
console.log('by imported_at:', byAt)
console.log(
  'VX80R:',
  exact.filter((r) => /vx80r/i.test(r.product_name || '')).map((r) => ({
    p: r.product_name,
    l: r.location_name,
    at: r.imported_at,
  }))
)

const all = await fetchAllLocations()
console.log('total location rows:', all.length)
const norm4846 = all.filter((r) => String(r.ref_number).replace(/\D/g, '') === '4846')
console.log('normalized 4846 count:', norm4846.length)
console.log(
  'VX80R in all:',
  all
    .filter((r) => /vx80r/i.test(r.product_name || ''))
    .map((r) => ({ ref: r.ref_number, p: r.product_name, l: r.location_name }))
)

// simulate summarize latest batch
const byRef = new Map()
for (const loc of all) {
  const ref = String(loc.ref_number).replace(/\D/g, '') || String(loc.ref_number)
  if (ref !== '4846') continue
  const cur = byRef.get(ref)
  if (!cur) {
    byRef.set(ref, { imported_at: loc.imported_at, row_count: 1 })
  } else if (loc.imported_at > cur.imported_at) {
    byRef.set(ref, { imported_at: loc.imported_at, row_count: 1 })
  } else if (loc.imported_at === cur.imported_at) {
    cur.row_count++
  }
}
console.log('summarize simulation for 4846:', byRef.get('4846'))

const { data: jobRefs } = await sb.from('po_job_refs').select('*').ilike('ref_number', '%4846%')
console.log('job refs for 4846:', jobRefs)

// Simulate fetchAllRows order ref_number asc
async function simulateFetchAllRows() {
  const PAGE = 1000
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from('po_item_locations')
      .select('ref_number,imported_at')
      .order('ref_number', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = data ?? []
    out.push(...chunk)
    console.log('page from', from, 'chunk', chunk.length)
    if (chunk.length < PAGE) break
    from += PAGE
  }
  return out
}

const fetched = await simulateFetchAllRows()
console.log('fetchAllRows simulation total:', fetched.length)

async function firstPageOnly() {
  const { data } = await sb
    .from('po_item_locations')
    .select('ref_number,product_name')
    .order('ref_number', { ascending: true })
    .range(0, 999)
  return data ?? []
}
const page1 = await firstPageOnly()
const p4846 = page1.filter((r) => String(r.ref_number).replace(/\D/g, '') === '4846')
console.log('4846 rows in FIRST PAGE ONLY (old bug):', p4846.length)
console.log(
  'VX80R in first page 4846:',
  p4846.some((r) => /vx80r/i.test(r.product_name || ''))
)
console.log(
  'VX80R in first page all refs:',
  page1.some((r) => /vx80r/i.test(r.product_name || ''))
)
const n4846f = fetched.filter((r) => String(r.ref_number).replace(/\D/g, '') === '4846')
console.log('4846 rows in fetched:', n4846f.length)
const byAt2 = {}
for (const r of n4846f) byAt2[r.imported_at] = (byAt2[r.imported_at] || 0) + 1
console.log('4846 by imported_at in fetched:', byAt2)

const { data: searchHits, error: searchErr } = await sb
  .from('po_item_locations')
  .select('ref_number,product_name,location_name')
  .or('product_name.ilike.%VX80R%,manufacturer.ilike.%VX80R%')
if (searchErr) console.log('search error:', searchErr.message)
else console.log('ilike search VX80R:', searchHits)
