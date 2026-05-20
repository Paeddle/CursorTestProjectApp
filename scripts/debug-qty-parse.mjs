import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Dynamic import won't work for ts easily - duplicate full pipeline from parsePoLineReport

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

function parseForTail(tail) {
  const t = tail.trim()
  const core = t.replace(/\s+\$[\d,.]+(?:\s+\$[\d,.]+)*\s*[\d.]*\s*$/i, '').trim()
  let m = core.match(/^(.+?)\s+(\d+)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) return { quantity: m[2] }
  m = core.match(/^(.+?)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) return { quantity: m[2] }
  m = core.match(/^(.+?)\s+(\d+)(?:\s|$)/)
  if (m) return { quantity: m[2] }
  return { quantity: '' }
}

const FIELD_SEP = '[\\|\\t\\s]+'

function parsePoSegment(segment, currentCustomer) {
  const header = new RegExp(
    `PO:(\\d+)\\s*${FIELD_SEP}\\s*Item:([^|\\t]+?)\\s*${FIELD_SEP}\\s*For:(.+)`,
    'i'
  ).exec(segment)
  if (!header) return null
  const { quantity } = parseForTail(header[3])
  return {
    po_number: `PO-${header[1]}`,
    item_name: header[2].trim(),
    quantity,
    job_or_customer: currentCustomer,
  }
}

function parseText(text) {
  const normalized = preprocessPoLineReportText(text)
  const rows = []
  let currentCustomer = ''
  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Customer:')) {
      currentCustomer = trimmed.slice(9).trim().replace(/\s+\d+(\s+\d+)*(\s+\$[\d,.]+)*.*$/, '').trim()
      continue
    }
    if (!/PO:\d+/i.test(trimmed) || !/Item:/i.test(trimmed)) continue
    for (const segment of trimmed.split(/(?=PO:\d+)/i).map((s) => s.trim()).filter((s) => /^PO:\d+/i.test(s))) {
      const row = parsePoSegment(segment, currentCustomer)
      if (row) rows.push(row)
    }
  }
  return rows
}

const buf = await readFile(join(__dirname, '..', 'POInfoPageFiles', 'POLineReport.pdf'))
const parser = new PDFParse({ data: new Uint8Array(buf) })
const pdfText = (await parser.getText())?.text ?? ''
const rows = parseText(pdfText)
const zeroQty = rows.filter((r) => !r.quantity || r.quantity === '0')
const withQty = rows.filter((r) => r.quantity && r.quantity !== '0')
console.log('total parsed (no aggregate):', rows.length)
console.log('with qty:', withQty.length, 'samples:', withQty.slice(0, 5))
console.log('empty/zero qty:', zeroQty.length, 'samples:', zeroQty.slice(0, 5))

// OLD regex (pipe only)
function parseOld(segment) {
  const header = /PO:(\d+)\s*[\|\t]\s*Item:([^|\t]+?)\s*[\|\t]\s*For:(.+)/i.exec(segment)
  if (!header) return null
  return parseForTail(header[3]).quantity
}
let oldOk = 0
for (const line of pdfText.split(/\n/)) {
  for (const seg of line.split(/(?=PO:\d+)/i)) {
    if (parseOld(seg.trim())) oldOk++
  }
}
console.log('OLD pipe-only matches:', oldOk)
