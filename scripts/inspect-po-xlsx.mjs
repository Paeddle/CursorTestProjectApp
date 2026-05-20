import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

for (const rel of ['POInfoPageFiles/4973.xlsx', 'POInfoPageFiles/4152.xlsx']) {
  const buf = await readFile(join(root, rel))
  const wb = XLSX.read(buf)
  console.log('\n===', rel, 'sheets:', wb.SheetNames, '===')
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' })
    console.log('sheet', name, 'rows', rows.length)
    rows.slice(0, 6).forEach((r, i) => console.log(' ', i, r))
    const hdr = rows.find((r) => r.some((c) => /req|item|po/i.test(String(c))))
    if (hdr) console.log(' header row?', hdr)
  }
}
