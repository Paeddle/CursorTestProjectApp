/**
 * Import InvenTree part CSV into public.inventree_parts.
 * Usage: node scripts/import-inventree-parts.mjs [path/to/file.csv]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
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
      })
  )
}

function parseBool(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no' || v === '') return false
  return Boolean(value)
}

function emptyToNull(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function parseDate(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  return trimmed.slice(0, 10)
}

function parseNumber(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function rowToRecord(row) {
  const inventreeId = parseInt(String(row.ID ?? '').trim(), 10)
  if (!Number.isFinite(inventreeId)) return null

  const name = emptyToNull(row.Name)
  if (!name) return null

  return {
    inventree_id: inventreeId,
    name,
    creation_date: parseDate(row['Creation Date']),
    active: parseBool(row.Active),
    barcode_hash: emptyToNull(row['Barcode Hash']),
    category_name: emptyToNull(row['Category Name']),
    ipn: emptyToNull(row.IPN),
    link: emptyToNull(row.Link),
    maximum_stock: parseNumber(row['Maximum Stock']),
    synced_at: new Date().toISOString(),
  }
}

async function main() {
  const csvArg = process.argv[2]
  const csvPath =
    csvArg ??
    path.join(repoRoot, 'CSVFiles', 'InvenTree_Part_2026-07-30.csv')

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`)
    process.exit(1)
  }

  const env = {
    ...loadEnvFile(path.join(repoRoot, 'deployments', 'digitalocean', '.env.deploy')),
    ...loadEnvFile(path.join(repoRoot, '.env')),
    ...loadEnvFile(path.join(repoRoot, 'scanner-app', '.env')),
  }
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
    process.exit(1)
  }

  const csvText = fs.readFileSync(csvPath, 'utf8')
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  if (parsed.errors.length) {
    console.error('CSV parse errors:', parsed.errors.slice(0, 5))
    process.exit(1)
  }

  const records = parsed.data.map(rowToRecord).filter(Boolean)
  console.log(`Parsed ${records.length} rows from ${path.basename(csvPath)}`)

  const supabase = createClient(url, key)
  const batchSize = 100
  let upserted = 0

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase.from('inventree_parts').upsert(batch, {
      onConflict: 'inventree_id',
    })
    if (error) {
      console.error(`Batch ${i / batchSize + 1} failed:`, error.message)
      process.exit(1)
    }
    upserted += batch.length
    console.log(`Upserted ${upserted}/${records.length}`)
  }

  const { count, error: countError } = await supabase
    .from('inventree_parts')
    .select('*', { count: 'exact', head: true })
  if (countError) {
    console.error('Count check failed:', countError.message)
  } else {
    console.log(`Done. inventree_parts row count: ${count}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
