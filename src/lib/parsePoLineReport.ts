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

/** Merge PDF rows split across lines (pdf.js often breaks PO / Item / For across cells). */
export function preprocessPoLineReportText(text: string): string {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const merged: string[] = []

  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]!
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
 * Parse quantity from the tail after `For:` — uses Req. (first number before PO date).
 * Formats: `For:Sales Order   3   3 4/2/26` (Req + Pending) or `For:Sales Order   16 5/6/26` (Req only).
 */
function parseForTail(tail: string): { forType: string; quantity: string } {
  const t = tail.trim()
  // Req + Pending Rec, then PO date (M/D/YY)
  let m = t.match(/^(.+?)\s+(\d+)\s+(\d+)\s*(?=\d{1,2}\/)/)
  if (m) {
    return { forType: m[1]!.trim().replace(/\s+/g, ' '), quantity: m[2]! }
  }
  // Req only, then PO date
  m = t.match(/^(.+?)\s+(\d+)\s*(?=\d{1,2}\/)/)
  if (m) {
    return { forType: m[1]!.trim().replace(/\s+/g, ' '), quantity: m[2]! }
  }
  // Fallback: first number after For type
  m = t.match(/^(.+?)\s+(\d+)/)
  if (m) {
    return { forType: m[1]!.trim().replace(/\s+/g, ' '), quantity: m[2]! }
  }
  return { forType: t.replace(/\s+/g, ' '), quantity: '' }
}

function parsePoSegment(
  segment: string,
  currentCustomer: string
): PoLineReportCsvRow | null {
  const header = /PO:(\d+)\s*[\|\t]\s*Item:([^|\t]+?)\s*[\|\t]\s*For:(.+)/i.exec(segment)
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
