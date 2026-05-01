import type { WireBoxScan, WireBoxSummary } from '../../types/wireBox'

/** Report schedule row: match by `wire_type` (scanner preset id) and/or `box_id` substrings. */
export type WireReportTemplateRow = {
  label: string
  boxIdPatterns: string[]
  wireTypeIds?: string[]
}

export const ROUGH_IN_WIRE_REPORT_ROWS: WireReportTemplateRow[] = [
  {
    label: 'RG-6 Quad Shield',
    wireTypeIds: ['rg6-quad-shield'],
    boxIdPatterns: ['rg6-quad-shield', 'rg6-quad', 'quad-shield', 'rg-6q'],
  },
  {
    label: 'Cat6 550MHz Blue',
    wireTypeIds: ['cat6-550mhz-blue'],
    boxIdPatterns: ['cat6-550mhz-blue', '550mhz-blue', 'cat6-blue'],
  },
  {
    label: 'Cat6 550MHz Gray',
    wireTypeIds: ['cat6-550mhz-gray'],
    boxIdPatterns: ['cat6-550mhz-gray', '550mhz-gray', '550mhz-grey', 'cat6-gray', 'cat6-grey'],
  },
  {
    label: 'Cat6 550MHz White',
    wireTypeIds: ['cat6-550mhz-white'],
    boxIdPatterns: ['cat6-550mhz-white', '550mhz-white', 'cat6-white'],
  },
  {
    label: 'Cat6 550MHz Black',
    wireTypeIds: ['cat6-550mhz-black'],
    boxIdPatterns: ['cat6-550mhz-black', '550mhz-black', 'cat6-black'],
  },
  { label: 'Cat6A Slim', wireTypeIds: ['cat6a-slim'], boxIdPatterns: ['cat6a-slim', 'cat6a-s'] },
  { label: 'Cat7', wireTypeIds: ['cat7'], boxIdPatterns: ['cat7', 'cat-7', 'cat7-'] },
  { label: 'Cat8', wireTypeIds: ['cat8'], boxIdPatterns: ['cat8', 'cat-8', 'cat8-'] },
  {
    label: 'Lutron Green',
    wireTypeIds: ['lutron-green'],
    boxIdPatterns: ['lutron-green', 'lutron-grn', 'ltgrn'],
  },
  {
    label: 'Lutron QS/M',
    wireTypeIds: ['lutron-qs-m'],
    boxIdPatterns: ['lutron-qs-m', 'lutron-qsm', 'lutron-qs'],
  },
  {
    label: 'Optical Fiber Cable',
    wireTypeIds: ['optical-fiber-cable'],
    boxIdPatterns: ['optical-fiber-cable', 'optical-fiber', 'fiber-optic', 'fiber'],
  },
  {
    label: '18-4CS Security Wire',
    wireTypeIds: ['18-4cs-security-wire'],
    boxIdPatterns: ['18-4cs-security-wire', '18-4cs', '184cs'],
  },
  {
    label: '18-2CS Security Wire',
    wireTypeIds: ['18-2cs-security-wire'],
    boxIdPatterns: ['18-2cs-security-wire', '18-2cs', '182cs'],
  },
  {
    label: '22-4 Stranded Security Wire',
    wireTypeIds: ['22-4-stranded-security-wire'],
    boxIdPatterns: ['22-4-stranded-security-wire', '22-4-stranded', '224-stranded'],
  },
  {
    label: '22-2 Stranded Security Wire',
    wireTypeIds: ['22-2-stranded-security-wire'],
    boxIdPatterns: ['22-2-stranded-security-wire', '22-2-stranded', '222-stranded'],
  },
  {
    label: '16-2FX DB Speaker Wire',
    wireTypeIds: ['16-2fx-db-speaker-wire'],
    boxIdPatterns: ['16-2fx-db-speaker-wire', '16-2fx', '162fx'],
  },
  {
    label: '16-4FX DB Speaker Wire',
    wireTypeIds: ['16-4fx-db-speaker-wire'],
    boxIdPatterns: ['16-4fx-db-speaker-wire', '16-4fx', '164fx'],
  },
  {
    label: '14-2FX DB Speaker Wire',
    wireTypeIds: ['14-2fx-db-speaker-wire'],
    boxIdPatterns: ['14-2fx-db-speaker-wire', '14-2fx', '142fx'],
  },
  {
    label: '14-4FX DB Speaker Wire',
    wireTypeIds: ['14-4fx-db-speaker-wire'],
    boxIdPatterns: ['14-4fx-db-speaker-wire', '14-4fx', '144fx'],
  },
  {
    label: '12-2FX DB Speaker Wire',
    wireTypeIds: ['12-2fx-db-speaker-wire'],
    boxIdPatterns: ['12-2fx-db-speaker-wire', '12-2fx', '122fx'],
  },
  {
    label: '12-4FX DB Speaker Wire',
    wireTypeIds: ['12-4fx-db-speaker-wire'],
    boxIdPatterns: ['12-4fx-db-speaker-wire', '12-4fx', '124fx'],
  },
]

