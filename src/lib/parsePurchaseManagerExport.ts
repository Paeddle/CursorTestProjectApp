/**
 * Heuristic PDF table parser: Purchase Manager layouts vary, so behavior is layered (hierarchy $ rows,
 * line items, multi-date columns). Prefer small reusable checks (distributor vs integrated brand,
 * banner-like part families) over one-off PDF strings where possible.
 */
export interface ParsedPurchaseLine {
  /** Black row: distributor / vendor group (overall total). */
  vendor: string | null
  /** Blue row: brand / manufacturer subtotal under that vendor. */
  manufacturer: string | null
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

/** Cell begins with MM/DD/YYYY (job + date often in one cell: `01/23/2026 Dowbuilt:…`). */
const LEADING_DATE_IN_CELL = /^(\d{1,2}\/\d{1,2}\/\d{4})\b/

function stripLeadingPlusMinusCells(parts: string[]): string[] {
  let i = 0
  while (i < parts.length && ((parts[i] ?? '').trim() === '+' || (parts[i] ?? '').trim() === '-')) {
    i++
  }
  return parts.slice(i)
}

function splitPartsLeadingDateSegments(parts: string[]): { dateStr: string; subparts: string[] }[] {
  const starts: number[] = []
  for (let i = 0; i < parts.length; i++) {
    if (LEADING_DATE_IN_CELL.test((parts[i] ?? '').trim())) starts.push(i)
  }
  if (starts.length < 2) return []
  const out: { dateStr: string; subparts: string[] }[] = []
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!
    const to = s + 1 < starts.length ? starts[s + 1]! : parts.length
    const subparts = parts.slice(from, to)
    const m = (parts[from] ?? '').trim().match(LEADING_DATE_IN_CELL)
    const dateStr = m ? m[1]! : ''
    if (dateStr) out.push({ dateStr, subparts })
  }
  return out
}

/** Indices where a new job column starts: date-only cell or cell beginning with MM/DD/YYYY. */
function allDateSegmentStartIndices(parts: string[]): number[] {
  const starts: number[] = []
  for (let i = 0; i < parts.length; i++) {
    const t = (parts[i] ?? '').trim()
    if (isDateOnlyCell(t) || LEADING_DATE_IN_CELL.test(t)) starts.push(i)
  }
  return starts
}

function dateStrFromSegmentSubparts(subparts: string[]): string {
  const firstCell = (subparts[0] ?? '').trim()
  const lead = firstCell.match(LEADING_DATE_IN_CELL)
  if (lead) return lead[1]!
  if (isDateOnlyCell(firstCell)) {
    const dm = firstCell.match(DATE_ANYWHERE)
    return dm ? dm[0] : firstCell
  }
  const dm = firstCell.match(DATE_ANYWHERE)
  return dm ? dm[0] : firstCell
}

/**
 * Split one extracted row into multiple date/job/qty columns (e.g. two jobs for one Micro SD line).
 * Unifies date-only columns and leading-date-in-cell so mixed PDF layouts still split.
 */
function splitPartsIntoDatedJobSegments(parts: string[]): { dateStr: string; subparts: string[] }[] {
  const trimmed = stripLeadingPlusMinusCells(parts)
  const starts = allDateSegmentStartIndices(trimmed)
  if (starts.length >= 2) {
    const out: { dateStr: string; subparts: string[] }[] = []
    for (let s = 0; s < starts.length; s++) {
      const from = starts[s]!
      const to = s + 1 < starts.length ? starts[s + 1]! : trimmed.length
      const subparts = trimmed.slice(from, to)
      const dateStr = dateStrFromSegmentSubparts(subparts)
      if (dateStr) out.push({ dateStr, subparts })
    }
    return out
  }
  const exact = splitPartsIntoDateSegments(trimmed)
  if (exact.length >= 2) return exact
  return splitPartsLeadingDateSegments(trimmed)
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
    /\b(SBC|Dowbuilt|Dovetail|Lohss Construction|Cohutta Lee Builders|Teton Heritage Builders|Blue Ribbon Builders|James Loudspeaker|Samsung|Apple|SanDisk|HP|Sonance|Honeywell|First Alert|AVPro Edge|Crestron|Faradite|GRI|CUSTOM ROMAN|QS PALLADIOM|SIVOIA|Middle Atlantic|LSTU|Sanus|System Sensor|Interlogix|Lutron|CLOUD GATEWAY|Ubiquiti|Montana Cabin|Smart Home Systems|Friend,|Stanley,|Young,|Perry,|Langlas & Assoc\.)\s*:\s*/i
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
  if (full) return stripJobBlobBeforePlusMinusColumns(full)

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

function normalizeManufacturerLabel(v: string | null): string | null {
  if (!v) return null
  const t = v.trim()
  if (/^sundisk$/i.test(t)) return 'SanDisk'
  return v.trim() || null
}

/** Long PDF “banner” lines that look like subtotals but are the first parts under a real vendor block. */
function isLikelyProductFamilyBannerNotSubtotal(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/\bCUSTOM\s+(ROLLER|ROMAN)\b/i.test(t)) return true
  if (/\bCUSTOM\s+ROMAN\s+KIT\b/i.test(t)) return true
  if (/\bCUSTOM\s+ROLLER\s+SHADES?\b/i.test(t)) return true
  if (/\bQS\s+PALLADIOM\b/i.test(t) && /\b(SHADE|ROLLER)\b/i.test(t)) return true
  return false
}

/** OEM lines usually stocked via CDW/ADI/etc. — not direct-sale integrator brands (Crestron, Lutron, …). */
function looksLikeBroadlineStockedBrandSubtotal(s: string): boolean {
  const t = s.trim()
  if (t.length < 3 || t.length > 40) return false
  return /\b(SANDISK|SAMSUNG|APPLE|HONEYWELL|HP|LENOVO|DELL|MICROSOFT)\b/i.test(t)
}

/** When the PDF blue row is only “Crestron” / “Lutron” but the black row is the legal vendor name. */
function integratedVendorForShortManufacturerLabel(manufacturerLabel: string | null): string | null {
  const m = (manufacturerLabel ?? '').trim()
  if (!m) return null
  if (/^crestron$/i.test(m)) return 'Crestron Electronics'
  if (/^lutron$/i.test(m)) return 'Lutron Electronics'
  return null
}

