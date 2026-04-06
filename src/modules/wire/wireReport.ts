import type { WireBoxScan } from '../../types/wireBox'

/** Typical rough-in wire schedule row; `boxIdPatterns` match scanned `box_id` (case-insensitive, substring ok). */
export const ROUGH_IN_WIRE_REPORT_ROWS: { label: string; boxIdPatterns: string[] }[] = [
  { label: '14/2 NM-B w/ Gr', boxIdPatterns: ['14-2', '14/2', '142', 'nm142', 'nm-b-14-2'] },
  { label: '14/3 NM-B w/ Gr', boxIdPatterns: ['14-3', '14/3', '143', 'nm143'] },
  { label: '12/2 NM-B w/ Gr', boxIdPatterns: ['12-2', '12/2', '122', 'nm122'] },
  { label: '12/3 NM-B w/ Gr', boxIdPatterns: ['12-3', '12/3', '123', 'nm123'] },
  { label: '10/2 NM-B w/ Gr', boxIdPatterns: ['10-2', '10/2', '102', 'nm102'] },
  { label: '10/3 NM-B w/ Gr', boxIdPatterns: ['10-3', '10/3', '103', 'nm103'] },
  { label: '8/2 NM-B w/ Gr', boxIdPatterns: ['8-2', '8/2', '82', 'nm82'] },
  { label: '8/3 NM-B w/ Gr', boxIdPatterns: ['8-3', '8/3', '83', 'nm83'] },
  { label: '6/3 NM-B w/ Gr', boxIdPatterns: ['6-3', '6/3', '63', 'nm63'] },
  { label: '12/2 NM-B (250)', boxIdPatterns: ['12-2-250', '122-250'] },
  { label: '10/3 NM-B (250)', boxIdPatterns: ['10-3-250', '103-250'] },
  { label: 'Low voltage / Cat6', boxIdPatterns: ['cat6', 'cat-6', 'lv-', 'low-volt', 'comm'] },
  { label: '12/2 MC', boxIdPatterns: ['mc-12-2', 'mc122', '12-2-mc'] },
  { label: '14/2 MC', boxIdPatterns: ['mc-14-2', 'mc142', '14-2-mc'] },
  { label: '10 GA solid (ground)', boxIdPatterns: ['10ga', '10-ga', 'ground-wire', 'gr10'] },
]

export interface WireReportRow {
  wireType: string
  boxId: string | null
  startFt: number | null
  endFt: number | null
  usedFt: number | null
  notes: string
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

function scansForJob(scans: WireBoxScan[], jobName: string): WireBoxScan[] {
  const want = jobName.trim().toLowerCase()
  return scans.filter((s) => (s.job_name || '').trim().toLowerCase() === want)
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

export function buildWireMaterialsReport(jobName: string, allScans: WireBoxScan[]): WireReportRow[] {
  const jobScans = scansForJob(allScans, jobName)
  const byBox = new Map<string, WireBoxScan[]>()
  for (const s of jobScans) {
    const id = (s.box_id || '').trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (!byBox.has(key)) byBox.set(key, [])
    byBox.get(key)!.push(s)
  }

  const assignedBoxes = new Set<string>()
  const rows: WireReportRow[] = []

  for (const tpl of ROUGH_IN_WIRE_REPORT_ROWS) {
    const matchingKeys: string[] = []
    for (const [key, list] of byBox) {
      const representativeId = list[0]!.box_id
      if (boxMatchesTemplate(representativeId, tpl.boxIdPatterns)) {
        matchingKeys.push(key)
      }
    }
    if (matchingKeys.length === 0) {
      rows.push({
        wireType: tpl.label,
        boxId: null,
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
    for (const key of matchingKeys) {
      assignedBoxes.add(key)
      const list = byBox.get(key)!
      const boxId = list[0]!.box_id
      const { startFt, endFt, usedFt, notes } = usageForBoxScans(list)
      rows.push({
        wireType: tpl.label,
        boxId,
        startFt,
        endFt,
        usedFt,
        notes,
      })
    }
  }

  const otherRows: WireReportRow[] = []
  for (const [key, list] of byBox) {
    if (assignedBoxes.has(key)) continue
    const boxId = list[0]!.box_id
    const { startFt, endFt, usedFt, notes } = usageForBoxScans(list)
    otherRows.push({
      wireType: 'Other (scan)',
      boxId,
      startFt,
      endFt,
      usedFt,
      notes: notes || 'Box ID not matched to standard schedule row.',
    })
  }
  otherRows.sort((a, b) => (a.boxId || '').localeCompare(b.boxId || '', undefined, { numeric: true }))
  rows.push(...otherRows)

  return rows
}

export function reportRowsToCsv(jobName: string, rows: WireReportRow[]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = ['Wire type', 'Box ID', 'Start footage (ft)', 'End footage (ft)', 'Used (ft)', 'Notes']
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [r.wireType, r.boxId, r.startFt, r.endFt, r.usedFt, r.notes].map(esc).join(',')
    ),
  ]
  return `Job,"${jobName.replace(/"/g, '""')}"\n` + lines.join('\n')
}

export function reportRowsToHtmlDocument(jobName: string, rows: WireReportRow[]): string {
  const dateStr = new Date().toLocaleString()
  const rowHtml = rows
    .map(
      (r) => `<tr>
  <td>${escapeHtml(r.wireType)}</td>
  <td>${escapeHtml(r.boxId ?? '—')}</td>
  <td class="num">${r.startFt === null ? '—' : formatNum(r.startFt)}</td>
  <td class="num">${r.endFt === null ? '—' : formatNum(r.endFt)}</td>
  <td class="num">${r.usedFt === null ? '—' : formatNum(r.usedFt)}</td>
  <td class="notes">${escapeHtml(r.notes)}</td>
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
    .notes { font-size: 0.82rem; color: #444; }
    caption { text-align: left; font-weight: 600; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Wire materials used report</h1>
  <p class="meta">Job: <strong>${escapeHtml(jobName)}</strong> · Generated ${escapeHtml(dateStr)}</p>
  <p class="meta">Used = footage on the <strong>first</strong> scan for each box on this job minus footage on the <strong>last</strong> scan (remaining length on spool).</p>
  <table>
    <caption>Rough-in wire schedule</caption>
    <thead>
      <tr>
        <th>Wire type</th>
        <th>Box ID</th>
        <th>Start (ft)</th>
        <th>End (ft)</th>
        <th>Used (ft)</th>
        <th>Notes</th>
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

export function uniqueJobNamesFromScans(scans: WireBoxScan[]): string[] {
  const set = new Set<string>()
  for (const s of scans) {
    const j = (s.job_name || '').trim()
    if (j) set.add(j)
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
