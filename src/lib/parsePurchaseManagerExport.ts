export interface ParsedPurchaseLine {
  vendor: string | null
  part: string
  required: number
  received: number | null
  ordered: number | null
  cost: string | null
  context_line: string | null
  raw_line: string
}

const DATE_LINE = /^\d{1,2}\/\d{1,2}\/\d{4}/

function isInt(s: string): boolean {
  return /^\d+$/.test(s.trim())
}

function isMoney(s: string): boolean {
  return /^\$/.test(s.trim())
}

/**
 * Parse lines produced by extractPdfLinesFromArrayBuffer (tab-separated cells).
 * Heuristic: rows with "+", "-" in fixed columns and a numeric Required in the next cell.
 */
export function parsePurchaseManagerLines(lines: string[]): ParsedPurchaseLine[] {
  const out: ParsedPurchaseLine[] = []
  let currentVendor: string | null = null
  let currentContext: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trim()
    if (!line || line.startsWith('--')) continue
    if (/page\s+\d+\s+of\s+\d+/i.test(line)) continue
    if (line.includes('Purchase Request Manager')) continue
    if (line === 'Create PO' || line === 'Add to Existing PO') continue
    if (line === 'Cost' || line === 'Options' || line === 'On-Hand') continue
    if (/^Group\s+One$/i.test(line)) continue

    if (DATE_LINE.test(line)) {
      currentContext = line
      continue
    }

    // Single lone integer lines (noise between wrapped rows)
    if (/^\d+$/.test(line) && line.length <= 4) {
      continue
    }

    const parts = line.split(/\t/).map((s) => s.trim()).filter((s) => s.length > 0)

    // Header row
    if (parts.includes('Required') && parts.includes('Part')) {
      continue
    }

    // Vendor / section subtotal: VendorName + - $123.45 (no numeric required in col 3)
    if (
      parts.length >= 4 &&
      parts[1] === '+' &&
      parts[2] === '-' &&
      !isInt(parts[3] ?? '')
    ) {
      const name = (parts[0] ?? '').trim()
      // Ignore noise like "10 + - 01/30/2020 ..." where the first cell is just a quantity
      if (name && !/^\d+$/.test(name) && !isMoney(name)) {
        currentVendor = name
      }
      continue
    }

    // Data row: Part + - required ...
    if (parts.length >= 5 && parts[1] === '+' && parts[2] === '-' && isInt(parts[3] ?? '')) {
      const part = (parts[0] ?? '').trim()
      if (!part) continue

      const required = Number.parseInt(parts[3]!, 10)
      let i = 4
      let received: number | null = null
      let ordered: number | null = null
      let cost: string | null = null

      if (parts[i] && isInt(parts[i]!)) {
        received = Number.parseInt(parts[i]!, 10)
        i++
      }
      if (parts[i] && isInt(parts[i]!)) {
        ordered = Number.parseInt(parts[i]!, 10)
        i++
      }
      if (parts[i] && isMoney(parts[i]!)) {
        cost = parts[i]!
        i++
      }

      out.push({
        vendor: currentVendor,
        part: part,
        required: Number.isFinite(required) ? required : 0,
        received,
        ordered,
        cost,
        context_line: currentContext,
        raw_line: line,
      })
    }
  }

  return out
}