function canonicalHierarchyVendorLabel(label: string): string {
  const t = label.trim()
  if (/^crestron$/i.test(t)) return 'Crestron Electronics'
  if (/^lutron$/i.test(t)) return 'Lutron Electronics'
  return t
}

/** Honeywell / alarm product families — never vendor/manufacturer subtotal rows. */
function isLikelyHoneywellStylePartFamily(s: string): boolean {
  const u = s.trim().toUpperCase().replace(/\s+/g, '')
  if (/^PRO(SIX|LTE|A)/.test(u)) return true
  if (/^VISTA/.test(u) || /^LYNX/.test(u)) return true
  if (/^CAMWE/.test(u) || /^PROA7/.test(u)) return true
  return false
}

/** Model / part tokens mis-read as vendor when a $ row fails line-item parsing. */
function isLikelySkuOrPartLabel(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  // CUSTOM ROLLER SHADES etc. are rejected as hierarchy only — they are still valid *part* descriptions.
  if (isLikelyHoneywellStylePartFamily(t)) return true
  if (/\s/.test(t) && t.length < 40) return false
  // All-caps run (no spaces), typical PDF part codes — exclude real OEM subtotal names.
  if (
    /^[A-Z0-9][A-Z0-9-]{5,}$/.test(t) &&
    !/\s/.test(t) &&
    t.length <= 22 &&
    !/^(HONEYWELL|CRESTRON|SAMSUNG|INTERLOGIX|LUTRON|UBIQUITI|SONANCE|SANUS|FARADITE)$/i.test(t)
  ) {
    return true
  }
  if (/[0-9]/.test(t) && /[A-Za-z]/.test(t) && !/^\d+$/.test(t)) {
    if (!/\s/.test(t) && t.length >= 4) return true
    if (/^[A-Z]{2,}\d/i.test(t.replace(/[\s\-_/]/g, ''))) return true
  }
  if (t.length >= 12 && !/\s/.test(t)) return true
  return false
}

/** Distributor (black row) — next blue row should be manufacturer, not a new vendor. */
function looksLikeDistributorName(s: string | null): boolean {
  if (!s?.trim()) return false
  return /\b(CDW|ADI|INGRAM|ANIXTER|SCANSOURCE|WESCO|TD\s*SYNNEX|AVB|BLACKBOX)\b/i.test(s)
}

/** Black/blue subtotal rows use short distributor or brand names, not part numbers. */
function isLikelyHierarchySubtotalLabel(label: string): boolean {
  const t = label.trim()
  if (!t || t.length > 88) return false
  if (isLikelyProductFamilyBannerNotSubtotal(t)) return false
  if (isLikelySkuOrPartLabel(t)) return false
  const words = t.split(/\s+/).filter(Boolean).length
  if (words > 14) return false
  return true
}

/**
 * Text before the first $ on a row, skipping PDF “+ - qty” columns (do not use raw
 * lastIndexOf('-') — it hits the quantity minus and steals the real vendor label).
 */
function extractSubtotalLabelBeforeMoney(parts: string[], vendorMoneyIndex: number): string {
  const chunk = parts.slice(0, vendorMoneyIndex)
  const out: string[] = []
  for (let j = 0; j < chunk.length; j++) {
    const t = (chunk[j] ?? '').trim()
    if (!t) continue
    if (t === '+' && (chunk[j + 1] ?? '').trim() === '-') {
      j++
      continue
    }
    if (t === '+' || t === '-') continue
    if (DATE_LINE.test(t) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) continue
    out.push(t)
  }
  return out.join(' ').trim()
}

/** Collect job title cells after a date cell up to $ / qty columns (handles “Smart Home Systems …”). */
function jobPhraseFromParts(parts: string[], dateIdx: number, endExclusive: number): string | null {
  const bits: string[] = []
  for (let j = dateIdx + 1; j < endExclusive; j++) {
    const jt = (parts[j] ?? '').trim()
    if (!jt) continue
    if (jt === '+' || jt === '-') break
    if (isMoney(jt)) break
    if (isInt(jt)) break
    if (DATE_ANYWHERE.test(jt) && j > dateIdx) break
    bits.push(jt)
  }
  const joined = bits.join(' ').trim()
  return joined || null
}

function trimTrailingQtyColumnsFromJobBlob(blob: string): string {
  let s = blob.replace(/\u00a0/g, ' ').trim()
  s = s.replace(/(?:[\t ]|\|)+\+[\t ]*\-[\t ]*\d+[\t ]*$/g, '').trim()
  s = s.replace(/(?:[\t ]|\|)+\d{1,4}[\t ]*$/g, '').trim()
  return s
}

/** Same calendar day as `MM/DD/YYYY` / `M/D/YYYY` — context lines often omit leading zeros. */
function dateTokenAliases(dateTok: string): string[] {
  const m = dateTok.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return [dateTok.trim()]
  const mo = Number.parseInt(m[1]!, 10)
  const day = Number.parseInt(m[2]!, 10)
  const y = m[3]!
  const z = (n: number) => String(n).padStart(2, '0')
  return [
    ...new Set([
      dateTok.trim(),
      `${z(mo)}/${z(day)}/${y}`,
      `${mo}/${day}/${y}`,
      `${z(mo)}/${day}/${y}`,
      `${mo}/${z(day)}/${y}`,
    ]),
  ]
}

function indexOfDateAlias(haystack: string, dateFromLine: string): { index: number; matched: string } | null {
  for (const a of dateTokenAliases(dateFromLine)) {
    const i = haystack.indexOf(a)
    if (i >= 0) return { index: i, matched: a }
  }
  return null
}

/** Normalize M/D/YYYY for map keys (rich job line → minimal purchase row). */
function canonicalDateKey(mdy: string): string | null {
  const m = mdy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const mo = Number.parseInt(m[1]!, 10)
  const d = Number.parseInt(m[2]!, 10)
  const y = Number.parseInt(m[3]!, 10)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function allDateTokensInLine(line: string): string[] {
  const out: string[] = []
  const re = /\d{1,2}\/\d{1,2}\/\d{4}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) != null) out.push(m[0])
  return out
}

function firstDateTokenInSlice(parts: string[], lo: number, hiExclusive: number): string | null {
  for (let j = lo; j < hiExclusive && j < parts.length; j++) {
    const dm = (parts[j] ?? '').trim().match(DATE_ANYWHERE)
    if (dm) return dm[0]
  }
  return null
}

