export interface ParsedPurchaseLine {
  vendor: string | null
  job: string | null
  part: string
  required: number
  received: number | null
  ordered: number | null
  cost: string | null
  context_line: string | null
  raw_line: string
}

const DATE_LINE = /^\d{1,2}\/\d{1,2}\/\d{4}/
const DATE_ANYWHERE = /\d{1,2}\/\d{1,2}\/\d{4}/

function isInt(s: string): boolean {
  return /^\d+$/.test(s.trim())
}

function isMoney(s: string): boolean {
  return /^\$/.test(s.trim())
}

function isJobTokenAfterDate(tok: string): boolean {
  // Jobs in your screenshots tend to be lowercase names like:
  // "zalupski" and "pugliese/berezin"
  const t = tok
    .trim()
    .replace(/[,:;]$/g, '')
    .replace(/[,:;]/g, '')
  if (!t) return false
  if (isMoney(t)) return false
  if (DATE_ANYWHERE.test(t) || DATE_LINE.test(t)) return false
  if (t === '+' || t === '-') return false
  // Exclude anything with digits (part names and quantities contain digits).
  if (/\d/.test(t)) return false
  // Prefer lowercase tokens to avoid picking manufacturer names like "Sandisk".
  if (!/^[a-z]/.test(t)) return false
  // Allow letters plus optional slash-separated words.
  return /^[a-zA-Z]+(?:\/[a-zA-Z]+)*$/.test(t)
}

/**
 * Parse lines produced by extractPdfLinesFromArrayBuffer (tab-separated cells).
 * Heuristic: rows with "+", "-" in fixed columns and a numeric Required in the next cell.
 */
