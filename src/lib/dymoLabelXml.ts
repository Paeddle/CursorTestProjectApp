import type { PoLabelPrintRow } from '../types/poIpoint'

/** Physical 30323 white shipping (face): ~102mm wide × 59mm tall when fed through LabelWriter. */
export const LABEL_WIDTH_MM = 102
export const LABEL_HEIGHT_MM = 59

/** @deprecated Single-object name — labels use JOB + LOC objects. */
export const LABEL_TEXT_OBJECT_NAME = 'TEXT'
export const LABEL_JOB_OBJECT_NAME = 'JOB'
export const LABEL_LOC_OBJECT_NAME = 'LOC'

/** @deprecated Use buildLabelXmlForRow — kept for imports. */
export const LABEL_XML_SKELETON = ''
export const LABEL_XML_TEMPLATE = ''

/** Known-valid PaperName/Id pairs (invalid PaperName → "DieCutLabel is not declared"). */
export type DymoPaperTemplate = {
  id: string
  paperName: string
  drawWidth: number
  drawHeight: number
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
}

/** Order: sizes closest to 30323 / 30256 shipping first, then generic fallbacks. */
export const DYMO_PAPER_TEMPLATES: readonly DymoPaperTemplate[] = [
  {
    id: 'LargeShipping',
    paperName: '30256 Shipping',
    drawWidth: 3331,
    drawHeight: 5715,
    boundsX: 336,
    boundsY: 58,
    boundsWidth: 5338,
    boundsHeight: 3192,
  },
  {
    id: 'Shipping',
    paperName: '30323 Shipping',
    drawWidth: 5811,
    drawHeight: 1581,
    boundsX: 200,
    boundsY: 50,
    boundsWidth: 5411,
    boundsHeight: 1481,
  },
  {
    id: 'Address',
    paperName: '30252 Address',
    drawWidth: 1581,
    drawHeight: 5040,
    boundsX: 332,
    boundsY: 150,
    boundsWidth: 4455,
    boundsHeight: 1260,
  },
] as const

export type LabelRowLayout = {
  fontSize: number
  jobLines: string[]
  locationLines: string[]
}

type LabelBounds = { x: number; y: number; width: number; height: number }

const LABEL_FONT_STEPS = [
  { size: 32, charsPerLine: 22, maxJobLines: 3, maxLocLines: 2 },
  { size: 28, charsPerLine: 26, maxJobLines: 4, maxLocLines: 3 },
  { size: 24, charsPerLine: 30, maxJobLines: 5, maxLocLines: 3 },
  { size: 20, charsPerLine: 34, maxJobLines: 6, maxLocLines: 4 },
  { size: 18, charsPerLine: 38, maxJobLines: 7, maxLocLines: 4 },
] as const

export function wrapTextToLines(text: string, maxChars: number): string[] {
  const t = text.trim()
  if (!t || maxChars < 1) return []

  const lines: string[] = []
  let current = ''

  const flush = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }

  const appendToken = (token: string) => {
    let rest = token
    while (rest.length > 0) {
      if (!current) {
        if (rest.length <= maxChars) {
          current = rest
          rest = ''
        } else {
          lines.push(rest.slice(0, maxChars))
          rest = rest.slice(maxChars)
        }
        continue
      }

      const joined = `${current} ${rest}`
      if (joined.length <= maxChars) {
        current = joined
        rest = ''
      } else {
        flush()
      }
    }
  }

  for (const word of t.split(/\s+/)) {
    if (word) appendToken(word)
  }
  flush()
  return lines
}

export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

function jobAndLocationText(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): { job: string; location: string } {
  return {
    job: String(row.job_name || row.item_name || '').trim(),
    location: String(row.location_name || '').trim(),
  }
}

function wrapSections(
  job: string,
  location: string,
  charsPerLine: number,
  maxJobLines: number,
  maxLocLines: number
): { jobLines: string[]; locationLines: string[] } {
  const jobLines = job ? wrapTextToLines(job, charsPerLine).slice(0, maxJobLines) : []
  const locationLines = location
    ? wrapTextToLines(location, charsPerLine).slice(0, maxLocLines)
    : []
  if (jobLines.length === 0 && locationLines.length === 0) {
    return { jobLines: ['(no text)'], locationLines: [] }
  }
  return { jobLines, locationLines }
}

export function labelLayoutForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): LabelRowLayout {
  const { job, location } = jobAndLocationText(row)

  for (const step of LABEL_FONT_STEPS) {
    const jobLines = job ? wrapTextToLines(job, step.charsPerLine) : []
    const locationLines = location ? wrapTextToLines(location, step.charsPerLine) : []
    if (jobLines.length <= step.maxJobLines && locationLines.length <= step.maxLocLines) {
      return { fontSize: step.size, jobLines, locationLines }
    }
  }

  const fallback = LABEL_FONT_STEPS[LABEL_FONT_STEPS.length - 1]
  const { jobLines, locationLines } = wrapSections(
    job,
    location,
    fallback.charsPerLine,
    fallback.maxJobLines,
    fallback.maxLocLines
  )
  return { fontSize: fallback.size, jobLines, locationLines }
}

export function labelLinesForPrint(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  const { jobLines, locationLines } = labelLayoutForRow(row)
  if (jobLines.length && locationLines.length) return [...jobLines, '', ...locationLines]
  return jobLines.length ? jobLines : locationLines
}

export function labelTextLinesForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  return labelLinesForPrint(row)
}