/** Drop purchase columns merged into the job blob (`… SBC:… + - 6290W` → `… SBC:…`). */
function stripJobBlobBeforePlusMinusColumns(s: string): string {
  let t = s.replace(/\u00a0/g, ' ').trim()
  const tabIdx = t.search(/\t\+[\t ]*\t?-[\t ]*/)
  if (tabIdx >= 0) return t.slice(0, tabIdx).trim()
  const spIdx = t.search(/\s\+\s+-\s+/)
  if (spIdx >= 0) return t.slice(0, spIdx).trim()
  return t
}

/** `parts[lo..hi)` for one `$` column: cells before the last `+ -` pair (job side only). */
function splitMoneyRowIntoJobSideAndPurchaseTail(
  parts: string[],
  lo: number,
  hiExclusive: number
): { jobSide: string[]; purchaseTail: string[] } {
  const slice = parts.slice(lo, hiExclusive)
  let p = -1
  for (let i = slice.length - 2; i >= 0; i--) {
    if ((slice[i] ?? '').trim() === '+' && (slice[i + 1] ?? '').trim() === '-') {
      p = i
      break
    }
  }
  if (p < 0) return { jobSide: slice, purchaseTail: [] }
  return { jobSide: slice.slice(0, p), purchaseTail: slice.slice(p) }
}

/** Prefer a prior rich context line when the row job is empty/`date + -` noise. */
function jobFromRichContextLine(context: string | null, line: string): string | null {
  if (!context?.trim()) return null
  const dm = line.match(DATE_ANYWHERE)
  if (!dm) return null
  const d = dm[0]
  const hit = indexOfDateAlias(context, d)
  if (!hit) return null
  let tail = context.slice(hit.index).trim()
  const afterFirst = tail.slice(hit.matched.length)
  const nextD = afterFirst.match(/\d{1,2}\/\d{1,2}\/\d{4}/)
  if (nextD && nextD.index != null && nextD.index > 0) {
    tail = tail.slice(0, hit.matched.length + nextD.index).trim()
  }
  tail = stripJobBlobBeforePlusMinusColumns(tail)
  tail = trimTrailingQtyColumnsFromJobBlob(tail).replace(/\s+/g, ' ').trim()
  const body = tail.slice(hit.matched.length).trim()
  if (!body || isGarbageJobPhrase(body)) return null
  return tail
}

function jobFromDateKeyCache(
  richByKey: Map<string, string>,
  dateTok: string | null,
  line: string
): string | null {
  if (!dateTok) return null
  const k = canonicalDateKey(dateTok)
  if (!k) return null
  const stored = richByKey.get(k)
  if (!stored) return null
  const j = jobFromRichContextLine(stored, line)
  if (j && !isGarbageFullJob(j)) return j
  return null
}

function resolveJobForMoneyRow(
  rowJob: string | null,
  currentJob: string | null,
  currentContext: string | null,
  line: string,
  parts: string[],
  mi: number,
  prevMoneyIndex: number,
  richJobContextByDateKey: Map<string, string>
): string | null {
  if (rowJob?.trim() && !isGarbageFullJob(rowJob)) return rowJob.trim()
  if (currentJob?.trim() && !isGarbageFullJob(currentJob)) return currentJob.trim()
  const fromCtx = jobFromRichContextLine(currentContext, line)
  if (fromCtx && !isGarbageFullJob(fromCtx)) return fromCtx

  const rowDateTok = firstDateTokenInSlice(parts, prevMoneyIndex + 1, mi)
  const fromKey = jobFromDateKeyCache(richJobContextByDateKey, rowDateTok, line)
  if (fromKey) return fromKey

  let dateIdx: number | null = null
  for (let j = mi - 1; j > prevMoneyIndex; j--) {
    if (DATE_ANYWHERE.test((parts[j] ?? '').trim())) {
      dateIdx = j
      break
    }
  }
  if (dateIdx != null) {
    const dateCell = (parts[dateIdx] ?? '').trim()
    let dateStr = dateCell
    const lead = dateCell.match(LEADING_DATE_IN_CELL)
    if (lead) {
      dateStr = lead[1]!
    } else if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateCell)) {
      const dmx = dateCell.match(DATE_ANYWHERE)
      if (dmx) dateStr = dmx[0]
    }
    const { jobSide } = splitMoneyRowIntoJobSideAndPurchaseTail(parts, dateIdx, mi)
    const sliceForJob = jobSide.length > 0 ? jobSide : parts.slice(dateIdx, mi)
    const dj = detailJobLineFromDatedParts(sliceForJob, line, dateStr, currentContext)
    if (dj && !isGarbageFullJob(dj)) return dj
  }

  if (DATE_ANYWHERE.test(line)) {
    const blob = extractFullJobContextFromLine(line)
    const cleaned = blob
      ? trimTrailingQtyColumnsFromJobBlob(stripJobBlobBeforePlusMinusColumns(blob))
      : null
    const withDate = cleaned ? detailJobWithLeadingDate(line, cleaned) : null
    if (withDate && !isGarbageFullJob(withDate)) return withDate
  }

  if (DATE_ANYWHERE.test(line) && !isMinimalDatePlusMinusQtyLine(line)) {
    const selfJob = jobFromRichContextLine(line, line)
    if (selfJob && !isGarbageFullJob(selfJob)) return selfJob
  }

  const last = rowJob?.trim() ?? null
  if (last && !isGarbageFullJob(last)) return last
  return null
}

function resolveDetailRowJob(
  dj: string | null,
  dateStr: string,
  subparts: string[],
  line: string,
  currentContext: string | null,
  currentJob: string | null,
  richJobContextByDateKey: Map<string, string>
): string | null {
  if (dj?.trim() && !isGarbageFullJob(dj)) return dj.trim()
  if (currentJob?.trim() && !isGarbageFullJob(currentJob)) return currentJob.trim()
  const fromKey = jobFromDateKeyCache(richJobContextByDateKey, dateStr, line)
  if (fromKey) return fromKey
  const { jobSide } = splitMoneyRowIntoJobSideAndPurchaseTail(subparts, 0, subparts.length)
  const sliceForJob = jobSide.length > 0 ? jobSide : subparts
  const retry = detailJobLineFromDatedParts(sliceForJob, line, dateStr, currentContext)
  if (retry && !isGarbageFullJob(retry)) return retry
  const fromCtx = jobFromRichContextLine(currentContext, `${dateStr}\t`)
  if (fromCtx && !isGarbageFullJob(fromCtx)) return fromCtx
  return dj?.trim() ?? null
}