export function parsePurchaseManagerLines(lines: string[]): ParsedPurchaseLine[] {
  const out: ParsedPurchaseLine[] = []
  let currentVendor: string | null = null
  let currentContext: string | null = null
  let currentJob: string | null = null
  let currentPartContext: { part: string; vendor: string | null; cost: string | null } | null = null
  let pendingSummaryIndex: number | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trim()
    if (!line || line.startsWith('--')) continue
    if (/page\s+\d+\s+of\s+\d+/i.test(line)) continue
    if (line.includes('Purchase Request Manager')) continue
    if (line === 'Create PO' || line === 'Add to Existing PO') continue
    if (line === 'Cost' || line === 'Options' || line === 'On-Hand') continue
    if (/^Group\s+One$/i.test(line)) continue

    // Date can appear at the start OR embedded in the row.
    // Treat the remainder after the date as job context, but don't `continue`
    // so we can still parse purchase rows on the same extracted line.
    if (DATE_ANYWHERE.test(line)) {
      const m = line.match(DATE_ANYWHERE)
      const idx = m?.index ?? 0
      currentContext = line
      const after = line.slice(idx + m![0].length).replace(/^\s*\|\s*/g, '').trim()
      if (after && (after.includes('/') || after.includes(':') || /ref#|ref\b/i.test(after) || /\bwo\b/i.test(after))) {
        currentJob = after
      }
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
    // - Most purchase rows contain a $cost token, and then a sequence of integers:
    //   + - <part> $<cost> <required> <received> <ordered> <on_hand> <available>
    // - Vendor subtotal rows also contain $cost but do NOT have a "part-like" token.
    //
    // We parse by iterating ALL $cost tokens in the extracted text line, extracting
    // the integer sequence after each, and taking the nearest part-like token
    // to the left of that $cost.
    const moneyIndices = parts.map((p, idx) => (isMoney(p) ? idx : -1)).filter((i) => i >= 0)
    if (moneyIndices.length > 0) {
      let parsedAtLeastOne = false

      let prevMoneyIndex = -1
      for (const mi of moneyIndices) {
        const intsAfter: number[] = []
        for (let k = mi + 1; k < parts.length; k++) {
          const t = parts[k]!
          if (isInt(t)) intsAfter.push(Number.parseInt(t, 10))
          else break
        }

        // Look for nearest part-like token to the left of this money token.
        let partCandidate: string | null = null
        for (let k = mi - 1; k >= 0; k--) {
          const tok = (parts[k] ?? '').trim()
          if (!tok || tok === '+' || tok === '-') continue
          if (DATE_LINE.test(tok)) continue
          if (tok.includes('/')) continue
          if (tok.includes(':')) continue

          if (/[0-9]/.test(tok) && !/^\\d+$/.test(tok) && !isMoney(tok) && tok !== currentContext) {
            partCandidate = tok
            break
          }
          if (/[0-9\\-]/.test(tok) && !isMoney(tok) && !/^\\d+$/.test(tok) && tok.includes('-')) {
            partCandidate = tok
            break
          }
        }

        if (partCandidate && intsAfter.length >= 1) {
          // Clean up: sometimes Part looks like "20|VISTAH3" or prefixed with qty.
          const cleanedPart = partCandidate.replace(/^\\d+\\s*\\|\\s*/, '').trim()
          if (cleanedPart && !/\\s/.test(cleanedPart) && !isMoney(cleanedPart)) {
            // Pick the nearest job-like token immediately to the left of this $cost,
            // but do not cross over into the previous $cost "segment".
            let rowJob: string | null = currentJob

            // Anchored job selection:
            // 1) find the nearest date token in this segment (between prevMoneyIndex and mi)
            // 2) choose the first job-like token after the date and before $cost/ints
            let dateIdx: number | null = null
            for (let j = mi - 1; j > prevMoneyIndex; j--) {
              const jt = (parts[j] ?? '').trim()
              if (DATE_ANYWHERE.test(jt)) {
                dateIdx = j
                break
              }
            }

            if (dateIdx != null) {
              for (let j = dateIdx + 1; j < mi; j++) {
                const jt = (parts[j] ?? '').trim()
                if (!jt || jt === '+' || jt === '-' || jt === currentContext) continue
                if (isMoney(jt)) break
                if (isInt(jt)) break
                if (isJobTokenAfterDate(jt)) {
                  rowJob = jt
                  break
                }
              }
            }

            const required = intsAfter[0] ?? 0
            const received = intsAfter.length >= 2 ? intsAfter[1]! : null
            const ordered = intsAfter.length >= 3 ? intsAfter[2]! : null

            out.push({
              vendor: currentVendor,
              job: rowJob,
              part: cleanedPart,
              required: Number.isFinite(required) ? required : 0,
              received,
              ordered,
              cost: parts[mi] ?? null,
              context_line: currentContext,
              raw_line: line,
            })
            currentPartContext = { part: cleanedPart, vendor: currentVendor, cost: parts[mi] ?? null }
            pendingSummaryIndex = out.length - 1
            parsedAtLeastOne = true
          }
        }
        prevMoneyIndex = mi
      }

      if (parsedAtLeastOne) continue

      // If we didn't parse any purchase rows, treat it as a vendor subtotal:
      // extract vendor name between the last '-' and the first money token.
      const vendorMoneyIndex = moneyIndices[0]!
      const dashIndex = parts.lastIndexOf('-')
      const vendorTokens = parts.slice(dashIndex + 1, vendorMoneyIndex).filter(Boolean)
      const vendor = vendorTokens.join(' ').trim()
      if (vendor && !isMoney(vendor) && !DATE_LINE.test(vendor) && !/^\\d+$/.test(vendor)) {
        currentVendor = vendor
      }
      continue
    }

    // Detail-row parsing (no cost on row):
    // Many exports place one summary line (with cost/total required) followed by
    // multiple date+job lines with per-job requested qty. We prefer those per-job rows.
    if (currentPartContext && DATE_ANYWHERE.test(line)) {
      let detailJob: string | null = null
      const dateTokenIndex = parts.findIndex((p) => DATE_ANYWHERE.test(p))
      if (dateTokenIndex >= 0) {
        for (let j = dateTokenIndex + 1; j < parts.length; j++) {
          const jt = (parts[j] ?? '').trim()
          if (!jt || jt === '+' || jt === '-') continue
          if (isMoney(jt)) break
          if (isJobTokenAfterDate(jt)) {
            detailJob = jt
            break
          }
        }
      }

      // Qty on detail rows is usually the last int token.
      let detailRequired: number | null = null
      for (let j = parts.length - 1; j >= 0; j--) {
        const t = (parts[j] ?? '').trim()
        if (isInt(t)) {
          const n = Number.parseInt(t, 10)
          if (Number.isFinite(n) && n > 0) {
            detailRequired = n
            break
          }
        }
      }

      if (detailJob && detailRequired != null) {
        // If this item had a summary row, remove it once detail rows appear.
        if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
          out.splice(pendingSummaryIndex, 1)
          pendingSummaryIndex = null
        }

        out.push({
          vendor: currentPartContext.vendor,
          job: detailJob,
          part: currentPartContext.part,
          required: detailRequired,
          received: null,
          ordered: null,
          cost: currentPartContext.cost,
          context_line: currentContext,
          raw_line: line,
        })
        continue
      }
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
          job: currentJob,
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
