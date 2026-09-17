/**
 * Import D-Tools Cloud Products.csv into public.dtools_products.
 * Usage: node scripts/import-dtools-products.mjs [path/to/Products.csv]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const CSV_TO_COLUMN = {
  Brand: 'brand',
  Model: 'model',
  'Part Number': 'part_number',
  'Short Description': 'short_description',
  Description: 'description',
  Category: 'category',
  Keywords: 'keywords',
  'Image URL': 'image_url',
  MSRP: 'msrp',
  'Unit Cost': 'unit_cost',
  'Unit Price': 'unit_price',
  Taxable: 'taxable',
  Supplier: 'supplier',
  System: 'system',
  Phase: 'phase',
  UPC: 'upc',
  EAN: 'ean',
  ITF: 'itf',
  'Quantity on Hand': 'quantity_on_hand',
  'Minimum Stock Level': 'minimum_stock_level',
  'Reorder Level': 'reorder_level',
  Discontinued: 'discontinued',
  Height: 'height',
  Width: 'width',
  Depth: 'depth',
  Weight: 'weight',
  'Rack Mounted': 'rack_mounted',
  'Rack Units': 'rack_units',
  Amps: 'amps',
  Volts: 'volts',
  Watts: 'watts',
  BTU: 'btu',
  'Installation Hours': 'installation_hours',
  Tax: 'tax',
  'Unit of Measure': 'unit_of_measure',
  Margin: 'margin',
  Markup: 'markup',
  'Length Based': 'length_based',
  'Inventory Value': 'inventory_value',
  'Inherited Labor Items': 'inherited_labor_items',
  'Inherited Accessories': 'inherited_accessories',
  'Item DTIN': 'item_dtin',
  Active: 'active',
  'Created Date': 'created_date',
  'Modified Date': 'modified_date',
}

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

function rowToRecord(row, csvRow) {
  const record = { csv_row: csvRow, imported_at: new Date().toISOString() }
  for (const [header, column] of Object.entries(CSV_TO_COLUMN)) {
    record[column] = emptyToNull(row[header])
  }
  return record
}

async function main() {
  const csvArg = process.argv[2]
  const csvPath = csvArg ?? path.join(repoRoot, 'CSVFiles', 'Products.csv')
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`)
    process.exit(1)
  }

  const env = {
    ...loadEnvFile(path.join(repoRoot, 'deployments', 'digitalocean', '.env.deploy')),
    ...loadEnvFile(path.join(repoRoot, '.env')),
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
    console.error('CSV parse errors:', parsed.errors.slice(0, 8))
    process.exit(1)
  }

  const records = parsed.data.map((row, index) => rowToRecord(row, index + 2))
  console.log(`Parsed ${records.length} rows from ${path.basename(csvPath)}`)

  const supabase = createClient(url, key)
  const { error: deleteError } = await supabase.from('dtools_products').delete().gte('csv_row', 0)
  if (deleteError) {
    console.error('Could not clear previous import:', deleteError.message)
    process.exit(1)
  }

  const batchSize = 200
  let inserted = 0
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase.from('dtools_products').insert(batch)
    if (error) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message)
      process.exit(1)
    }
    inserted += batch.length
    console.log(`Inserted ${inserted}/${records.length}`)
  }

  const { count, error: countError } = await supabase
    .from('dtools_products')
    .select('*', { count: 'exact', head: true })
  if (countError) {
    console.error('Count check failed:', countError.message)
  } else {
    console.log(`Done. dtools_products row count: ${count}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