function isGarbageJobPhrase(phrase: string | null | undefined): boolean {
  if (!phrase?.trim()) return true
  const t = phrase.trim()
  const compact = t.replace(/\s+/g, ' ').trim()
  if (/^[\s+\-0-9]+$/i.test(t)) return true
  if (/^\+[\t ]*(-[\t ]*\d+)?\d*$/i.test(t)) return true
  if (/^\+ -(\s+\d+)?$/i.test(compact)) return true
  // "+ - 10 10", "+ - 1 1" — duplicate qty cells in job column
  if (/^\+ -(\s+\d{1,4})+$/i.test(compact)) return true
  return false
}

function isGarbageFullJob(job: string | null | undefined): boolean {
  if (!job?.trim()) return true
  const m = job.trim().match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+)$/s)
  if (m) return isGarbageJobPhrase(m[2])
  return false
}

/** Row is only `date TAB + TAB - TAB qty` (maybe repeated) — do not clobber richer currentContext/currentJob. */
function isMinimalDatePlusMinusQtyLine(line: string): boolean {
  const p = line.split('\t').map((s) => s.trim()).filter((s) => s.length > 0)
  if (p.length < 4) return false
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(p[0] ?? '')) return false
  let i = 1
  while (i < p.length) {
    if ((p[i] ?? '') === '+' && (p[i + 1] ?? '') === '-' && p[i + 2] != null && /^\d+$/.test(p[i + 2])) {
      i += 3
      continue
    }
    if (/^\d+$/.test(p[i] ?? '')) {
      i++
      continue
    }
    return false
  }
  return true
}

/** Job text in tab cells strictly between the date cell and the `+` column (PDF often omits it from token walks). */
function jobPhraseFromCellsBetweenDateAndPlus(cells: string[], segmentDateStr: string): string | null {
  let di = -1
  for (let i = 0; i < cells.length; i++) {
    const c = (cells[i] ?? '').trim()
    if (!c) continue
    if (c === segmentDateStr || LEADING_DATE_IN_CELL.test(c)) {
      di = i
      break
    }
  }
  if (di < 0) return null
  const plusIdx = cells.findIndex((c, j) => j > di && (c ?? '').trim() === '+')
  if (plusIdx > di + 1) {
    const middle = cells
      .slice(di + 1, plusIdx)
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .join(' ')
      .trim()
    const candidate = trimTrailingQtyColumnsFromJobBlob(middle)
    if (candidate && !isGarbageJobPhrase(candidate)) return candidate
  }
  const dateCell = (cells[di] ?? '').trim()
  const lead = dateCell.match(LEADING_DATE_IN_CELL)
  if (lead) {
    const rest = dateCell.slice(lead[0].length).trim()
    if (rest && !isGarbageJobPhrase(rest)) return rest
  }
  return null
}

/** Full job column text `MM/DD/YYYY …` from tab cells after the date (multi-word jobs). */
function detailJobLineFromDatedParts(
  subparts: string[],
  rawLine: string,
  segmentDateStr: string,
  contextFallback: string | null = null
): string | null {
  const dateTokenIndex = subparts.findIndex((p) => DATE_ANYWHERE.test(p))
  if (dateTokenIndex < 0) return null
  const dateCell = (subparts[dateTokenIndex] ?? '').trim()
  let extraFromCell = ''
  const lead = dateCell.match(LEADING_DATE_IN_CELL)
  if (lead) {
    extraFromCell = dateCell.slice(lead[0].length).trim()
  } else if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateCell)) {
    const dm = dateCell.match(DATE_ANYWHERE)
    if (dm && dm.index != null) {
      extraFromCell = dateCell.slice(dm.index + dm[0].length).trim()
    }
  }
  let phrase = jobPhraseFromParts(subparts, dateTokenIndex, subparts.length)
  if (extraFromCell && !isGarbageJobPhrase(extraFromCell)) {
    phrase = phrase ? `${extraFromCell} ${phrase}`.trim() : extraFromCell
  }
  if (!phrase?.trim()) {
    const fromLine = extractFullJobContextFromLine(rawLine)
    phrase = fromLine
      ? trimTrailingQtyColumnsFromJobBlob(stripJobBlobBeforePlusMinusColumns(fromLine))
      : null
  }
  if (isGarbageJobPhrase(phrase) || !phrase?.trim()) {
    const fromSeg = jobPhraseFromCellsBetweenDateAndPlus(
      subparts.map((s) => s.trim()),
      segmentDateStr
    )
    if (fromSeg) phrase = fromSeg
    else {
      const fromRaw = jobPhraseFromCellsBetweenDateAndPlus(
        rawLine.split('\t').map((s) => s.trim()),
        segmentDateStr
      )
      if (fromRaw) phrase = fromRaw
    }
  }
  if (isGarbageJobPhrase(phrase) && contextFallback) {
    const dateHit = indexOfDateAlias(contextFallback, segmentDateStr)
    if (dateHit != null) {
      let tail = contextFallback.slice(dateHit.index).trim()
      const matchedLen = dateHit.matched.length
      const afterFirst = tail.slice(matchedLen)
      const m2 = afterFirst.match(/\d{1,2}\/\d{1,2}\/\d{4}/)
      if (m2 && m2.index != null && m2.index > 0) {
        tail = tail.slice(0, matchedLen + m2.index).trim()
      }
      tail = trimTrailingQtyColumnsFromJobBlob(stripJobBlobBeforePlusMinusColumns(tail))
      const afterDate = tail.slice(matchedLen).trim()
      if (afterDate.length > 4 && !isGarbageJobPhrase(afterDate)) {
        return tail.replace(/\s+/g, ' ').trim()
      }
    }
  }
  if (isGarbageJobPhrase(phrase)) return null
  const body = (phrase ?? '').trim()
  if (!body) return null
  if (body.startsWith(segmentDateStr)) return body.replace(/\s+/g, ' ').trim()
  return `${segmentDateStr} ${body}`.replace(/\s+/g, ' ').trim()
}

