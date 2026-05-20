import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Inline copy of preprocess + parse logic to test Req extraction
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

function parseOld(text) {
  const poRegex = /PO:(\d+)\s*[\|\t]\s*Item:([^|\t]+?)\s*[\|\t]\s*For:([^\d$]+?)(\d+)/gi
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    let m
    const re = new RegExp(poRegex.source, poRegex.flags)
    while ((m = re.exec(line)) !== null) {
      rows.push({ po: `PO-${m[1]}`, item: m[2].trim(), qty: m[4], raw: line.slice(0, 120) })
    }
  }
  return rows
}

function parseReq(text) {
  // Req = first number after For: type; optional second is Pending Rec.
  const poRegex =
    /PO:(\d+)\s*[\|\t]\s*Item:([^|\t]+?)\s*[\|\t]\s*For:([^|\t\d$]+?)\s+(\d+)(?:\s+(\d+))?(?:\s+\d)/gi
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    let m
    const re = new RegExp(poRegex.source, poRegex.flags)
    while ((m = re.exec(line)) !== null) {
      rows.push({
        po: `PO-${m[1]}`,
        item: m[2].trim(),
        req: m[4],
        pending: m[5] ?? '',
        raw: line.slice(0, 120),
      })
    }
  }
  return rows
}

async function extractPdfLines() {
  const buf = await readFile(join(__dirname, '..', 'POInfoPageFiles', 'POLineReport.pdf'))
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const lines = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    lines.push(content.items.map((i) => i.str).join(' '))
  }
  return preprocessPoLineReportText(lines.join('\n'))
}

const text = await extractPdfLines()
const oldRows = parseOld(text)
const newRows = parseReq(text)

const pick = (rows) =>
  rows.filter((r) =>
    ['PO-12094', 'PO-12065', 'PO-12025'].includes(r.po) &&
    /VX80R|HRST-8ANS|CEN-GW1|MX66/.test(r.item)
  )

console.log('OLD parser samples:')
console.log(pick(oldRows))
console.log('\nNEW Req parser samples:')
console.log(pick(newRows))

// mismatches
let mism = 0
for (const n of newRows) {
  const o = oldRows.find((x) => x.po === n.po && x.item === n.item)
  if (o && o.qty !== n.req) {
    mism++
    if (mism <= 10) console.log('diff', n.po, n.item, 'old', o.qty, 'req', n.req)
  }
}
console.log('mismatch count', mism, 'of', newRows.length)
