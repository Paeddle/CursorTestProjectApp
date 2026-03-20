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

/** Every `+ - <int>` group on a row (PDF sometimes merges two detail qty cells on one line). */
function collectPlusMinusQuantities(parts: string[]): number[] {
  const out: number[] = []
  for (let i = 0; i < parts.length - 2; i++) {
    if (parts[i] === '+' && parts[i + 1] === '-' && isInt(parts[i + 2]!)) {
      const n = Number.parseInt(parts[i + 2]!, 10)
      if (Number.isFinite(n) && n > 0) out.push(n)
    }
  }
  return out
}

/**
 * Required qty on a date+job *detail* row (no $ on line). Must not treat Ref#, lot, street, or rev as qty.
 * Prefer explicit `+ - n` on the row; else the rightmost plausible small integer (qty columns trail job text).
 */
function detailRequiredQtyOnJobLine(parts: string[]): number | null {
  const pm = collectPlusMinusQuantities(parts)
  if (pm.length > 0) {
    return pm[pm.length - 1] ?? null
  }

  for (let j = parts.length - 1; j >= 0; j--) {
    const t = (parts[j] ?? '').trim()
    if (!isInt(t)) continue
    const n = Number.parseInt(t, 10)
    if (!Number.isFinite(n) || n <= 0) continue
    if (n > 999) continue

    const prevRaw = (parts[j - 1] ?? '').trim()
    const prevNorm = prevRaw.replace(/\.$/, '')
    if (/^rev$/i.test(prevNorm)) continue
    if (/^ref#?$/i.test(prevNorm)) continue
    if (/^lot$/i.test(prevNorm)) continue
    // "Bozeman-" + "196" style street fragments
    if (/-$/.test(prevRaw) && n >= 10 && n < 1000) continue
    // MM / DD / YY split across three cells (e.g. 12 22 25)
    if (
      j >= 2 &&
      isInt((parts[j - 1] ?? '').trim()) &&
      isInt((parts[j - 2] ?? '').trim())
    ) {
      const a = Number.parseInt((parts[j - 2] ?? '').trim(), 10)
      const b = Number.parseInt((parts[j - 1] ?? '').trim(), 10)
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && n >= 1 && n <= 31) {
        continue
      }
    }

    return n
  }
  return null
}

/** Tab cell is only a date — PDF often puts two jobs on one line as `… 01/23/2026 JobA … 2 03/04/2026 JobB … 3`. */
function isDateOnlyCell(tok: string): boolean {
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(tok.trim())
}

function splitPartsIntoDateSegments(parts: string[]): { dateStr: string; subparts: string[] }[] {
  const segments: { dateStr: string; subparts: string[] }[] = []
  for (let i = 0; i < parts.length; i++) {
    const tok = (parts[i] ?? '').trim()
    if (!isDateOnlyCell(tok)) continue
    const dm = tok.match(DATE_ANYWHERE)
    const dateStr = dm ? dm[0] : tok
    let j = i + 1
    while (j < parts.length && !isDateOnlyCell((parts[j] ?? '').trim())) {
      j++
    }
    segments.push({ dateStr, subparts: parts.slice(i, j) })
    i = j - 1
  }
  return segments
}

/**
 * PDF text extraction often merges two job descriptions on one row after the date, e.g.
 * `Dowbuilt:…Ref# 3878-… … SBC:Bozeman-196…Ref# 4542…`. Without splitting we only FIFO one job.
 */
function splitCompoundJobLineIntoJobs(jobBlob: string): string[] {
  const full = jobBlob.trim()
  if (full.length < 20) return [full]

  const refM = /\bRef#\s*\d+/i.exec(full)
  if (!refM) return [full]

  const afterFirstRef = full.slice(refM.index + refM.length)
  const nextCo = afterFirstRef.match(
    /\b(SBC|Dowbuilt|Dovetail|Lohss Construction|Cohutta Lee Builders|Teton Heritage Builders|Blue Ribbon Builders|James Loudspeaker|Samsung|Apple|SanDisk|HP|Sonance|Honeywell|First Alert|AVPro Edge|Crestron|Faradite|GRI|CUSTOM ROMAN|QS PALLADIOM|SIVOIA|Middle Atlantic|LSTU|Sanus|System Sensor|Interlogix|PROSIXHEATV|PROSIXSMOKEV|PROSIX|Lutron|CLOUD GATEWAY|Ubiquiti|Montana Cabin|Smart Home Systems|Friend,|Stanley,|Young,|Perry,|Langlas & Assoc\.)\s*:\s*/i
  )
  if (!nextCo || nextCo.index == null) return [full]

  const splitAt = refM.index + refM[0].length + nextCo.index
  const j1 = full.slice(0, splitAt).trim()
  const j2 = full.slice(splitAt).trim()
  if (j1.length < 12 || j2.length < 12) return [full]
  return [j1, j2]
}