export interface WireReportRow {
  wireType: string
  /** Sum of per-box “start” footage (first scan on this job for each spool). */
  startFt: number | null
  /** Sum of per-box “end” footage (last scan on this job, or 0 when tossed-empty). */
  endFt: number | null
  /** Total feet used on this job for this wire type (sum over boxes; usually start − end per box). */
  usedFt: number | null
  notes: string
}

/** Display label for a scanner `wire_type` preset id (falls back to spaced id). */
export function wireTypeIdToLabel(id: string | null | undefined): string {
  const t = String(id ?? '').trim()
  if (!t) return '—'
  const row = ROUGH_IN_WIRE_REPORT_ROWS.find((r) => r.wireTypeIds?.includes(t))
  return row?.label ?? t.replace(/-/g, ' ')
}

/** Catalog full-spool ft per preset id for UI fallback when `spool_capacity_ft` is missing (aligned with wire-scanner-app `wireTypePresets.ts`). */
const WIRE_TYPE_DEFAULT_FT: Record<string, number> = {
  'rg6-quad-shield': 500,
  'cat6-550mhz-blue': 1000,
  'cat6-550mhz-gray': 1000,
  'cat6-550mhz-white': 1000,
  'cat6-550mhz-black': 1000,
  'cat6a-slim': 1000,
  cat7: 1000,
  cat8: 1000,
  'optical-fiber-cable': 1000,
  'lutron-green': 1000,
  'lutron-qs-m': 1000,
  '18-4cs-security-wire': 500,
  '18-2cs-security-wire': 500,
  '22-4-stranded-security-wire': 1000,
  '22-2-stranded-security-wire': 1000,
  '16-2fx-db-speaker-wire': 500,
  '16-4fx-db-speaker-wire': 500,
  '14-2fx-db-speaker-wire': 500,
  '14-4fx-db-speaker-wire': 500,
  '12-2fx-db-speaker-wire': 500,
  '12-4fx-db-speaker-wire': 500,
}

/**
 * Default reel length (ft) as string, or empty if unknown.
 * Resolves case-insensitive preset ids so DB casing quirks still match the catalog.
 */
export function wireTypeIdToDefaultFt(id: string | null | undefined): string {
  const t = String(id ?? '').trim()
  if (!t) return ''
  if (WIRE_TYPE_DEFAULT_FT[t] !== undefined) return String(WIRE_TYPE_DEFAULT_FT[t])
  const tl = t.toLowerCase()
  for (const [k, n] of Object.entries(WIRE_TYPE_DEFAULT_FT)) {
    if (k.toLowerCase() === tl) return String(n)
  }
  const row = ROUGH_IN_WIRE_REPORT_ROWS.find((r) =>
    r.wireTypeIds?.some((wid) => wid.toLowerCase() === tl),
  )
  const canon = row?.wireTypeIds?.[0]
  if (canon != null && WIRE_TYPE_DEFAULT_FT[canon] !== undefined) {
    return String(WIRE_TYPE_DEFAULT_FT[canon])
  }
  return ''
}

export function parseFootage(raw: string): number | null {
  const s = String(raw ?? '')
    .replace(/,/g, '')
    .replace(/ft\.?/gi, '')
    .trim()
  const m = s.match(/-?[\d.]+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

function normalizeMatchKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/_/g, '-')
}

function boxMatchesTemplate(boxId: string, patterns: string[]): boolean {
  const b = normalizeMatchKey(boxId)
  return patterns.some((p) => {
    const pn = normalizeMatchKey(p)
    return b === pn || b.includes(pn) || pn.includes(b)
  })
}

