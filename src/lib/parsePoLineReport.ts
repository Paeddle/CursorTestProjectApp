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

/**
 * Parse text extracted from a PO Line Report PDF (same rules as `scripts/parse-po-report.mjs`).
 */
export function parsePoLineReportText(text: string): PoLineReportCsvRow[] {
  const normalized = preprocessPoLineReportText(text)
  const lines = normalized.split(/\r?\n/)
  const rows: PoLineReportCsvRow[] = []
  // | or tab between PO / Item / For (xlsx hierarchical uses tabs).
  const poRegex = /PO:(\d+)\s*[\|\t]\s*Item:([^|\t]+?)\s*[\|\t]\s*For:([^\d$]+?)(\d+)/gi
  let currentCustomer = ''

  for (const line of lines) {
    const trimmed = line.trim()
    const customer = parseCustomerFromLine(trimmed)
    if (customer !== null) {
      currentCustomer = customer
      continue
    }
    if (!/PO:\d+/i.test(trimmed) || !/Item:/i.test(trimmed)) continue

    let m: RegExpExecArray | null
    const re = new RegExp(poRegex.source, poRegex.flags)
    while ((m = re.exec(trimmed)) !== null) {
      const poNumber = m[1]
      const itemName = m[2].trim()
      const forType = m[3].trim().replace(/\s+/g, ' ')
      const quantity = m[4]
      rows.push({
        po_number: `PO-${poNumber}`,
        item_name: itemName,
        part_number: '',
        description: forType ? `For: ${forType}` : '',
        color: '',
        quantity,
        job_or_customer: currentCustomer,
      })
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