/**
 * Second and later job rows often omit the date (still aligned under the same column).
 * Queue them like date+job lines when we're in a multi-job detail block for one part.
 */
function looksLikeStandaloneJobRow(line: string, parts: string[]): boolean {
  if (line.length < 28) return false
  if (parts.every((p) => p === '+' || p === '-' || isInt(p))) return false
  const compact = line.replace(/\s+/g, ' ')
  return /:\s*\S/.test(compact) && /ref#/i.test(compact)
}

/** Single-token “job hints” after a date — never treat connective/common PDF words as jobs. */
const JOB_TOKEN_STOPWORDS = new Set(
  [
    'and',
    'or',
    'the',
    'a',
    'an',
    'of',
    'for',
    'to',
    'in',
    'on',
    'at',
    'by',
    'with',
    'from',
    'av',
    'security',
    'systems',
    'network',
    'wiring',
    'standalone',
    'update',
    'rev',
    'wo',
  ].map((s) => s.toLowerCase())
)

function isJobTokenAfterDate(tok: string): boolean {
  // Jobs in your screenshots tend to be lowercase names like:
  // "zalupski" and "pugliese/berezin"
  const t = tok
    .trim()
    .replace(/[,:;]$/g, '')
    .replace(/[,:;]/g, '')
  if (!t) return false
  if (JOB_TOKEN_STOPWORDS.has(t.toLowerCase())) return false
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

function extractFullJobContextFromLine(line: string): string | null {
  const m = line.match(DATE_ANYWHERE)
  if (!m || m.index == null) return null
  const after = line
    .slice(m.index + m[0].length)
    .replace(/^\s*\|\s*/g, '')
    .trim()
  if (!after) return null
  return after
}

function extractJobFromLine(line: string): string | null {
  // Prefer full context so the UI shows full job name row.
  const full = extractFullJobContextFromLine(line)
  if (full) return full

  const m = line.match(DATE_ANYWHERE)
  if (!m || m.index == null) return null
  const afterDate = line.slice(m.index + m[0].length).trim()
  if (!afterDate) return null

  // Best signal in your exports: "...-JobName Ref# ...."
  const refMatch = afterDate.match(/^(.*?)(?:\s+)?Ref#/i)
  if (refMatch && refMatch[1]) {
    const beforeRef = refMatch[1].trim()
    const afterDash = beforeRef.split('-').pop()?.trim() || ''
    const candidate = afterDash || beforeRef.split(':').pop()?.trim() || ''
    if (candidate && /^[a-zA-Z0-9/ .&'-]+$/.test(candidate)) {
      return candidate
    }
  }

  // Fallback: use token after the last dash in the post-date context.
  const fallbackDash = afterDate.split('-').pop()?.trim() || ''
  if (fallbackDash && !DATE_ANYWHERE.test(fallbackDash)) {
    const cleaned = fallbackDash.replace(/Ref#.*$/i, '').trim()
    if (cleaned && cleaned.length <= 80) return cleaned
  }

  return null
}

/** Match Purchase Manager UI: job column shows the row date plus description (e.g. `01/23/2026 Dowbuilt:…`). */
function detailJobWithLeadingDate(line: string, jobBody: string | null): string | null {
  if (!jobBody?.trim()) return null
  const m = line.match(DATE_ANYWHERE)
  if (!m) return jobBody.trim()
  const body = jobBody.trim()
  if (body.startsWith(m[0])) return body
  return `${m[0]} ${body}`.replace(/\s+/g, ' ').trim()
}

function normalizeVendorName(v: string | null): string | null {
  if (!v) return null
  const t = v.trim()
  if (/^sundisk$/i.test(t)) return 'SanDisk'
  return v
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
  let lastDetailSignature: string | null = null
  /** Date/job lines waiting for a following qty row (`+ - 2 2`, lone `3`, etc.). FIFO when several jobs stack up. */
  let pendingDetailJobs: { job: string; sourceLine: string }[] = []

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
      const parsedJob = extractJobFromLine(line)
      if (parsedJob) currentJob = parsedJob
      else if (after && (after.includes('/') || after.includes(':') || /ref#|ref\b/i.test(after) || /\bwo\b/i.test(after))) {
        currentJob = after
      }
    }

    // Lone integer lines are usually noise, but when we have active part+job context
    // they often represent per-job request quantities (e.g. detail row quantity only).
    if (/^\d+$/.test(line) && line.length <= 4) {
      const qty = Number.parseInt(line, 10)
      if (currentPartContext && Number.isFinite(qty) && qty > 0) {
        const queued = pendingDetailJobs.length > 0 ? pendingDetailJobs.shift()! : null
        const useJob = queued?.job ?? currentJob
        if (useJob) {
          // If this item had a summary row, remove it once detail rows appear.
          if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
            out.splice(pendingSummaryIndex, 1)
            pendingSummaryIndex = null
          }
          const sig = `${currentPartContext.part}|${useJob}|${qty}|${queued?.sourceLine ?? ''}|${line}`
          if (sig !== lastDetailSignature) {
            out.push({
              vendor: currentPartContext.vendor,
              job: useJob,
              part: currentPartContext.part,
              required: qty,
              received: null,
              ordered: null,
              cost: currentPartContext.cost,
              context_line: currentContext,
              raw_line: line,
            })
            lastDetailSignature = sig
          }
        } else if (queued) {
          pendingDetailJobs.unshift(queued)
        }
      }
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

          if (/[0-9]/.test(tok) && !/^\d+$/.test(tok) && !isMoney(tok) && tok !== currentContext) {
            partCandidate = tok
            break
          }
          if (/[0-9\-]/.test(tok) && !isMoney(tok) && !/^\d+$/.test(tok) && tok.includes('-')) {
            partCandidate = tok
            break
          }
        }

        if (partCandidate && intsAfter.length >= 1) {
          // Clean up: sometimes Part looks like "20|VISTAH3" or prefixed with qty.
          const cleanedPart = partCandidate.replace(/^\d+\s*\|\s*/, '').trim()
          // Allow multi-word descriptions (e.g. "16 GB Micro SD") from a single PDF cell.
          if (cleanedPart && !isMoney(cleanedPart)) {
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

            // Starting a new purchase row from a $ line: drop queued date/job lines from the *previous* item
            // that never received a qty line. (Do not clear on vendor-only $ rows with no part.)
            if (!parsedAtLeastOne && pendingDetailJobs.length > 0) {
              pendingDetailJobs = []
            }

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
      if (vendor && !isMoney(vendor) && !DATE_LINE.test(vendor) && !/^\d+$/.test(vendor)) {
        currentVendor = normalizeVendorName(vendor) ?? vendor
      }
      continue
    }

    // Detail-row parsing (no cost on row):
    // Many exports place one summary line (with cost/total required) followed by
    // multiple date+job lines with per-job requested qty. We prefer those per-job rows.
    if (currentPartContext && DATE_ANYWHERE.test(line)) {
      const datedSegs = splitPartsIntoDateSegments(parts)

      // Two+ date-only cells on one extracted row → one row per job (e.g. Micro SD: Dowbuilt qty 2 + SBC qty 3).
      if (datedSegs.length >= 2) {
        let handled = false
        for (const { dateStr, subparts } of datedSegs) {
          const subLine = subparts.join('\t')
          let detailJob: string | null = extractJobFromLine(subLine)
          const dateTokenIndex = subparts.findIndex((p) => DATE_ANYWHERE.test(p))
          if (!detailJob && dateTokenIndex >= 0) {
            for (let j = dateTokenIndex + 1; j < subparts.length; j++) {
              const jt = (subparts[j] ?? '').trim()
              if (!jt || jt === '+' || jt === '-') continue
              if (isMoney(jt)) break
              if (isJobTokenAfterDate(jt)) {
                detailJob = jt
                break
              }
            }
          }

          const detailRequired = detailRequiredQtyOnJobLine(subparts)
          const detailJobDisplay = detailJob
            ? `${dateStr} ${detailJob.trim()}`.replace(/\s+/g, ' ').trim()
            : null

          if (detailJobDisplay && detailRequired != null) {
            if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
              out.splice(pendingSummaryIndex, 1)
              pendingSummaryIndex = null
            }
            out.push({
              vendor: currentPartContext.vendor,
              job: detailJobDisplay,
              part: currentPartContext.part,
              required: detailRequired,
              received: null,
              ordered: null,
              cost: currentPartContext.cost,
              context_line: currentContext,
              raw_line: line,
            })
            lastDetailSignature = `${currentPartContext.part}|${detailJobDisplay}|${detailRequired}|${line}`
            handled = true
          } else if (detailJob && detailRequired == null) {
            for (const seg of splitCompoundJobLineIntoJobs(detailJob)) {
              const j = `${dateStr} ${seg.trim()}`.replace(/\s+/g, ' ').trim()
              pendingDetailJobs.push({ job: j, sourceLine: line })
            }
            handled = true
          }
        }
        if (handled) continue
      }

      // Prefer full job line (after the date). Do not overwrite with a single token like "and"
      // from phrases such as "AV and Security".
      let detailJob: string | null = extractJobFromLine(line)
      const dateTokenIndex = parts.findIndex((p) => DATE_ANYWHERE.test(p))
      if (!detailJob && dateTokenIndex >= 0) {
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

      let detailRequired: number | null = detailRequiredQtyOnJobLine(parts)
      const detailJobDisplay = detailJobWithLeadingDate(line, detailJob)

      if (detailJobDisplay && detailRequired != null) {
        // If this item had a summary row, remove it once detail rows appear.
        if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
          out.splice(pendingSummaryIndex, 1)
          pendingSummaryIndex = null
        }

        out.push({
          vendor: currentPartContext.vendor,
          job: detailJobDisplay,
          part: currentPartContext.part,
          required: detailRequired,
          received: null,
          ordered: null,
          cost: currentPartContext.cost,
          context_line: currentContext,
          raw_line: line,
        })
        lastDetailSignature = `${currentPartContext.part}|${detailJobDisplay}|${detailRequired}|${line}`
        continue
      }

      // Date/job line without an obvious quantity on the same row:
      // hold job and consume quantity from the next non-money row.
      if (detailJob && detailRequired == null) {
        for (const seg of splitCompoundJobLineIntoJobs(detailJob)) {
          const j = detailJobWithLeadingDate(line, seg)
          if (j) pendingDetailJobs.push({ job: j, sourceLine: line })
        }
        continue
      }
    }

    // Job row with no date (continuation under the same purchase line / part).
    if (
      currentPartContext &&
      moneyIndices.length === 0 &&
      !DATE_ANYWHERE.test(line) &&
      looksLikeStandaloneJobRow(line, parts) &&
      (pendingDetailJobs.length > 0 || pendingSummaryIndex != null)
    ) {
      for (const seg of splitCompoundJobLineIntoJobs(line.trim())) {
        const j = detailJobWithLeadingDate(line, seg)
        if (j) pendingDetailJobs.push({ job: j, sourceLine: line })
      }
      continue
    }

    // Pending detail qty line:
    // Some PDFs put date/job on one line and qty on the next line.
    // Multiple jobs may share one extracted row: `+ - 2	+ - 1` or `2	1` (tab ints only).
    if (currentPartContext && pendingDetailJobs.length > 0 && moneyIndices.length === 0) {
      const plusMinusQtys = collectPlusMinusQuantities(parts)
      if (plusMinusQtys.length > 0) {
        for (const qty of plusMinusQtys) {
          if (pendingDetailJobs.length === 0) break
          const { job: dj, sourceLine: src } = pendingDetailJobs.shift()!
          if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
            out.splice(pendingSummaryIndex, 1)
            pendingSummaryIndex = null
          }
          const sig = `${currentPartContext.part}|${dj}|${qty}|${src}|${line}`
          if (sig !== lastDetailSignature) {
            out.push({
              vendor: currentPartContext.vendor,
              job: dj,
              part: currentPartContext.part,
              required: qty,
              received: null,
              ordered: null,
              cost: currentPartContext.cost,
              context_line: currentContext,
              raw_line: line,
            })
            lastDetailSignature = sig
          }
        }
        // e.g. `+ - 2	1` — second qty has no `+ -`; keep consuming pending jobs below
        if (pendingDetailJobs.length === 0) continue
      }

      const allInts =
        parts.length > 0 &&
        parts.every((p) => {
          const t = (p ?? '').trim()
          return isInt(t) && Number.parseInt(t, 10) > 0
        })
      if (allInts && parts.length === pendingDetailJobs.length && parts.length > 1) {
        let consumed = false
        for (let i = 0; i < parts.length; i++) {
          const qty = Number.parseInt((parts[i] ?? '').trim(), 10)
          const { job: dj, sourceLine: src } = pendingDetailJobs.shift()!
          if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
            out.splice(pendingSummaryIndex, 1)
            pendingSummaryIndex = null
          }
          const sig = `${currentPartContext.part}|${dj}|${qty}|${src}|${line}`
          if (sig !== lastDetailSignature) {
            out.push({
              vendor: currentPartContext.vendor,
              job: dj,
              part: currentPartContext.part,
              required: qty,
              received: null,
              ordered: null,
              cost: currentPartContext.cost,
              context_line: currentContext,
              raw_line: line,
            })
            lastDetailSignature = sig
          }
          consumed = true
        }
        if (consumed) continue
      }

      let qty: number | null = null
      for (let j = 0; j < parts.length; j++) {
        const t = (parts[j] ?? '').trim()
        if (isInt(t)) {
          const n = Number.parseInt(t, 10)
          if (Number.isFinite(n) && n > 0) {
            qty = n
            break
          }
        }
      }
      if (qty != null) {
        const { job: dj, sourceLine: src } = pendingDetailJobs.shift()!
        if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
          out.splice(pendingSummaryIndex, 1)
          pendingSummaryIndex = null
        }
        const sig = `${currentPartContext.part}|${dj}|${qty}|${src}|${line}`
        if (sig !== lastDetailSignature) {
          out.push({
            vendor: currentPartContext.vendor,
            job: dj,
            part: currentPartContext.part,
            required: qty,
            received: null,
            ordered: null,
            cost: currentPartContext.cost,
            context_line: currentContext,
            raw_line: line,
          })
          lastDetailSignature = sig
        }
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
        const cleanedPart = rawPart.replace(/^\d+\s*\|\s*/, '').trim()
        if (!cleanedPart || /^\d+$/.test(cleanedPart) || isMoney(cleanedPart)) continue

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

  // Final cleanup:
  // If a part has both (a) one summary-like row and (b) multiple per-job rows whose
  // required values add up to that summary, remove the summary row so compare shows
  // each job separately.
  const byPart = new Map<string, { idx: number; row: ParsedPurchaseLine }[]>()
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!
    const key = r.part.trim().toLowerCase()
    if (!key) continue
    if (!byPart.has(key)) byPart.set(key, [])
    byPart.get(key)!.push({ idx: i, row: r })
  }

  const removeIdx = new Set<number>()
  for (const entries of byPart.values()) {
    if (entries.length < 2) continue

    // Prefer rows that have an actual job token.
    const withJob = entries.filter((e) => (e.row.job || '').trim().length > 0)
    if (withJob.length < 2) continue

    // Identify potential summary rows: required >= 2 and job is missing OR looks too generic.
    for (const candidate of entries) {
      const cJob = (candidate.row.job || '').trim()
      const cReq = candidate.row.required
      if (!Number.isFinite(cReq) || cReq <= 1) continue

      // Other rows for same part with specific jobs.
      const others = withJob.filter((e) => e.idx !== candidate.idx)
      if (others.length < 2) continue

      const otherSum = others.reduce((s, e) => s + (Number.isFinite(e.row.required) ? e.row.required : 0), 0)
      if (otherSum === cReq) {
        // If candidate has no job, or has the same job as one of the detail rows, treat as summary.
        if (!cJob || others.some((e) => (e.row.job || '').trim() === cJob)) {
          removeIdx.add(candidate.idx)
        }
      }
    }
  }

  if (removeIdx.size === 0) return out
  return out.filter((_, idx) => !removeIdx.has(idx))
}