function scansMatchWireType(list: WireBoxScan[], wireTypeIds: string[] | undefined): boolean {
  if (!wireTypeIds?.length) return false
  return list.some((s) => wireTypeIds.includes(String(s.wire_type ?? '').trim()))
}

/**
 * Whether this box belongs on the schedule row. Uses **all** scans for the box for wire_type so
 * intake / other-job rows still classify the spool; box_id patterns use the physical box id.
 */
function boxMatchesReportRow(
  jobList: WireBoxScan[],
  tpl: WireReportTemplateRow,
  allScans: WireBoxScan[]
): boolean {
  const boxId = (jobList[0]?.box_id || '').trim()
  if (!boxId) return false
  const boxAll = scansForBoxId(allScans, boxId)
  if (scansMatchWireType(boxAll, tpl.wireTypeIds)) return true
  return boxMatchesTemplate(boxId, tpl.boxIdPatterns)
}

function scansForJob(scans: WireBoxScan[], jobName: string): WireBoxScan[] {
  const want = jobName.trim().toLowerCase()
  return scans.filter((s) => (s.job_name || '').trim().toLowerCase() === want)
}

function jobNameMatchesReport(scan: WireBoxScan, jobName: string): boolean {
  return (scan.job_name || '').trim().toLowerCase() === jobName.trim().toLowerCase()
}

function scansForBoxId(allScans: WireBoxScan[], boxId: string): WireBoxScan[] {
  const key = boxId.trim().toLowerCase()
  return allScans.filter((s) => (s.box_id || '').trim().toLowerCase() === key)
}

/**
 * Latest event for the box is still a check-out on this job (spool never checked back in).
 * Treat as tossed empty when counting usage.
 */
export function isTossedEmptyAfterJobCheckout(boxAllScans: WireBoxScan[], jobName: string): boolean {
  if (!boxAllScans.length) return false
  const sorted = [...boxAllScans].sort(
    (a, c) => new Date(a.scanned_at).getTime() - new Date(c.scanned_at).getTime()
  )
  const latest = sorted[sorted.length - 1]!
  if (latest.check_type !== 'check_out') return false
  return jobNameMatchesReport(latest, jobName)
}

/** Footage on last check-out row for this job; end = 0, used = start (all wire assumed used / tossed). */
function usageForBoxTossedEmpty(jobScans: WireBoxScan[], jobName: string): {
  startFt: number | null
  endFt: number | null
  usedFt: number | null
  notes: string
} {
  const sortedJob = [...jobScans].sort(
    (a, c) => new Date(a.scanned_at).getTime() - new Date(c.scanned_at).getTime()
  )
  const checkouts = sortedJob.filter((s) => s.check_type === 'check_out' && jobNameMatchesReport(s, jobName))
  const ref =
    checkouts.length > 0 ? checkouts[checkouts.length - 1]! : sortedJob[sortedJob.length - 1]!
  const startFt = parseFootage(ref.current_footage)
  const endFt = 0
  if (startFt === null) {
    return {
      startFt: null,
      endFt: 0,
      usedFt: null,
      notes: 'Assumed empty (tossed); could not read check-out footage.',
    }
  }
  return {
    startFt,
    endFt,
    usedFt: startFt,
    notes: 'Assumed empty (tossed); end footage set to 0.',
  }
}

function usageForBoxScans(boxScans: WireBoxScan[]): {
  startFt: number | null
  endFt: number | null
  usedFt: number | null
  notes: string
} {
  if (boxScans.length === 0) {
    return { startFt: null, endFt: null, usedFt: null, notes: '' }
  }
  const sorted = [...boxScans].sort(
    (a, c) => new Date(a.scanned_at).getTime() - new Date(c.scanned_at).getTime()
  )
  const startFt = parseFootage(sorted[0]!.current_footage)
  const endFt = parseFootage(sorted[sorted.length - 1]!.current_footage)
  if (startFt === null || endFt === null) {
    return {
      startFt,
      endFt,
      usedFt: null,
      notes: 'Could not read start or end footage.',
    }
  }
  const usedFt = startFt - endFt
  const notes =
    sorted.length < 2
      ? 'Only one scan; usage is start − end on that single row.'
      : usedFt < 0
        ? 'Used is negative—verify check-in/out order or footage.'
        : ''
  return { startFt, endFt, usedFt, notes }
}

