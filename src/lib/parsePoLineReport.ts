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

/**
 * Parse text extracted from a PO Line Report PDF (same rules as `scripts/parse-po-report.mjs`).
 */
export function parsePoLineReportText(text: string): PoLineReportCsvRow[] {
  const lines = text.split(/\r?\n/)
  const rows: PoLineReportCsvRow[] = []
  const poRegex = /PO:(\d+)\s*\|\s*Item:([^|]+)\s*\|\s*For:([^\d$]+?)(\d+)/g
  const customerRegex = /^Customer:(.+?)\s+\d+\s+\d+\s+/
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

    let m: RegExpExecArray | null
    const re = new RegExp(poRegex.source, 'g')
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
