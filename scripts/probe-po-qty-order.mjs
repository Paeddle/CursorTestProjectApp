import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseForTailV1(tail) {
  const core = tail.replace(/\s+\$[\d,.]+(?:\s+\$[\d,.]+)*\s*[\d.]*\s*$/i, '').replace(/\t/g, ' ').trim()
  let m = core.match(/^(.+?)\s+(\d+)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) return { qty: m[2], how: 'req+pend before date' }
  m = core.match(/^(.+?)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) return { qty: m[2], how: 'req before date' }
  return { qty: '', how: 'none' }
}

function parseForTailAfterDate(tail) {
  const core = tail.replace(/\s+\$[\d,.]+(?:\s+\$[\d,.]+)*\s*[\d.]*\s*$/i, '').replace(/\t/g, ' ').trim()
  const dm = core.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/)
  if (!dm) return parseForTailV1(tail)
  const before = core.slice(0, dm.index).trim()
  const after = core.slice(dm.index + dm[0].length).trim()
  const numsBefore = [...before.matchAll(/\b(\d+)\b/g)].map((x) => x[1])
  const numsAfter = [...after.matchAll(/\b(\d+)\b/g)].map((x) => x[1])
  if (numsBefore.length >= 1) {
    return { qty: numsBefore[0], how: 'first num before date', numsBefore, numsAfter }
  }
  if (numsAfter.length >= 1) {
    return { qty: numsAfter[0], how: 'first num after date', numsBefore, numsAfter }
  }
  return { qty: '', how: 'no nums', numsBefore, numsAfter }
}

const buf = await readFile(join(__dirname, '..', 'POInfoPageFiles', 'POLineReport.pdf'))
const text = (await new PDFParse({ data: new Uint8Array(buf) }).getText())?.text ?? ''
const segments = text.split(/(?=PO:\d+)/i).filter((s) => /Item:/i.test(s))
let diff = 0
for (const seg of segments.slice(0, 500)) {
  const m = /For:(.+)/i.exec(seg)
  if (!m) continue
  const a = parseForTailV1(m[1])
  const b = parseForTailAfterDate(m[1])
  if (a.qty !== b.qty && (a.qty || b.qty)) {
    diff++
    if (diff <= 8) console.log('DIFF', a, b, 'tail', m[1].slice(0, 80))
  }
}
console.log('diff count in first 500 segments', diff)
