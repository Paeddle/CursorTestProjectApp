/**
 * Export public.dtools_products to a D-Tools Cloud Products.csv.
 * Usage: node scripts/export-dtools-products.mjs [path/to/out.csv]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const COLUMNS = [
  ['Brand', 'brand'],
  ['Model', 'model'],
  ['Part Number', 'part_number'],
  ['Short Description', 'short_description'],
  ['Description', 'description'],
  ['Category', 'category'],
  ['Keywords', 'keywords'],
  ['Image URL', 'image_url'],
  ['MSRP', 'msrp'],
  ['Unit Cost', 'unit_cost'],
  ['Unit Price', 'unit_price'],
  ['Taxable', 'taxable'],
  ['Supplier', 'supplier'],
  ['System', 'system'],
  ['Phase', 'phase'],
  ['UPC', 'upc'],
  ['EAN', 'ean'],
  ['ITF', 'itf'],
  ['Quantity on Hand', 'quantity_on_hand'],
  ['Minimum Stock Level', 'minimum_stock_level'],
  ['Reorder Level', 'reorder_level'],
  ['Discontinued', 'discontinued'],
  ['Height', 'height'],
  ['Width', 'width'],
  ['Depth', 'depth'],
  ['Weight', 'weight'],
  ['Rack Mounted', 'rack_mounted'],
  ['Rack Units', 'rack_units'],
  ['Amps', 'amps'],
  ['Volts', 'volts'],
  ['Watts', 'watts'],
  ['BTU', 'btu'],
  ['Installation Hours', 'installation_hours'],
  ['Tax', 'tax'],
  ['Unit of Measure', 'unit_of_measure'],
  ['Margin', 'margin'],
  ['Markup', 'markup'],
  ['Length Based', 'length_based'],
  ['Inventory Value', 'inventory_value'],
  ['Inherited Labor Items', 'inherited_labor_items'],
  ['Inherited Accessories', 'inherited_accessories'],
  ['Item DTIN', 'item_dtin'],
  ['Active', 'active'],
  ['Created Date', 'created_date'],
  ['Modified Date', 'modified_date'],
]

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

async function fetchAll(supabase) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('dtools_products')
      .select('*')
      .order('csv_row', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}

async function main() {
  const outPath =
    process.argv[2] ?? path.join(repoRoot, 'CSVFiles', 'Products-for-dtools.csv')

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

  const supabase = createClient(url, key)
  const rows = (await fetchAll(supabase)).filter((row) => (row.source ?? 'dtools') !== 'local')
  const csvRows = rows.map((row) => {
    const out = {}
    for (const [header, key] of COLUMNS) out[header] = row[key] ?? ''
    return out
  })
  const csv = Papa.unparse(csvRows, {
    columns: COLUMNS.map(([header]) => header),
    newline: '\r\n',
  })
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${csv}\r\n`)
  console.log(`Wrote ${rows.length} products to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
