import type { WireBoxScan } from '../../types/wireBox'

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
  boxId: string | null
  startFt: number | null
  endFt: number | null
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

/** Catalog full-spool ft per preset id (keep aligned with wire-scanner-app `wireTypePresets.ts`). */
const WIRE_TYPE_DEFAULT_FT: Record<string, number> = {
  'rg6-quad-shield': 500,
  'cat6-550mhz-blue': 1000,
  'cat6-550mhz-gray': 1000,
  'cat6-550mhz-white': 1000,
  'cat6-550mhz-black': 1000,
  'cat6a-slim': 1000,
  cat7: 1000,
  cat8: 1000,
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

/** Default reel length (ft) as string, or empty if unknown. */
export function wireTypeIdToDefaultFt(id: string | null | undefined): string {
  const t = String(id ?? '').trim()
  if (!t) return ''
  const n = WIRE_TYPE_DEFAULT_FT[t]
  return n !== undefined ? String(n) : ''
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

function boxMatchesReportRow(list: WireBoxScan[], tpl: WireReportTemplateRow): boolean {
  if (scansMatchWireType(list, tpl.wireTypeIds)) return true
  const representativeId = list[0]!.box_id
  return boxMatchesTemplate(representativeId, tpl.boxIdPatterns)
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
      if (boxMatchesReportRow(list, tpl)) matchingKeys.push(key)
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
