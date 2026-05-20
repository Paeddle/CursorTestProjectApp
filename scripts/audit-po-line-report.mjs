/**
 * Audit PO Line Report: raw parse (no aggregate), multi-customer conflicts, qty issues.
 * Usage: node scripts/audit-po-line-report.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function preprocessPoLineReportText(text) {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const merged = []
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]
    while (i + 1 < raw.length && line.includes('PO:') && !/Item:/i.test(line)) {
      i++
      line += ` ${raw[i]}`
    }
    while (i + 1 < raw.length && /Item:/i.test(line) && !/For:/i.test(line)) {
      i++
      line += ` ${raw[i]}`
    }
    merged.push(line)
  }
  return merged.join('\n')
}

function parseCustomerFromLine(trimmed) {
  if (!trimmed.startsWith('Customer:')) return null
  const afterLabel = trimmed.slice(9).trim()
  if (!afterLabel || /^\d/.test(afterLabel)) return null
  const customerRegex = /^Customer:(.+?)\s+\d+\s+\d+\s+/
  const match = trimmed.match(customerRegex)
  if (match) return match[1].trim()
  return afterLabel.replace(/\s+\d+(\s+\d+)*(\s+\$[\d,.]+)*.*$/, '').trim() || null
}

function parseForTail(tail) {
  const t = tail.trim()
  const core = t.replace(/\s+\$[\d,.]+(?:\s+\$[\d,.]+)*\s*[\d.]*\s*$/i, '').trim()
  let m = core.match(/^(.+?)\s+(\d+)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) return { forType: m[1].trim(), quantity: m[2] }
  m = core.match(/^(.+?)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) return { forType: m[1].trim(), quantity: m[2] }
  m = core.match(/^(.+?)\s+(\d+)(?:\s|$)/)
  if (m) return { forType: m[1].trim(), quantity: m[2] }
  return { forType: core, quantity: '' }
}

const FIELD_SEP = '[\\|\\t\\s]+'

function parsePoSegment(segment, currentCustomer) {
  const header = new RegExp(
    `PO:(\\d+)\\s*${FIELD_SEP}\\s*Item:([^|\\t]+?)\\s*${FIELD_SEP}\\s*For:(.+)`,
    'i'
  ).exec(segment)
  if (!header) return null
  const { forType, quantity } = parseForTail(header[3])
  return {
    po_number: `PO-${header[1]}`,
    item_name: header[2].trim(),
    quantity,
    job_or_customer: currentCustomer,
    forType,
  }
}

function parseRaw(text) {
  const normalized = preprocessPoLineReportText(text)
  const rows = []
  let currentCustomer = ''
  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim()
    const customer = parseCustomerFromLine(trimmed)
    if (customer !== null) {
      currentCustomer = customer
      continue
    }
    if (!/PO:\d+/i.test(trimmed) || !/Item:/i.test(trimmed)) continue
    for (const segment of trimmed
      .split(/(?=PO:\d+)/i)
      .map((s) => s.trim())
      .filter((s) => /^PO:\d+/i.test(s))) {
      const row = parsePoSegment(segment, currentCustomer)
      if (row) rows.push(row)
    }
  }
  return rows
}

function aggregate(rows) {
  const buckets = new Map()
  for (const row of rows) {
    const key = `${row.po_number}\0${row.item_name.toLowerCase()}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        ...row,
        qty: Number(row.quantity) || 0,
        jobs: new Set([row.job_or_customer || 'Stock']),
      })
      continue
    }
    const b = buckets.get(key)
    b.qty += Number(row.quantity) || 0
    b.jobs.add(row.job_or_customer || 'Stock')
    b.quantity = String(b.qty)
    b.job_or_customer =
      [...b.jobs].filter((j) => j).length > 1 ? 'Multiple customers' : [...b.jobs][0]
  }
  return [...buckets.values()]
}

const buf = await readFile(join(root, 'POInfoPageFiles', 'POLineReport.pdf'))
const parser = new PDFParse({ data: new Uint8Array(buf) })
const text = preprocessPoLineReportText((await parser.getText())?.text ?? '')
const raw = parseRaw(text)

console.log('=== PO-12087 raw rows ===')
for (const r of raw.filter((x) => x.po_number === 'PO-12087')) {
  console.log(r.item_name, 'qty', r.quantity, '|', r.job_or_customer.slice(0, 60))
}

console.log('\n=== PO-12087 PFD-46 all raw ===')
for (const r of raw.filter((x) => x.item_name.includes('PFD-46'))) {
  console.log(r.po_number, 'qty', r.quantity, '|', r.job_or_customer)
}

console.log('\n=== Aggregated multi-customer same PO+item ===')
const agg = aggregate(raw)
const conflicts = agg.filter((a) => a.jobs && a.jobs.size > 1)
console.log('count', conflicts.length)
for (const a of conflicts.slice(0, 25)) {
  console.log(a.po_number, a.item_name, 'qty', a.quantity, 'jobs:', [...a.jobs].join(' | '))
}

console.log('\n=== Zero/missing qty (raw) ===')
const badQty = raw.filter((r) => !r.quantity || r.quantity === '0')
console.log('count', badQty.length, 'samples:', badQty.slice(0, 8))

// Search brandner/bottcher near PFD in text
const idx = text.toLowerCase().indexOf('pfd-46')
if (idx >= 0) {
  console.log('\n=== PDF context around PFD-46 ===')
  console.log(text.slice(Math.max(0, idx - 200), idx + 200))
}

await writeFile(
  join(root, 'scripts', 'audit-po-line-raw.json'),
  JSON.stringify({ rawCount: raw.length, conflicts: conflicts.map((c) => ({
    po: c.po_number,
    item: c.item_name,
    qty: c.quantity,
    jobs: [...c.jobs],
  })) }, null, 2)
)
