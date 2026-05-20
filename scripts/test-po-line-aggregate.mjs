import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'
import { parsePoLineReportText, preprocessPoLineReportText } from '../src/lib/parsePoLineReport.ts'
import { aggregatePoLineReportRows, parseRequestedQuantity } from '../src/lib/poLineAggregate.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function loadPdfRows() {
  const buf = await readFile(join(__dirname, '..', 'POInfoPageFiles', 'POLineReport.pdf'))
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const text = (await parser.getText())?.text ?? ''
  return parsePoLineReportText(preprocessPoLineReportText(text))
}

const rows = await loadPdfRows()
const hrst = rows.filter((r) => r.po_number === 'PO-12084' && r.item_name === 'HRST-W')
const vx80 = rows.filter((r) => r.po_number === 'PO-12094' && r.item_name === 'VX80R')
const stock = rows.filter((r) => r.job_or_customer === 'Stock').slice(0, 3)

console.log('HRST-W aggregated:', hrst, 'qty=', parseRequestedQuantity(hrst[0]?.quantity))
console.log('VX80R aggregated:', vx80)
console.log('Stock samples:', stock)
console.log('Total aggregated rows:', rows.length)