function sumNullableField(
  vals: (number | null)[]
): { total: number | null; anyMissing: boolean; anyPresent: boolean } {
  const nums = vals.filter((v): v is number => v !== null)
  const anyMissing = vals.some((v) => v === null)
  const anyPresent = nums.length > 0
  const total = anyPresent ? nums.reduce((a, b) => a + b, 0) : null
  return { total, anyMissing, anyPresent }
}

function aggregateBoxUsagesForReport(
  usages: { startFt: number | null; endFt: number | null; usedFt: number | null; notes: string }[]
): { startFt: number | null; endFt: number | null; usedFt: number | null; notes: string } {
  if (usages.length === 0) return { startFt: null, endFt: null, usedFt: null, notes: '' }

  const s = sumNullableField(usages.map((u) => u.startFt))
  const e = sumNullableField(usages.map((u) => u.endFt))
  const u = sumNullableField(usages.map((u) => u.usedFt))

  const uniqNotes = [...new Set(usages.map((n) => n.notes.trim()).filter(Boolean))]
  let notes = ''
  if (uniqNotes.length === 1) notes = uniqNotes[0]!
  else if (uniqNotes.length > 1 && uniqNotes.length <= 3) notes = uniqNotes.join(' · ')
  else if (uniqNotes.length > 3) notes = `${uniqNotes[0]} · (+${uniqNotes.length - 1} other cases)`

  const partialParts: string[] = []
  if (s.anyMissing && s.anyPresent) partialParts.push('start')
  if (e.anyMissing && e.anyPresent) partialParts.push('end')
  if (u.anyMissing && u.anyPresent) partialParts.push('used')
  if (partialParts.length > 0) {
    const suffix = `Partial totals (${partialParts.join(', ')}): some boxes missing footage.`
    notes = notes ? `${notes} ${suffix}` : suffix
  }
  if (!u.anyPresent && usages.length > 0) {
    const suffix = 'Could not total usage (footage missing on all matching boxes).'
    notes = notes ? `${notes} ${suffix}` : suffix
  }

  return {
    startFt: s.total,
    endFt: e.total,
    usedFt: u.total,
    notes: notes.trim(),
  }
}

/** Combine rows that share the same wire type (e.g. schedule row + “other” with same label). */
function mergeReportRowsByWireType(rows: WireReportRow[]): WireReportRow[] {
  const byLabel = new Map<string, WireReportRow[]>()
  for (const r of rows) {
    if (!byLabel.has(r.wireType)) byLabel.set(r.wireType, [])
    byLabel.get(r.wireType)!.push(r)
  }
  const merged = new Map<string, WireReportRow>()
  for (const [label, list] of byLabel) {
    if (list.length === 1) {
      merged.set(label, list[0]!)
      continue
    }
    const substantive = list.filter(
      (r) =>
        !(
          r.usedFt === null &&
          r.startFt === null &&
          r.endFt === null &&
          r.notes.trim() === ''
        )
    )
    if (substantive.length === 0) {
      merged.set(label, {
        wireType: label,
        startFt: null,
        endFt: null,
        usedFt: null,
        notes: '',
      })
      continue
    }
    const agg = aggregateBoxUsagesForReport(
      substantive.map((r) => ({
        startFt: r.startFt,
        endFt: r.endFt,
        usedFt: r.usedFt,
        notes: r.notes,
      }))
    )
    merged.set(label, {
      wireType: label,
      startFt: agg.startFt,
      endFt: agg.endFt,
      usedFt: agg.usedFt,
      notes: agg.notes,
    })
  }
  const ordered: WireReportRow[] = []
  const seen = new Set<string>()
  for (const tpl of ROUGH_IN_WIRE_REPORT_ROWS) {
    const r = merged.get(tpl.label)
    if (r) {
      ordered.push(r)
      seen.add(tpl.label)
    }
  }
  const rest = [...merged.keys()]
    .filter((k) => !seen.has(k))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  for (const k of rest) ordered.push(merged.get(k)!)
  return ordered
}

export type BuildWireMaterialsReportOptions = {
  /** When true, boxes whose latest scan is still check-out on this job use end ft = 0 (tossed empty). */
  countEmptyTossedBoxes?: boolean
}

