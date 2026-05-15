#!/usr/bin/env node
/**
 * Compare PO Line Report parsing: pdf-parse vs pdf.js (same as PO Info upload).
 * Usage: node scripts/verify-po-line-report.mjs [path-to-POLineReport.pdf]
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pdfPath = process.argv[2] || join(__dirname, '..', 'POInfoPageFiles', 'POLineReport.pdf')

const poRegex = /PO:(\d+)\s*\|\s*Item:([^|]+)\s*\|\s*For:([^\d$]+?)(\d+)/g
const customerRegex = /^Customer:(.+?)\s+\d+\s+\d+\s+/

function parsePOLines(text) {
  const lines = text.split(/\r?\n/)
  const rows = []
  let currentCustomer = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Customer:')) {
      const afterLabel = trimmed.slice(9).trim()
      if (afterLabel && !/^\d/.test(afterLabel)) {
        const match = trimmed.match(customerRegex)
        if (match) currentCustomer = match[1].trim()
        else currentCustomer = afterLabel.replace(/\s+\d+.*$/, '').trim()
      }
      continue
    }
    if (!trimmed.includes('PO:') || !trimmed.includes('| Item:')) continue

    let m
    const re = new RegExp(poRegex.source, 'g')
    while ((m = re.exec(trimmed)) !== null) {
      rows.push({
        po_number: `PO-${m[1]}`,
        item_name: m[2].trim(),
        job_or_customer: currentCustomer,
        quantity: m[4],
      })
    }
  }
  return rows
}

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

function parsePOLinesWithPreprocess(text) {
  return parsePOLines(preprocessPoLineReportText(text))
}

async function extractWithPdfJs(buf) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) })
  const pdf = await loadingTask.promise
  const pageLines = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items = []

    for (const raw of content.items) {
      if (!raw?.str) continue
      const x = Number(raw.transform?.[4] ?? 0)
      const y = Number(raw.transform?.[5] ?? 0)
      const str = String(raw.str).trim()
      if (!str) continue
      items.push({ x, y, str })
    }

    items.sort((a, b) => b.y - a.y || a.x - b.x)

    const tolerance = 1.5
    const rows = []

    for (const it of items) {
      const last = rows[rows.length - 1]
      if (!last || Math.abs(last.y - it.y) > tolerance) {
        rows.push({ y: it.y, cells: [{ x: it.x, str: it.str }] })
      } else {
        last.cells.push({ x: it.x, str: it.str })
        last.y = last.y * 0.8 + it.y * 0.2
      }
    }

    for (const row of rows) {
      const cells = row.cells.sort((a, b) => a.x - b.x)
      const line = cells
        .map((c) => c.str.trim())
        .filter(Boolean)
        .join(' ')
      if (line.trim()) pageLines.push(line.trim())
    }
  }

  return pageLines.join('\n')
}

function summarize(label, rows) {
  const pickens = rows.filter((r) => /pickens/i.test(r.job_or_customer))
  const vx80 = rows.filter((r) => /vx80r/i.test(r.item_name))
  const emptyJob = rows.filter((r) => !r.job_or_customer?.trim())
  console.log(`\n${label}`)
  console.log('  total rows:', rows.length)
  console.log('  Pickens job rows:', pickens.length)
  console.log('  VX80R rows:', vx80.length, vx80[0] ? `→ ${vx80[0].po_number} / ${vx80[0].job_or_customer}` : '')
  console.log('  empty job_or_customer:', emptyJob.length)
}

async function main() {
  const buf = await readFile(pdfPath)
  console.log('File:', pdfPath)

  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const pdfParseText = (await parser.getText())?.text ?? ''
  const pdfParseRows = parsePOLinesWithPreprocess(pdfParseText)
  summarize('pdf-parse + preprocess (reference)', pdfParseRows)

  let pdfJsRows = []
  try {
    const pdfJsText = await extractWithPdfJs(buf)
    pdfJsRows = parsePOLinesWithPreprocess(pdfJsText)
    summarize('pdf.js (PO Info upload path)', pdfJsRows)
  } catch (e) {
    console.log('\npdf.js extract skipped in Node:', e.message)
  }

  const pdfParseKeys = new Set(pdfParseRows.map((r) => `${r.po_number}\0${r.item_name}\0${r.job_or_customer}`))
  const onlyPdfParse = pdfParseRows.filter(
    (r) => !pdfJsRows.some((j) => j.po_number === r.po_number && j.item_name === r.item_name && j.job_or_customer === r.job_or_customer)
  )
  const onlyPdfJs = pdfJsRows.filter(
    (r) => !pdfParseRows.some((p) => p.po_number === r.po_number && p.item_name === r.item_name && p.job_or_customer === r.job_or_customer)
  )

  console.log('\nDiff vs pdf-parse:')
  console.log('  missing from pdf.js path:', onlyPdfParse.length)
  if (onlyPdfParse.length) {
    console.log('  samples:', onlyPdfParse.slice(0, 8).map((r) => `${r.po_number} ${r.item_name} [${r.job_or_customer}]`))
  }
  console.log('  extra in pdf.js path:', onlyPdfJs.length)
  if (onlyPdfJs.length) {
    console.log('  samples:', onlyPdfJs.slice(0, 8).map((r) => `${r.po_number} ${r.item_name} [${r.job_or_customer}]`))
  }

  const vxOnlyParse = onlyPdfParse.filter((r) => /vx80r/i.test(r.item_name))
  if (vxOnlyParse.length) console.log('  VX80R only in pdf-parse:', vxOnlyParse)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