function trimTrailingPlusMinusPair(slice: string[]): string[] {
  const s = [...slice]
  while (
    s.length >= 2 &&
    (s[s.length - 1] ?? '').trim() === '-' &&
    (s[s.length - 2] ?? '').trim() === '+'
  ) {
    s.pop()
    s.pop()
  }
  return s
}

/** Tokens between `-` and `$` that look like a part column (not bare PDF qty noise). */
function tokensBetweenMinusAndMoneyLookLikePart(tokens: string[]): boolean {
  if (tokens.length === 0) return false
  const joined = tokens.join(' ').trim()
  if (isLikelyProductFamilyBannerNotSubtotal(joined)) return true
  if (/^CUSTOM\s+/i.test(joined)) return true
  if (tokens.length === 1 && /^\d{1,4}$/.test(tokens[0]!)) {
    const n = Number.parseInt(tokens[0]!, 10)
    if (Number.isFinite(n) && n >= 0 && n <= 999) return false
  }
  return tokens.some((t) => /[A-Za-z]/.test(t))
}

function isWeakStandalonePartToken(extracted: string, pending: string | null): boolean {
  if (!pending?.trim()) return false
  const e = extracted.trim()
  const p = pending.trim()
  if (p.length > 14 && e.length <= 8 && p.toUpperCase().includes(e.toUpperCase())) return true
  if (isLikelyProductFamilyBannerNotSubtotal(p) && !isLikelyProductFamilyBannerNotSubtotal(e)) return true
  return false
}

function rowHasPlusMinusBeforeMoney(parts: string[], mi: number, prevMoneyIndex: number): boolean {
  for (let i = mi - 1; i > prevMoneyIndex + 1; i--) {
    if ((parts[i] ?? '').trim() === '-' && (parts[i - 1] ?? '').trim() === '+') return true
  }
  return false
}

/** PDF puts “CUSTOM ROLLER SHADES” alone on the line above `+ - … $`. */
function looksLikeOrphanPartDescriptionLine(line: string, parts: string[]): boolean {
  const joined = parts.join(' ').trim()
  if (!joined || joined.length > 140) return false
  if (parts.some((p) => isMoney(p))) return false
  if (DATE_ANYWHERE.test(line) && !isMinimalDatePlusMinusQtyLine(line)) return false
  if (/^Group\s+One$/i.test(joined)) return false
  if (/^(Lutron|Crestron)$/i.test(joined) && parts.length === 1) return false
  if (isLikelyProductFamilyBannerNotSubtotal(joined)) return true
  if (/^CUSTOM\s+(ROLLER|ROMAN)\b/i.test(joined)) return true
  return false
}

/** Join tab cells immediately before the `+ -` pair left of `$` (fixes 16 GB Micro SD, PROSIXCOMBO vs PROLTE bleed). */
function finalizePartDescriptionTokens(tokens: string[]): string | null {
  if (tokens.length === 0) return null
  if (tokens.length === 1) return tokens[0]!.trim() || null
  const last = tokens[tokens.length - 1]!.trim()
  const joined = tokens.map((t) => t.trim()).join(' ').trim()
  // Require digit or internal hyphen SKU — do not reduce "CUSTOM ROLLER SHADES" to "SHADES".
  const lastLooksLikeModel =
    (/^[A-Z0-9][A-Z0-9-]{3,}$/i.test(last) &&
      last.length >= 5 &&
      (/\d/.test(last) || /^[A-Z0-9]{2,}-[A-Za-z0-9]/i.test(last))) ||
    (/^[A-Z]{2,}\d/i.test(last) && last.length >= 4)
  if (lastLooksLikeModel && tokens.length >= 2) return last
  return joined || null
}

function extractPartDescriptionBeforePlusMinus(
  parts: string[],
  mi: number,
  prevMoneyIndex: number
): string | null {
  let minusIdx = -1
  for (let i = mi - 1; i > prevMoneyIndex + 1; i--) {
    if ((parts[i] ?? '').trim() === '-' && (parts[i - 1] ?? '').trim() === '+') {
      minusIdx = i
      break
    }
  }
  if (minusIdx < 0) return null

  const betweenMinusAndMoney = parts
    .slice(minusIdx + 1, mi)
    .map((p) => p.trim())
    .filter((t) => t.length > 0 && !isMoney(t))

  if (tokensBetweenMinusAndMoneyLookLikePart(betweenMinusAndMoney)) {
    return finalizePartDescriptionTokens(betweenMinusAndMoney)
  }

  const plusIdx = minusIdx - 1
  const pLastPart = plusIdx - 1
  if (pLastPart < prevMoneyIndex) return null

  const chunk: string[] = []
  let x = pLastPart
  let n = 0
  while (x > prevMoneyIndex && n < 14) {
    const tok = (parts[x] ?? '').trim()
    if (!tok) {
      x--
      continue
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(tok)) break
    if (LEADING_DATE_IN_CELL.test(tok)) break
    if (tok === '+' || tok === '-') break
    if (isMoney(tok)) break
    chunk.unshift(tok)
    n++
    x--
  }
  return finalizePartDescriptionTokens(chunk)
}

/** Fallback: single token left of `$` (digits/hyphen or short stock code like MHW). */
function legacySingleTokenPartLeftOfMoney(
  parts: string[],
  mi: number,
  prevMoneyIndex: number
): string | null {
  for (let k = mi - 1; k > prevMoneyIndex; k--) {
    const tok = (parts[k] ?? '').trim()
    if (!tok || tok === '+' || tok === '-') continue
    if (DATE_LINE.test(tok)) continue
    if (tok.includes('/')) continue
    if (tok.includes(':')) continue
    if (/[0-9]/.test(tok) && !/^\d+$/.test(tok) && !isMoney(tok)) {
      return tok.replace(/^\d+\s*\|\s*/, '').trim()
    }
    if (/[0-9\-]/.test(tok) && !/^\d+$/.test(tok) && tok.includes('-')) {
      return tok.replace(/^\d+\s*\|\s*/, '').trim()
    }
    if (/^[A-Za-z0-9][A-Za-z0-9+\-_/&]{1,54}$/.test(tok) && tok.length >= 2 && tok.length <= 56) {
      return tok
    }
  }
  return null
}