export function buildWireMaterialsReport(
  jobName: string,
  allScans: WireBoxScan[],
  options?: BuildWireMaterialsReportOptions
): WireReportRow[] {
  const countTossed = options?.countEmptyTossedBoxes === true
  const jobScans = scansForJob(allScans, jobName)
  const byBox = new Map<string, WireBoxScan[]>()
  for (const s of jobScans) {
    const id = (s.box_id || '').trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (!byBox.has(key)) byBox.set(key, [])
    byBox.get(key)!.push(s)
  }

  const usageForReportBox = (list: WireBoxScan[]) => {
    const boxAll = scansForBoxId(allScans, list[0]!.box_id)
    if (countTossed && isTossedEmptyAfterJobCheckout(boxAll, jobName)) {
      return usageForBoxTossedEmpty(list, jobName)
    }
    return usageForBoxScans(list)
  }

  const assignedBoxes = new Set<string>()
  const rows: WireReportRow[] = []

  for (const tpl of ROUGH_IN_WIRE_REPORT_ROWS) {
    const matchingKeys: string[] = []
    for (const [key, list] of byBox) {
      if (assignedBoxes.has(key)) continue
      if (boxMatchesReportRow(list, tpl, allScans)) matchingKeys.push(key)
    }
    if (matchingKeys.length === 0) {
      rows.push({
        wireType: tpl.label,
        startFt: null,
        endFt: null,
        usedFt: null,
        notes: '',
      })
      continue
    }
    matchingKeys.sort((a, b) => {
      const ida = byBox.get(a)![0]!.box_id
      const idb = byBox.get(b)![0]!.box_id
      return ida.localeCompare(idb, undefined, { numeric: true })
    })
    const usages = matchingKeys.map((key) => usageForReportBox(byBox.get(key)!))
    const agg = aggregateBoxUsagesForReport(usages)
    rows.push({
      wireType: tpl.label,
      startFt: agg.startFt,
      endFt: agg.endFt,
      usedFt: agg.usedFt,
      notes: agg.notes,
    })
    for (const key of matchingKeys) assignedBoxes.add(key)
  }

  const otherGroups = new Map<
    string,
    { startFt: number | null; endFt: number | null; usedFt: number | null; notes: string }[]
  >()
  for (const [key, list] of byBox) {
    if (assignedBoxes.has(key)) continue
    const boxAll = scansForBoxId(allScans, list[0]!.box_id)
    const labelRaw = boxWireTypeDisplayLabel(boxAll).trim()
    const label = labelRaw && labelRaw !== '—' ? labelRaw : 'Other (untyped)'
    const u = usageForReportBox(list)
    const entry = {
      startFt: u.startFt,
      endFt: u.endFt,
      usedFt: u.usedFt,
      notes: u.notes || 'Box not matched to standard schedule row.',
    }
    if (!otherGroups.has(label)) otherGroups.set(label, [])
    otherGroups.get(label)!.push(entry)
  }
  const otherRows: WireReportRow[] = []
  for (const [wireType, parts] of [...otherGroups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: 'base', numeric: true })
  )) {
    const agg = aggregateBoxUsagesForReport(parts)
    otherRows.push({
      wireType,
      startFt: agg.startFt,
      endFt: agg.endFt,
      usedFt: agg.usedFt,
      notes: agg.notes,
    })
  }
  rows.push(...otherRows)

  return mergeReportRowsByWireType(rows)
}

export function reportRowsToCsv(jobName: string, rows: WireReportRow[]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = ['Wire type', 'Start (ft)', 'End (ft)', 'Total used (ft)']
  const lines = [
    header.join(','),
    ...rows.map((r) => [r.wireType, r.startFt, r.endFt, r.usedFt].map(esc).join(',')),
  ]
  return `Job,"${jobName.replace(/"/g, '""')}"\n` + lines.join('\n')
}

