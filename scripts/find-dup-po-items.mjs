import { readFile } from 'node:fs/promises'

const text = await readFile('public/po_line_report.csv', 'utf8')
const map = new Map()
for (const line of text.split(/\n/).slice(1)) {
  if (!line.trim()) continue
  const parts = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"') {
      inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  const [po, item, , , , qty, job = ''] = parts
  const key = `${po}|${item}`
  if (!map.has(key)) map.set(key, [])
  map.get(key).push({ qty, job: job.trim() })
}

let multi = 0
for (const [k, arr] of map) {
  if (arr.length > 1) {
    multi++
    if (multi <= 20) console.log(k, arr)
  }
}
console.log('PO+items with multiple rows:', multi)
