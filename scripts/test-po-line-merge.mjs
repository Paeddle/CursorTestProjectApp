/** Quick check: split For:/qty lines merge and parse Req. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Dynamic import from built sources via tsx alternative: inline minimal copy
const PO_DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}/

function poLineSegmentComplete(line) {
  const forMatch = /For:(.*)$/is.exec(line)
  if (!forMatch) return false
  const tail = forMatch[1]
  return PO_DATE_RE.test(tail) || /\$\s*[\d,.]/.test(tail)
}

function preprocessPoLineReportText(text) {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const merged = []
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]
    if (/^Customer:/i.test(line)) {
      merged.push(line)
      continue
    }
    if (!/PO:\d+/i.test(line)) {
      merged.push(line)
      continue
    }
    while (i + 1 < raw.length) {
      const next = raw[i + 1]
      if (/^Customer:/i.test(next) || /^PO:\d+/i.test(next)) break
      if (poLineSegmentComplete(line)) break
      i++
      line += ` ${next}`
    }
    merged.push(line)
  }
  return merged.join('\n')
}

function parseForTail(tail) {
  const core = tail
    .trim()
    .replace(/\s+\$[\d,.]+(?:\s+\$[\d,.]+)*\s*[\d.]*\s*$/i, '')
    .replace(/\t/g, ' ')
    .trim()
  const dateMatch = core.match(PO_DATE_RE)
  if (dateMatch && dateMatch.index != null) {
    const beforeDate = core.slice(0, dateMatch.index).trim()
    const numsBefore = [...beforeDate.matchAll(/\b(\d+)\b/g)].map((x) => x[1])
    if (numsBefore.length >= 1) return numsBefore[0]
  }
  return ''
}

const split = [
  'Customer:Bottcher, Chad:Bozeman-550 Valley Ridge Rd-Bottcher-SVC',
  'PO:12087 Item: PFD-46 For: Work Order',
  '1 1 5/7/26 $533.14 $533.14',
].join('\n')

const merged = preprocessPoLineReportText(split)
const line = merged.split('\n').find((l) => l.includes('PFD-46'))
const qty = parseForTail(line.split(/For:/i)[1])
console.log('merged line:', line)
console.log('req qty:', qty, qty === '1' ? 'OK' : 'FAIL')
