/**
 * PO Line Report PDF text → rows / CSV matching `scripts/parse-po-report.mjs` and `public/po_line_report.csv`.
 */

export type PoLineReportCsvRow = {
  po_number: string
  item_name: string
  part_number: string
  description: string
  color: string
  quantity: string
  job_or_customer: string
}

function escapeCsv(s: string | number | null | undefined): string {
  if (s == null) return ''
  const str = String(s).trim()
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

const PO_DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}/

/** True when a PO line segment includes For: plus Req./date (or dollar columns). */
function poLineSegmentComplete(line: string): boolean {
  const forMatch = /For:(.*)$/is.exec(line)
  if (!forMatch) return false
  const tail = forMatch[1]!
  return PO_DATE_RE.test(tail) || /\$\s*[\d,.]/.test(tail)
}

/** Merge PDF rows split across lines (pdf.js often breaks PO / Item / For / qty / date). */
export function preprocessPoLineReportText(text: string): string {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const merged: string[] = []

  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]!
    if (/^Customer:/i.test(line)) {
      merged.push(line)
      continue
    }
    if (!/PO:\d+/i.test(line)) {
      merged.push(line)
      continue
    }
    while (i + 1 < raw.length) {
      const next = raw[i + 1]!
      if (/^Customer:/i.test(next) || /^PO:\d+/i.test(next)) break
      if (poLineSegmentComplete(line)) break
      i++
      line += ` ${next}`
    }
    merged.push(line)
  }
  return merged.join('\n')
}

function parseCustomerFromLine(trimmed: string): string | null {
  if (!trimmed.startsWith('Customer:')) return null
  const afterLabel = trimmed.slice(9).trim()
  if (!afterLabel || /^\d/.test(afterLabel)) return null

  const customerRegex = /^Customer:(.+?)\s+\d+\s+\d+\s+/
  const match = trimmed.match(customerRegex)
  if (match) return match[1]!.trim()

  // Strip trailing iPoint summary columns (counts / dollar amounts).
  return afterLabel.replace(/\s+\d+(\s+\d+)*(\s+\$[\d,.]+)*.*$/, '').trim() || null
}

/** Split a line that may contain multiple PO: entries (pdf.js often merges rows). */
function splitPoSegments(line: string): string[] {
  return line
    .split(/(?=PO:\d+)/i)
    .map((s) => s.trim())
    .filter((s) => /^PO:\d+/i.test(s))
}

/**
 * Parse Req. from the tail after `For:`.
 * iPoint column order: Req. | Pending Rec. | PO Date — in each line that is
 * `For:Type <req> [pending] <po_date> [$ amounts]`.
 */
export function parseForTail(tail: string): { forType: string; quantity: string } {
  const t = tail.trim()
  const core = t
    .replace(/\s+\$[\d,.]+(?:\s+\$[\d,.]+)*\s*[\d.]*\s*$/i, '')
    .replace(/\t/g, ' ')
    .trim()

  const dateMatch = core.match(PO_DATE_RE)
  if (dateMatch && dateMatch.index != null) {
    const beforeDate = core.slice(0, dateMatch.index).trim()
    const forPart = beforeDate.replace(/\s+\d+(\s+\d+)?\s*$/g, '').trim()
    const numsBefore = [...beforeDate.matchAll(/\b(\d+)\b/g)].map((x) => x[1]!)
    if (numsBefore.length >= 1) {
      return {
        forType: forPart.replace(/\s+/g, ' '),
        quantity: numsBefore[0]!,
      }
    }
    const afterDate = core.slice(dateMatch.index + dateMatch[0].length).trim()
    const numsAfter = [...afterDate.matchAll(/\b(\d+)\b/g)].map((x) => x[1]!)
    if (numsAfter.length >= 1) {
      return {
        forType: forPart.replace(/\s+/g, ' ') || beforeDate.replace(/\s+/g, ' '),
        quantity: numsAfter[0]!,
      }
    }
  }

  let m = core.match(/^(.+?)\s+(\d+)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) {
    return { forType: m[1]!.trim().replace(/\s+/g, ' '), quantity: m[2]! }
  }
  m = core.match(/^(.+?)\s+(\d+)\s*(?=\d{1,2}\/\d{1,2}\/)/)
  if (m) {
    return { forType: m[1]!.trim().replace(/\s+/g, ' '), quantity: m[2]! }
  }
  m = core.match(/^(.+?)\s+(\d+)(?:\s|$)/)
  if (m) {
    return { forType: m[1]!.trim().replace(/\s+/g, ' '), quantity: m[2]! }
  }
  return { forType: core.replace(/\s+/g, ' '), quantity: '' }
}

/** PO / Item / For may be separated by pipe, tab, or spaces (browser PDF extract uses spaces). */
const PO_LINE_FIELD_SEP = '[\\|\\t\\s]+'

function parsePoSegment(
  segment: string,
  currentCustomer: string
): PoLineReportCsvRow | null {
  const header = new RegExp(
    `PO:(\\d+)\\s*${PO_LINE_FIELD_SEP}\\s*Item:([^|\\t]+?)\\s*${PO_LINE_FIELD_SEP}\\s*For:(.+)`,
    'i'
  ).exec(segment)
  if (!header) return null

  const { forType, quantity } = parseForTail(header[3]!)
  return {
    po_number: `PO-${header[1]}`,
    item_name: header[2]!.trim(),
    part_number: '',
    description: forType ? `For: ${forType}` : '',
    color: '',
    quantity,
    job_or_customer: currentCustomer,
  }
}

/**
 * Parse text extracted from a PO Line Report PDF (Req. column = quantity requested).
 * Returns one row per PO + item with total Req. quantity (stock lines use blank customer).
 */
export function parsePoLineReportText(text: string): PoLineReportCsvRow[] {
  const normalized = preprocessPoLineReportText(text)
  const lines = normalized.split(/\r?\n/)
  const rows: PoLineReportCsvRow[] = []
  let currentCustomer = ''

  for (const line of lines) {
    const trimmed = line.trim()
    const customer = parseCustomerFromLine(trimmed)
    if (customer !== null) {
      currentCustomer = customer
      continue
    }
    if (!/PO:\d+/i.test(trimmed) || !/Item:/i.test(trimmed)) continue

    for (const segment of splitPoSegments(trimmed)) {
      const row = parsePoSegment(segment, currentCustomer)
      if (row) rows.push(row)
    }
  }
  return rows
}

const PO_LINE_CSV_HEADER =
  'PO Number,Item Name,Part Number,Description,Color,Quantity,Job Or Customer'

export function poLineReportRowsToCsv(rows: PoLineReportCsvRow[]): string {
  const csvLines = [PO_LINE_CSV_HEADER]
  for (const r of rows) {
    csvLines.push(
      [
        escapeCsv(r.po_number),
        escapeCsv(r.item_name),
        escapeCsv(r.part_number),
        escapeCsv(r.description),
        escapeCsv(r.color),
        escapeCsv(r.quantity),
        escapeCsv(r.job_or_customer || ''),
      ].join(',')
    )
  }
  return csvLines.join('\n')
}