export function reportRowsToHtmlDocument(jobName: string, rows: WireReportRow[]): string {
  const dateStr = new Date().toLocaleString()
  const rowHtml = rows
    .map(
      (r) => `<tr>
  <td>${escapeHtml(r.wireType)}</td>
  <td class="num">${r.startFt === null ? '—' : formatNum(r.startFt)}</td>
  <td class="num">${r.endFt === null ? '—' : formatNum(r.endFt)}</td>
  <td class="num">${r.usedFt === null ? '—' : formatNum(r.usedFt)}</td>
</tr>`
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Materials used — ${escapeHtml(jobName)}</title>
  <style>
    body { font-family: system-ui, Segoe UI, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 1.15rem; margin: 0 0 4px 0; }
    .meta { color: #444; font-size: 0.9rem; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; max-width: 920px; font-size: 0.88rem; }
    th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #e8e8e8; font-weight: 600; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    caption { text-align: left; font-weight: 600; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Wire materials used report</h1>
  <p class="meta">Job: <strong>${escapeHtml(jobName)}</strong> · Generated ${escapeHtml(dateStr)}</p>
  <table>
    <caption>Rough-in wire schedule</caption>
    <thead>
      <tr>
        <th>Wire type</th>
        <th>Start (ft)</th>
        <th>End (ft)</th>
        <th>Total used (ft)</th>
      </tr>
    </thead>
    <tbody>
${rowHtml}
    </tbody>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** US Letter (8.5" × 11") portrait PDF; table spans nearly full page width, centered via equal side margins. */
export async function downloadWireMaterialsReportPdf(
  jobName: string,
  rows: WireReportRow[],
  filenameStem: string
): Promise<void> {
  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const marginMm = 12
  const tableWidth = pageW - 2 * marginMm
  const numColW = 26
  const wireColW = Math.max(48, tableWidth - 3 * numColW)

  let y = 18
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Wire materials used report', pageW / 2, y, { align: 'center' })
  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Job: ${jobName}`, pageW / 2, y, { align: 'center' })
  y += 5
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageW / 2, y, { align: 'center' })
  y += 10

  const head = [['Wire type', 'Start (ft)', 'End (ft)', 'Used (ft)']]
  const body = rows.map((r) => [
    r.wireType,
    r.startFt === null ? '—' : formatNum(r.startFt),
    r.endFt === null ? '—' : formatNum(r.endFt),
    r.usedFt === null ? '—' : formatNum(r.usedFt),
  ])

  autoTable(doc, {
    startY: y,
    head,
    body,
    tableWidth,
    styles: {
      fontSize: 9,
      cellPadding: 2,
      overflow: 'linebreak',
      halign: 'left',
      valign: 'middle',
    },
    headStyles: { fillColor: [41, 49, 63], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: wireColW },
      1: { cellWidth: numColW, halign: 'right' },
      2: { cellWidth: numColW, halign: 'right' },
      3: { cellWidth: numColW, halign: 'right' },
    },
    margin: { left: marginMm, right: marginMm },
  })

  doc.save(`wire-materials-${filenameStem}.pdf`)
}

export function uniqueJobNamesFromScans(scans: WireBoxScan[]): string[] {
  const set = new Set<string>()
  for (const s of scans) {
    const j = (s.job_name || '').trim()
    if (j) set.add(j)
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Internal / scanner job name — excluded from “materials used” job picker. */
const MATERIALS_REPORT_EXCLUDED_JOBS = new Set(['inventory'])

export function uniqueJobNamesForMaterialsReport(scans: WireBoxScan[]): string[] {
  return uniqueJobNamesFromScans(scans).filter(
    (j) => !MATERIALS_REPORT_EXCLUDED_JOBS.has(j.trim().toLowerCase())
  )
}

function scanTimeWireReport(scan: WireBoxScan): number {
  return new Date(scan.scanned_at).getTime()
}

function newestScanInBox(scans: WireBoxScan[]): WireBoxScan | null {
  if (!scans.length) return null
  return scans.reduce((a, b) => (scanTimeWireReport(a) >= scanTimeWireReport(b) ? a : b))
}

/** True when the latest scan for the box is not a check-out (wire is in stock, not out on a job). */
export function isBoxInInventory(scans: WireBoxScan[]): boolean {
  const latest = newestScanInBox(scans)
  if (!latest) return false
  if (latest.check_type === 'check_out') return false
  return true
}

/** Newest-first scan that carries wire profile fields (for inserts when latest row omits them). */
function newestProfileScanForBox(scans: WireBoxScan[]): WireBoxScan | null {
  const sorted = [...scans].sort((a, b) => scanTimeWireReport(b) - scanTimeWireReport(a))
  for (const scan of sorted) {
    const wt = String(scan.wire_type ?? '').trim()
    const lbl = (scan.wire_type_label || '').trim()
    if (wt || lbl) return scan
  }
  return null
}

export type WireBulkCheckoutInsertRow = {
  box_id: string
  job_name: string
  current_footage: string
  check_type: 'check_out'
  wire_type: string | null
  wire_type_label: string | null
  spool_capacity_ft: string | null
}

/**
 * Build one Supabase insert row for a bulk web check-out: latest on-hand scan’s footage,
 * same job name, check_out. Returns null if the box is not in inventory or footage is missing.
 */
export function buildWireBulkCheckoutInsert(
  summary: WireBoxSummary,
  jobName: string
): WireBulkCheckoutInsertRow | null {
  if (!isBoxInInventory(summary.scans)) return null
  const latest = newestScanInBox(summary.scans)
  if (!latest || latest.check_type === 'check_out') return null
  const job = jobName.trim()
  if (!job) return null
  const footage = (latest.current_footage || '').trim()
  if (!footage) return null

  const row: WireBulkCheckoutInsertRow = {
    box_id: summary.box_id.trim(),
    job_name: job,
    current_footage: footage,
    check_type: 'check_out',
    wire_type: null,
    wire_type_label: null,
    spool_capacity_ft: null,
  }

  const profile = newestProfileScanForBox(summary.scans)
  if (profile) {
    const wt = String(profile.wire_type ?? '').trim()
    const lbl = (profile.wire_type_label || '').trim()
    if (wt) row.wire_type = wt
    if (lbl || wt) row.wire_type_label = lbl || wt
    const cap = (profile.spool_capacity_ft || '').trim()
    if (cap) row.spool_capacity_ft = cap
  }

  return row
}

function formatWireTypeCell(scan: WireBoxScan): string {
  const label = (scan.wire_type_label || '').trim()
  if (label) return label
  return wireTypeIdToLabel(scan.wire_type)
}

/** Same wire-type label logic as Wire Tracker cards (newest scan with type info wins). */
export function boxWireTypeDisplayLabel(scans: WireBoxScan[]): string {
  const sorted = [...scans].sort((a, b) => scanTimeWireReport(b) - scanTimeWireReport(a))
  for (const scan of sorted) {
    const label = (scan.wire_type_label || '').trim()
    const wt = String(scan.wire_type ?? '').trim()
    if (label || wt) return formatWireTypeCell(scan)
  }
  return '—'
}

export interface WireInventoryRow {
  wireType: string
  boxCount: number
  /** Sum of `current_footage` on each box’s newest scan (latest check-in state). */
  totalRemainingFt: number
  /** Boxes where footage couldn’t be parsed (omitted from the sum). */
  boxesWithUnknownFootage: number
}

export function formatInventoryFtDisplay(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

/** One row per wire type: boxes currently checked in (latest scan is not check-out). */
export function buildWireInventoryRows(summaries: WireBoxSummary[]): WireInventoryRow[] {
  const map = new Map<
    string,
    { boxCount: number; totalRemainingFt: number; boxesWithUnknownFootage: number }
  >()
  for (const summary of summaries) {
    if (!isBoxInInventory(summary.scans)) continue
    const latest = newestScanInBox(summary.scans)
    if (!latest) continue
    const wire = boxWireTypeDisplayLabel(summary.scans)
    if (!map.has(wire)) {
      map.set(wire, { boxCount: 0, totalRemainingFt: 0, boxesWithUnknownFootage: 0 })
    }
    const entry = map.get(wire)!
    entry.boxCount += 1
    const ft = parseFootage(latest.current_footage)
    if (ft === null) entry.boxesWithUnknownFootage += 1
    else entry.totalRemainingFt += ft
  }
  const rows: WireInventoryRow[] = []
  for (const [wireType, data] of map) {
    rows.push({
      wireType,
      boxCount: data.boxCount,
      totalRemainingFt: data.totalRemainingFt,
      boxesWithUnknownFootage: data.boxesWithUnknownFootage,
    })
  }
  rows.sort((a, b) => a.wireType.localeCompare(b.wireType, undefined, { sensitivity: 'base' }))
  return rows
}
