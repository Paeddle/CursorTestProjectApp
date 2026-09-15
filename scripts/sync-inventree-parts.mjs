/**
 * Sync InvenTree parts into public.inventree_parts via the InvenTree REST API.
 *
 * Local:
 *   INVENTREE_BASE_URL=https://your-inventree.example
 *   INVENTREE_API_TOKEN=...   (InvenTree → Settings → User Settings → API Tokens)
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env
 *   npm run inventree:sync
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      }),
  )
}

function emptyToNull(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function parseNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function partToRecord(part) {
  const inventreeId = Number(part.pk ?? part.id)
  if (!Number.isFinite(inventreeId)) return null
  const name = emptyToNull(part.name)
  if (!name) return null

  const category =
    emptyToNull(part.category_detail?.name) ||
    emptyToNull(part.category_detail?.pathstring) ||
    emptyToNull(part.category_name) ||
    null

  return {
    inventree_id: inventreeId,
    name,
    creation_date: emptyToNull(part.creation_date)?.slice(0, 10) ?? null,
    active: part.active !== false,
    barcode_hash: emptyToNull(part.barcode_hash),
    category_name: category,
    ipn: emptyToNull(part.IPN ?? part.ipn),
    link: emptyToNull(part.link),
    maximum_stock: parseNumber(part.maximum_stock ?? part.ordering),
    synced_at: new Date().toISOString(),
  }
}

async function fetchAllParts(baseUrl, token) {
  const headers = {
    Authorization: `Token ${token}`,
    Accept: 'application/json',
  }
  const records = []
  let next = `${baseUrl.replace(/\/$/, '')}/api/part/?limit=100&category_detail=true`

  while (next) {
    const res = await fetch(next, { headers })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`InvenTree ${res.status}: ${body.slice(0, 400)}`)
    }
    const json = await res.json()
    const rows = Array.isArray(json) ? json : json.results ?? []
    for (const row of rows) {
      const rec = partToRecord(row)
      if (rec) records.push(rec)
    }
    next = Array.isArray(json) ? null : json.next ?? null
  }

  return records
}

async function main() {
  const env = {
    ...loadEnvFile(path.join(repoRoot, 'deployments', 'digitalocean', '.env.deploy')),
    ...loadEnvFile(path.join(repoRoot, '.env')),
    ...process.env,
  }

  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY
  const inventreeUrl = env.INVENTREE_BASE_URL
  const inventreeToken = env.INVENTREE_API_TOKEN

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  }
  if (!inventreeUrl || !inventreeToken) {
    throw new Error(
      'Missing INVENTREE_BASE_URL or INVENTREE_API_TOKEN. Add them to .env (InvenTree → User Settings → API Tokens).',
    )
  }

  console.log(`Fetching parts from ${inventreeUrl} …`)
  const records = await fetchAllParts(inventreeUrl, inventreeToken)
  console.log(`Fetched ${records.length} parts`)

  const supabase = createClient(supabaseUrl, supabaseKey)
  const batchSize = 100
  let upserted = 0

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase.from('inventree_parts').upsert(batch, {
      onConflict: 'inventree_id',
    })
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
    upserted += batch.length
    console.log(`Upserted ${upserted}/${records.length}`)
  }

  console.log('Sync complete.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