/**
 * Parse lines produced by extractPdfLinesFromArrayBuffer (tab-separated cells).
 * Heuristic: rows with "+", "-" in fixed columns and a numeric Required in the next cell.
 */
export function parsePurchaseManagerLines(lines: string[]): ParsedPurchaseLine[] {
  const out: ParsedPurchaseLine[] = []
  /** Black “vendor” subtotal row (distributor). */
  let hierarchyVendor: string | null = null
  /** Blue “manufacturer” subtotal row (brand under vendor). */
  let hierarchyManufacturer: string | null = null
  /** After a vendor subtotal, the next $ subtotal without a part is the manufacturer. */
  let awaitingManufacturerSubtotal = false
  let currentContext: string | null = null
  let currentJob: string | null = null
  let currentPartContext: {
    part: string
    vendor: string | null
    manufacturer: string | null
    cost: string | null
  } | null = null
  let pendingSummaryIndex: number | null = null
  let lastDetailSignature: string | null = null
  /** Date/job lines waiting for a following qty row (`+ - 2 2`, lone `3`, etc.). FIFO when several jobs stack up. */
  let pendingDetailJobs: { job: string; sourceLine: string }[] = []
  /**
   * PDF sometimes puts `MM/DD/YYYY` alone on one line and job/+/-/qty on the next; merge for detail parsing
   * (common for second job on Micro SD–style rows).
   */
  let pendingOrphanDateForDetail: string | null = null
  /** Part description on a line with no `$`; applies to the next `+ - … $` row. */
  let pendingStandalonePartLine: string | null = null
  /** Rich DATE+job header lines keyed by calendar day — money rows often only repeat the date. */
  const richJobContextByDateKey = new Map<string, string>()

  for (const rawLine of lines) {
    let line = rawLine.replace(/\u00a0/g, ' ').trim()
    if (line === '__PDF_PAGE_BREAK__') {
      pendingDetailJobs = []
      currentJob = null
      lastDetailSignature = null
      pendingOrphanDateForDetail = null
      pendingStandalonePartLine = null
      richJobContextByDateKey.clear()
      continue
    }
    if (!line || line.startsWith('--')) continue

    if (pendingOrphanDateForDetail && currentPartContext != null) {
      line = `${pendingOrphanDateForDetail}\t${line}`
      pendingOrphanDateForDetail = null
    }
    if (/page\s+\d+\s+of\s+\d+/i.test(line)) continue
    if (line.includes('Purchase Request Manager')) continue
    if (line === 'Create PO' || line === 'Add to Existing PO') continue
    if (line === 'Cost' || line === 'Options' || line === 'On-Hand') continue
    if (/^Group\s+One$/i.test(line)) continue

    const tabEarlyForOrphan = line.split('\t').map((s) => s.trim()).filter((s) => s.length > 0)
    if (
      currentPartContext != null &&
      pendingSummaryIndex != null &&
      tabEarlyForOrphan.length === 1 &&
      isDateOnlyCell(tabEarlyForOrphan[0]!)
    ) {
      pendingOrphanDateForDetail = tabEarlyForOrphan[0]!.trim()
      continue
    }

    // Date can appear at the start OR embedded in the row.
    // Treat the remainder after the date as job context, but don't `continue`
    // so we can still parse purchase rows on the same extracted line.
    if (DATE_ANYWHERE.test(line)) {
      if (!isMinimalDatePlusMinusQtyLine(line)) {
        const m = line.match(DATE_ANYWHERE)
        const idx = m?.index ?? 0
        currentContext = line
        const after = line.slice(idx + m![0].length).replace(/^\s*\|\s*/g, '').trim()
        const parsedJob = extractJobFromLine(line)
        const trimmed = parsedJob ? trimTrailingQtyColumnsFromJobBlob(parsedJob) : null
        const withDate = trimmed ? detailJobWithLeadingDate(line, trimmed) : null
        if (withDate?.trim() && !isGarbageFullJob(withDate.trim())) {
          currentJob = withDate.trim()
        } else if (trimmed?.trim()) {
          const wd = detailJobWithLeadingDate(line, trimmed)
          if (wd?.trim() && !isGarbageFullJob(wd.trim())) {
            currentJob = wd.trim()
          }
        } else if (
          after &&
          (after.includes('/') || after.includes(':') || /ref#|ref\b/i.test(after) || /\bwo\b/i.test(after))
        ) {
          const aj = trimTrailingQtyColumnsFromJobBlob(after)
          if (!isGarbageJobPhrase(aj)) currentJob = aj
        }
        for (const tok of allDateTokensInLine(line)) {
          const k = canonicalDateKey(tok)
          if (k) richJobContextByDateKey.set(k, line)
        }
      }
    }

    // Lone integer lines are usually noise, but when we have active part+job context
    // they often represent per-job request quantities (e.g. detail row quantity only).
    if (/^\d+$/.test(line) && line.length <= 4) {
      const qty = Number.parseInt(line, 10)
      if (currentPartContext && Number.isFinite(qty) && qty > 0) {
        const queued = pendingDetailJobs.length > 0 ? pendingDetailJobs.shift()! : null
        // Do not bind a bare qty line to stale currentJob — causes duplicate PROLTE-V / phantom rows.
        if (!queued) continue
        const useJob = queued.job
        if (useJob) {
          // If this item had a summary row, remove it once detail rows appear.
          if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
            out.splice(pendingSummaryIndex, 1)
            pendingSummaryIndex = null
          }
          const sig = `${currentPartContext.part}|${useJob}|${qty}|${queued.sourceLine}|${line}`
          if (sig !== lastDetailSignature) {
            out.push({
              vendor: currentPartContext.vendor,
              manufacturer: currentPartContext.manufacturer,
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

    const moneyIndices = parts.map((p, idx) => (isMoney(p) ? idx : -1)).filter((i) => i >= 0)
    if (moneyIndices.length === 0 && looksLikeOrphanPartDescriptionLine(line, parts)) {
      pendingStandalonePartLine = parts.join(' ').replace(/\s+/g, ' ').trim()
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

        let cleanedPart =
          extractPartDescriptionBeforePlusMinus(parts, mi, prevMoneyIndex) ??
          legacySingleTokenPartLeftOfMoney(parts, mi, prevMoneyIndex)

        if (
          pendingStandalonePartLine != null &&
          rowHasPlusMinusBeforeMoney(parts, mi, prevMoneyIndex)
        ) {
          if (!cleanedPart || isWeakStandalonePartToken(cleanedPart, pendingStandalonePartLine)) {
            cleanedPart = pendingStandalonePartLine
          }
        }

        if (cleanedPart && !isMoney(cleanedPart) && intsAfter.length >= 1) {
          awaitingManufacturerSubtotal = false

          if (pendingStandalonePartLine != null && rowHasPlusMinusBeforeMoney(parts, mi, prevMoneyIndex)) {
            pendingStandalonePartLine = null
          }

          if (currentPartContext != null && currentPartContext.part !== cleanedPart) {
            currentJob = null
            pendingDetailJobs = []
            pendingOrphanDateForDetail = null
          }

          const sliceTrim = trimTrailingPlusMinusPair(parts.slice(prevMoneyIndex + 1, mi))
          const datedSegs = splitPartsIntoDatedJobSegments(sliceTrim)

          if (datedSegs.length >= 2) {
            const detailRows: { job: string; required: number }[] = []
            for (const { dateStr, subparts } of datedSegs) {
              const subLine = subparts.join('\t')
              const dj = detailJobLineFromDatedParts(subparts, subLine, dateStr, currentContext)
              const rq = detailRequiredQtyOnJobLine(subparts)
              if (dj && rq != null) {
                detailRows.push({ job: dj, required: rq })
              }
            }
            if (detailRows.length === datedSegs.length) {
              if (!parsedAtLeastOne && pendingDetailJobs.length > 0) {
                pendingDetailJobs = []
              }
              if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
                out.splice(pendingSummaryIndex, 1)
                pendingSummaryIndex = null
              }
              for (let ri = 0; ri < detailRows.length; ri++) {
                const dr = detailRows[ri]!
                const seg = datedSegs[ri]!
                const jobOut = resolveDetailRowJob(
                  dr.job,
                  seg.dateStr,
                  seg.subparts,
                  line,
                  currentContext,
                  currentJob,
                  richJobContextByDateKey
                )
                const sig = `${cleanedPart}|${jobOut}|${dr.required}|${line}|mi${mi}`
                if (sig !== lastDetailSignature) {
                  out.push({
                    vendor: hierarchyVendor,
                    manufacturer: hierarchyManufacturer,
                    job: jobOut,
                    part: cleanedPart,
                    required: dr.required,
                    received: null,
                    ordered: null,
                    cost: parts[mi] ?? null,
                    context_line: currentContext,
                    raw_line: line,
                  })
                  lastDetailSignature = sig
                }
              }
              currentPartContext = {
                part: cleanedPart,
                vendor: hierarchyVendor,
                manufacturer: hierarchyManufacturer,
                cost: parts[mi] ?? null,
              }
              pendingSummaryIndex = null
              parsedAtLeastOne = true
              prevMoneyIndex = mi
              continue
            }
          }

          // Same-line date + multi-cell job (e.g. Smart Home Systems) before part/$; do not use previous part’s job.
          let rowJob: string | null = currentJob
          let dateIdx: number | null = null
          for (let j = mi - 1; j > prevMoneyIndex; j--) {
            const jt = (parts[j] ?? '').trim()
            if (DATE_ANYWHERE.test(jt)) {
              dateIdx = j
              break
            }
          }
          if (dateIdx != null) {
            const dateCell = (parts[dateIdx] ?? '').trim()
            let dateStr = dateCell
            let extraFromCell = ''
            const lead = dateCell.match(LEADING_DATE_IN_CELL)
            if (lead) {
              dateStr = lead[1]!
              extraFromCell = dateCell.slice(lead[0].length).trim()
            } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateCell)) {
              dateStr = dateCell
            } else {
              const dm = dateCell.match(DATE_ANYWHERE)
              if (dm && dm.index != null) {
                dateStr = dm[0]
                extraFromCell = dateCell.slice(dm.index + dm[0].length).trim()
              }
            }
            const { jobSide } = splitMoneyRowIntoJobSideAndPurchaseTail(parts, dateIdx, mi)
            const sliceForJob = jobSide.length > 0 ? jobSide : parts.slice(dateIdx, mi)
            const dj = detailJobLineFromDatedParts(sliceForJob, line, dateStr, currentContext)
            if (dj) {
              rowJob = dj
            } else {
              let phrase = jobPhraseFromParts(parts, dateIdx, mi)
              if (extraFromCell && !isGarbageJobPhrase(extraFromCell)) {
                phrase = phrase ? `${extraFromCell} ${phrase}`.trim() : extraFromCell
              }
              if (phrase && !isGarbageJobPhrase(phrase)) {
                rowJob = `${dateStr} ${phrase}`.replace(/\s+/g, ' ').trim()
              }
            }
          }
          rowJob = resolveJobForMoneyRow(
            rowJob,
            currentJob,
            currentContext,
            line,
            parts,
            mi,
            prevMoneyIndex,
            richJobContextByDateKey
          )

          const required = intsAfter[0] ?? 0
          const received = intsAfter.length >= 2 ? intsAfter[1]! : null
          const ordered = intsAfter.length >= 3 ? intsAfter[2]! : null

          if (!parsedAtLeastOne && pendingDetailJobs.length > 0) {
            pendingDetailJobs = []
          }

          out.push({
            vendor: hierarchyVendor,
            manufacturer: hierarchyManufacturer,
            job: rowJob,
            part: cleanedPart,
            required: Number.isFinite(required) ? required : 0,
            received,
            ordered,
            cost: parts[mi] ?? null,
            context_line: currentContext,
            raw_line: line,
          })
          currentPartContext = {
            part: cleanedPart,
            vendor: hierarchyVendor,
            manufacturer: hierarchyManufacturer,
            cost: parts[mi] ?? null,
          }
          pendingSummaryIndex = out.length - 1
          parsedAtLeastOne = true
        }
        prevMoneyIndex = mi
      }

      if (parsedAtLeastOne) continue

      // No part on this $ row: vendor (black) then manufacturer (blue). Ignore part-like “labels”.
      const vendorMoneyIndex = moneyIndices[0]!
      const label = extractSubtotalLabelBeforeMoney(parts, vendorMoneyIndex)
      if (
        label &&
        !isMoney(label) &&
        !DATE_LINE.test(label) &&
        !/^\d+$/.test(label) &&
        isLikelyHierarchySubtotalLabel(label)
      ) {
        if (awaitingManufacturerSubtotal && hierarchyVendor != null) {
          hierarchyManufacturer = normalizeManufacturerLabel(label)
          awaitingManufacturerSubtotal = false
          const iv = integratedVendorForShortManufacturerLabel(hierarchyManufacturer)
          if (iv && looksLikeDistributorName(hierarchyVendor)) {
            hierarchyVendor = iv
          }
        } else if (
          !awaitingManufacturerSubtotal &&
          looksLikeDistributorName(hierarchyVendor) &&
          looksLikeBroadlineStockedBrandSubtotal(label)
        ) {
          hierarchyManufacturer = normalizeManufacturerLabel(label)
        } else if (
          hierarchyVendor != null &&
          /\bgroup\s+one\b/i.test(hierarchyVendor) &&
          /^system\s+sensor\b/i.test(label.trim())
        ) {
          hierarchyManufacturer = normalizeManufacturerLabel(label)
          awaitingManufacturerSubtotal = false
        } else {
          const rawV = label.trim() || null
          hierarchyVendor = rawV ? canonicalHierarchyVendorLabel(rawV) : null
          hierarchyManufacturer = null
          awaitingManufacturerSubtotal = true
        }
        continue
      }
      // $ row that is not a line item and not a hierarchy row — fall through to other parsers.
    }

    // Detail-row parsing (no cost on row):
    // Many exports place one summary line (with cost/total required) followed by
    // multiple date+job lines with per-job requested qty. We prefer those per-job rows.
    if (currentPartContext && DATE_ANYWHERE.test(line)) {
      const datedSegs = splitPartsIntoDatedJobSegments(parts)

      // Two+ job segments on one extracted row (date-only cells or cells starting with a date).
      if (datedSegs.length >= 2) {
        let handled = false
        for (const { dateStr, subparts } of datedSegs) {
          const subLine = subparts.join('\t')
          const detailJobDisplay = detailJobLineFromDatedParts(subparts, subLine, dateStr, currentContext)
          const detailJobBody =
            detailJobDisplay?.replace(new RegExp(`^${dateStr.replace(/\//g, '\\/')}\\s+`), '').trim() ?? null

          const detailRequired = detailRequiredQtyOnJobLine(subparts)

          if (detailJobDisplay && detailRequired != null) {
            if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
              out.splice(pendingSummaryIndex, 1)
              pendingSummaryIndex = null
            }
            out.push({
              vendor: currentPartContext.vendor,
              manufacturer: currentPartContext.manufacturer,
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
          } else if (detailJobBody && detailRequired == null) {
            for (const seg of splitCompoundJobLineIntoJobs(detailJobBody)) {
              const j = `${dateStr} ${seg.trim()}`.replace(/\s+/g, ' ').trim()
              pendingDetailJobs.push({ job: j, sourceLine: line })
            }
            handled = true
          }
        }
        if (handled) continue
      }

      const lineDate = line.match(DATE_ANYWHERE)
      const segmentDateStr = lineDate ? lineDate[0] : ''
      let detailJobDisplay =
        segmentDateStr ? detailJobLineFromDatedParts(parts, line, segmentDateStr, currentContext) : null
      if (!detailJobDisplay && segmentDateStr) {
        const fb = extractJobFromLine(line)
        if (fb) {
          detailJobDisplay =
            detailJobWithLeadingDate(line, trimTrailingQtyColumnsFromJobBlob(fb)) ?? null
        }
      }
      const detailJobBody =
        detailJobDisplay && segmentDateStr
          ? detailJobDisplay.replace(new RegExp(`^${segmentDateStr.replace(/\//g, '\\/')}\\s+`), '').trim()
          : null

      let detailRequired: number | null = detailRequiredQtyOnJobLine(parts)

      if (detailJobDisplay && detailRequired != null) {
        // If this item had a summary row, remove it once detail rows appear.
        if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
          out.splice(pendingSummaryIndex, 1)
          pendingSummaryIndex = null
        }

        out.push({
          vendor: currentPartContext.vendor,
          manufacturer: currentPartContext.manufacturer,
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
      if (detailJobBody && detailRequired == null) {
        for (const seg of splitCompoundJobLineIntoJobs(detailJobBody)) {
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
              manufacturer: currentPartContext.manufacturer,
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
              manufacturer: currentPartContext.manufacturer,
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
        if (pendingDetailJobs.length === 0) continue
        const { job: dj, sourceLine: src } = pendingDetailJobs.shift()!
        if (pendingSummaryIndex != null && pendingSummaryIndex >= 0 && pendingSummaryIndex < out.length) {
          out.splice(pendingSummaryIndex, 1)
          pendingSummaryIndex = null
        }
        const sig = `${currentPartContext.part}|${dj}|${qty}|${src}|${line}`
        if (sig !== lastDetailSignature) {
          out.push({
            vendor: currentPartContext.vendor,
            manufacturer: currentPartContext.manufacturer,
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

    // Fallback for older layouts: rightmost `+ - <int>` wins (avoids double rows when PDF has multiple + - runs).
    const plusIndex = parts.findIndex((p) => p === '+' || p === '+ ')
    const dashIndex = parts.findIndex((p) => p === '-')
    if (plusIndex >= 0 && dashIndex === plusIndex + 1) {
      for (let i = parts.length - 3; i >= 0; i--) {
        if (parts[i] !== '+') continue
        if (parts[i + 1] !== '-') continue
        const requiredToken = parts[i + 2]
        if (!isInt(requiredToken)) continue

        const rawPart = parts.slice(0, i).join(' ').trim()
        const required = Number.parseInt(requiredToken, 10)
        const cleanedPart = rawPart.replace(/^\d+\s*\|\s*/, '').trim()
        if (!cleanedPart || /^\d+$/.test(cleanedPart) || isMoney(cleanedPart)) continue
        if (DATE_LINE.test(cleanedPart) && !/[A-Za-z]{4,}/.test(cleanedPart)) continue

        out.push({
          vendor: hierarchyVendor,
          manufacturer: hierarchyManufacturer,
          job: currentJob,
          part: cleanedPart,
          required: Number.isFinite(required) ? required : 0,
          received: null,
          ordered: null,
          cost: null,
          context_line: currentContext,
          raw_line: line,
        })
        break
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