/** Plain text: job block, blank line, location block. */
export function labelPlainTextForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string {
  const { jobLines, locationLines } = labelLayoutForRow(row)
  const parts: string[] = []
  if (jobLines.length) parts.push(jobLines.join('\n'))
  if (locationLines.length) parts.push(locationLines.join('\n'))
  return parts.join('\n\n')
}

function fontAttributesXml(fontSize: number, bold = true): string {
  const b = bold ? 'True' : 'False'
  return (
    `<Font Family="Arial" Size="${fontSize}" Bold="${b}" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>`
  )
}

function buildStyledTextXml(lines: string[], fontSize: number): string {
  const attrs = fontAttributesXml(fontSize)
  const textLines = lines.length > 0 ? lines : ['']
  return textLines
    .map(
      (line) =>
        `<Element><String>${escapeXmlText(line)}</String><Attributes>${attrs}</Attributes></Element>`
    )
    .join('')
}

function buildTextObjectXml(
  objectName: string,
  lines: string[],
  fontSize: number,
  bounds: LabelBounds
): string {
  const styled = buildStyledTextXml(lines, fontSize)
  return (
    `<ObjectInfo>` +
    `<TextObject>` +
    `<Name>${objectName}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName>` +
    `<Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored>` +
    `<IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment>` +
    `<VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>ShrinkToFit</TextFitMode>` +
    `<UseFullFontHeight>True</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized>` +
    `<StyledText>${styled}</StyledText>` +
    `</TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/>` +
    `</ObjectInfo>`
  )
}

/** Job in upper band, vertical gap, location in lower band. */
function splitBoundsForLayout(
  template: DymoPaperTemplate,
  jobLines: string[],
  locationLines: string[]
): { job?: LabelBounds; location?: LabelBounds } {
  const base = {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }

  const hasJob = jobLines.length > 0 && jobLines[0] !== '(no text)'
  const hasLoc = locationLines.length > 0

  if (hasJob && hasLoc) {
    const gap = Math.max(56, Math.round(template.boundsHeight * 0.1))
    const inner = template.boundsHeight - gap
    const jobHeight = Math.round(inner * 0.52)
    const locHeight = inner - jobHeight
    return {
      job: { x: base.x, y: base.y, width: base.width, height: jobHeight },
      location: {
        x: base.x,
        y: base.y + jobHeight + gap,
        width: base.width,
        height: locHeight,
      },
    }
  }

  if (hasJob) return { job: base }
  if (hasLoc) return { location: base }
  return { job: base }
}

/** Complete DieCutLabel using a schema-known PaperName/Id (see DYMO DCD-SDK samples). */
export function buildLabelXml(
  layout: LabelRowLayout,
  template: DymoPaperTemplate = DYMO_PAPER_TEMPLATES[0]
): string {
  const { fontSize, jobLines, locationLines } = layout
  const regions = splitBoundsForLayout(template, jobLines, locationLines)
  const objects: string[] = []

  if (regions.job) {
    objects.push(buildTextObjectXml(LABEL_JOB_OBJECT_NAME, jobLines, fontSize, regions.job))
  }
  if (regions.location) {
    objects.push(
      buildTextObjectXml(LABEL_LOC_OBJECT_NAME, locationLines, fontSize, regions.location)
    )
  }

  const t = template
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation>` +
    `<Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands>` +
    `<RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/>` +
    `</DrawCommands>` +
    objects.join('') +
    `</DieCutLabel>`
  )
}

/** @deprecated Pass layout object — kept for callers that still pass string[]. */
export function buildLabelXmlFromLines(
  lines: string[],
  fontSize: number,
  template?: DymoPaperTemplate
): string {
  const blank = lines.findIndex((l) => !l.trim())
  const jobLines = blank >= 0 ? lines.slice(0, blank) : lines
  const locationLines = blank >= 0 ? lines.slice(blank + 1).filter((l) => l.trim()) : []
  return buildLabelXml({ fontSize, jobLines, locationLines }, template)
}

export function buildLabelXmlCandidates(layout: LabelRowLayout): string[] {
  return DYMO_PAPER_TEMPLATES.map((template) => buildLabelXml(layout, template))
}

export function buildLabelXmlForText(text: string): string {
  const raw = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const fontSize = LABEL_FONT_STEPS[0].size
  if (raw.length === 0) {
    return buildLabelXml({ fontSize, jobLines: ['(no text)'], locationLines: [] })
  }
  if (raw.length === 1) {
    return buildLabelXml({ fontSize, jobLines: raw, locationLines: [] })
  }
  return buildLabelXml({
    fontSize,
    jobLines: [raw[0]],
    locationLines: raw.slice(1),
  })
}

export function buildLabelXmlForRow(
  row: Pick<PoLabelPrintRow, 'job_name' | 'item_name' | 'location_name'>
): string {
  return buildLabelXml(labelLayoutForRow(row))
}

export function buildLabelXmlCandidatesForRow(
  row: Pick<PoLabelPrintRow, 'job_name' | 'item_name' | 'location_name'>
): string[] {
  return buildLabelXmlCandidates(labelLayoutForRow(row))
}

export function assertDymoPrintSucceeded(result: unknown, endpoint: string): void {
  if (result === true) return
  const s = String(result ?? '').trim()
  if (!s || s.toLowerCase() === 'true') return
  if (s.toLowerCase() === 'false') {
    throw new Error(
      `${endpoint}: DYMO rejected the label. In DYMO Connect, add the roll size (30323 / 30256 Shipping) and reload Print Station.`
    )
  }
  if (/error|exception|invalid|not found|failed/i.test(s)) {
    throw new Error(`${endpoint}: ${s.slice(0, 400)}`)
  }
}
