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

    // Tokenize: prefer tab-separated cells (from extractPdfLines),
    // but fall back to whitespace splitting when tabs aren't present.
    const tabParts = line.split('\t').map((s) => s.trim()).filter((s) => s.length > 0)
    const parts = tabParts.length >= 4 ? tabParts : line.split(/\s{2,}|\s+/).map((s) => s.trim()).filter((s) => s.length > 0)

    // Header row
    if (parts.includes('Required') && parts.includes('Part')) {
      continue
    }

    const plusIndex = parts.findIndex((p) => p === '+' || p === '+ ')
    const dashIndex = parts.findIndex((p) => p === '-')

    // Try to parse a "data row" anywhere in the line with pattern: <part> + - <requiredInt> ...
    // (Vendor subtotal rows also have + - but required is NOT an int, so they won't match.)
    let didParse = false
    for (let i = 0; i < parts.length - 2; i++) {
      if (parts[i] !== '+') continue
      if (parts[i + 1] !== '-') continue
      const requiredToken = parts[i + 2]
      if (!isInt(requiredToken)) continue

      const rawPart = parts.slice(0, i).join(' ').trim()
      if (!rawPart) continue

      const required = Number.parseInt(requiredToken, 10)

      // Clean up: sometimes Part looks like "20|VISTAH3" or prefixed with qty.
      const cleanedPart = rawPart.replace(/^\d+\s*\|\s*/, '').trim()
      if (!cleanedPart || /^\d+$/.test(cleanedPart) || isMoney(cleanedPart)) continue

      let j = i + 3
      let received: number | null = null
      let ordered: number | null = null
      let cost: string | null = null

      // Expected order is: received int, ordered int, then cost ($...)
      if (parts[j] && isInt(parts[j]!)) {
        received = Number.parseInt(parts[j]!, 10)
        j++
      }
      if (parts[j] && isInt(parts[j]!)) {
        ordered = Number.parseInt(parts[j]!, 10)
        j++
      }
      if (parts[j] && isMoney(parts[j]!)) {
        cost = parts[j]!
      } else {
        // Sometimes cost can appear later; scan a bit.
        for (let k = j; k < Math.min(parts.length, j + 4); k++) {
          if (!cost && isMoney(parts[k]!)) cost = parts[k]!
        }
      }

      out.push({
        vendor: currentVendor,
        part: cleanedPart,
        required: Number.isFinite(required) ? required : 0,
        received,
        ordered,
        cost,
        context_line: currentContext,
        raw_line: line,
      })

      didParse = true
      break
    }
    if (didParse) continue

    // Vendor / section subtotal: <VendorName> + - $123.45 (no numeric required in col after '-')
    if (
      plusIndex >= 0 &&
      dashIndex === plusIndex + 1 &&
      parts.length >= dashIndex + 2 &&
      !isInt(parts[dashIndex + 1] ?? '')
    ) {
      const candidate = parts.slice(0, plusIndex).join(' ').trim()
      // Ignore noise like "10 + - 01/30/2020 ..." where candidate is just a quantity.
      if (candidate && !/^\\d+$/.test(candidate) && !isMoney(candidate) && !DATE_LINE.test(candidate)) {
        currentVendor = candidate
      }
      continue
    }
  }

  return out
}
