import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pdfPath = join(__dirname, '..', 'POInfoPageFiles', 'POLineReport.pdf')

const buf = await readFile(pdfPath)
const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise

for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
  const page = await pdf.getPage(p)
  const content = await page.getTextContent()
  const line = content.items.map((i) => i.str).join(' ')
  console.log('--- page', p, '---')
  for (const part of line.split(/(?=PO:\d+)/)) {
    if (/PO:|Req|Item:/i.test(part)) console.log(part.slice(0, 280))
  }
}
