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

    // New robust parsing:
    // - Most data rows contain a $cost token, and then a sequence of integers:
    //   + - <part> $<cost> <required> <received> <ordered> <on_hand> <available>
    // - Vendor subtotal rows also contain $cost but do NOT have a "part-like" token (digits+letters).
    // We parse by finding `$...`, extracting integers after it, then finding the nearest token to the left that looks like a part.
    const moneyIndex = parts.findIndex((p) => isMoney(p))
    if (moneyIndex >= 0) {
      const intsAfter: number[] = []
      for (let k = moneyIndex + 1; k < parts.length; k++) {
        const t = parts[k]!
        if (isInt(t)) intsAfter.push(Number.parseInt(t, 10))
        else break
      }

      // Look for nearest part-like token to the left of money.
      let partCandidate: string | null = null
      for (let k = moneyIndex - 1; k >= 0; k--) {
        const tok = (parts[k] ?? '').trim()
        if (!tok || tok === '+' || tok === '-') continue
        // Don't accidentally treat dates / debug tokens as part numbers.
        if (DATE_LINE.test(tok)) continue
        if (tok.includes('/')) continue
        if (tok.includes(':')) continue
        // Part tokens usually contain digits and are not pure integers.
        if (/[0-9]/.test(tok) && !/^\\d+$/.test(tok) && !isMoney(tok) && tok !== currentContext) {
          partCandidate = tok
          break
        }
        // Sometimes Part can be numeric-like (e.g. "60-763" includes digits + dash) -> we still accept if not pure int.
        if (/[0-9\\-]/.test(tok) && !isMoney(tok) && !/^\\d+$/.test(tok) && tok.includes('-')) {
          partCandidate = tok
          break
        }
      }

      if (partCandidate && intsAfter.length >= 1) {
        // Clean up: sometimes Part looks like "20|VISTAH3" or prefixed with qty.
        const cleanedPart = partCandidate.replace(/^\\d+\\s*\\|\\s*/, '').trim()
        if (cleanedPart && !/\\s/.test(cleanedPart) && !isMoney(cleanedPart)) {
          const required = intsAfter[0] ?? 0
          const received = intsAfter.length >= 2 ? intsAfter[1]! : null
          const ordered = intsAfter.length >= 3 ? intsAfter[2]! : null

          out.push({
            vendor: currentVendor,
            part: cleanedPart,
            required: Number.isFinite(required) ? required : 0,
            received,
            ordered,
            cost: parts[moneyIndex] ?? null,
            context_line: currentContext,
            raw_line: line,
          })
          continue
        }
      }

      // Otherwise treat it as a vendor subtotal: extract vendor name between the last '-' and the money token.
      const dashIndex = parts.lastIndexOf('-')
      const vendorTokens = parts.slice(dashIndex + 1, moneyIndex).filter(Boolean)
      const vendor = vendorTokens.join(' ').trim()
      if (vendor && !isMoney(vendor) && !DATE_LINE.test(vendor) && !/^\\d+$/.test(vendor)) {
        // Only update vendor if this line doesn't obviously contain a part-like token.
        // (e.g. "Group One $45.10" => vendorTokens = ["Group","One"])
        currentVendor = vendor
      }
      continue
    }

    // Fallback for older layouts: try to parse <part> + - <requiredInt> ...
    const plusIndex = parts.findIndex((p) => p === '+' || p === '+ ')
    const dashIndex = parts.findIndex((p) => p === '-')
    if (plusIndex >= 0 && dashIndex === plusIndex + 1) {
      for (let i = 0; i < parts.length - 2; i++) {
        if (parts[i] !== '+') continue
        if (parts[i + 1] !== '-') continue
        const requiredToken = parts[i + 2]
        if (!isInt(requiredToken)) continue

        const rawPart = parts.slice(0, i).join(' ').trim()
        const required = Number.parseInt(requiredToken, 10)
        const cleanedPart = rawPart.replace(/^\\d+\\s*\\|\\s*/, '').trim()
        if (!cleanedPart || /^\\d+$/.test(cleanedPart) || isMoney(cleanedPart)) continue

        out.push({
          vendor: currentVendor,
          part: cleanedPart,
          required: Number.isFinite(required) ? required : 0,
          received: null,
          ordered: null,
          cost: null,
          context_line: currentContext,
          raw_line: line,
        })
      }
    }
  }

  return out
}
