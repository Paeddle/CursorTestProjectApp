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
  jobFontSize: number
  locationFontSize: number
  jobLines: string[]
  locationLines: string[]
}

/** Location text is always at least this many pt smaller than the job title. */
export const LABEL_JOB_LOC_FONT_GAP = 10
export const LABEL_LOCATION_MIN_FONT_SIZE = 12

type LabelBounds = { x: number; y: number; width: number; height: number }

const LABEL_FONT_STEPS = [
  { size: 32, charsPerLine: 22, jobWrapFactor: 0.5, maxJobLines: 5, maxLocLines: 2 },
  { size: 28, charsPerLine: 26, jobWrapFactor: 0.52, maxJobLines: 5, maxLocLines: 3 },
  { size: 24, charsPerLine: 30, jobWrapFactor: 0.55, maxJobLines: 6, maxLocLines: 3 },
  { size: 20, charsPerLine: 34, jobWrapFactor: 0.58, maxJobLines: 7, maxLocLines: 4 },
  { size: 18, charsPerLine: 38, jobWrapFactor: 0.62, maxJobLines: 8, maxLocLines: 4 },
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

function locationFontSizeForJob(
  jobFontSize: number,
  hasJob: boolean,
  hasLocation: boolean
): number {
  if (!hasLocation) return jobFontSize
  if (!hasJob) return jobFontSize
  return Math.max(LABEL_LOCATION_MIN_FONT_SIZE, jobFontSize - LABEL_JOB_LOC_FONT_GAP)
}

function jobCharsPerLine(stepChars: number, jobWrapFactor: number): number {
  return Math.max(10, Math.round(stepChars * jobWrapFactor))
}

function locationCharsPerLine(
  jobCharsPerLine: number,
  jobFontSize: number,
  locationFontSize: number
): number {
  return jobCharsPerLine + Math.round((jobFontSize - locationFontSize) * 0.85)
}

export function labelLayoutForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): LabelRowLayout {
  const { job, location } = jobAndLocationText(row)
  const hasJob = Boolean(job)
  const hasLocation = Boolean(location)

  for (const step of LABEL_FONT_STEPS) {
    const jobFontSize = step.size
    const locationFontSize = locationFontSizeForJob(jobFontSize, hasJob, hasLocation)
    const jobChars = jobCharsPerLine(step.charsPerLine, step.jobWrapFactor)
    const locChars = locationCharsPerLine(jobChars, jobFontSize, locationFontSize)
    const jobLines = job ? wrapTextToLines(job, jobChars) : []
    const locationLines = location ? wrapTextToLines(location, locChars) : []
    if (jobLines.length <= step.maxJobLines && locationLines.length <= step.maxLocLines) {
      return { jobFontSize, locationFontSize, jobLines, locationLines }
    }
  }

  const fallback = LABEL_FONT_STEPS[LABEL_FONT_STEPS.length - 1]
  const jobFontSize = fallback.size
  const locationFontSize = locationFontSizeForJob(jobFontSize, hasJob, hasLocation)
  const jobChars = jobCharsPerLine(fallback.charsPerLine, fallback.jobWrapFactor)
  const locChars = locationCharsPerLine(jobChars, jobFontSize, locationFontSize)
  const jobLines = job
    ? wrapTextToLines(job, jobChars).slice(0, fallback.maxJobLines)
    : []
  const locationLines = location
    ? wrapTextToLines(location, locChars).slice(0, fallback.maxLocLines)
    : []
  if (jobLines.length === 0 && locationLines.length === 0) {
    return {
      jobFontSize,
      locationFontSize,
      jobLines: ['(no text)'],
      locationLines: [],
    }
  }
  return { jobFontSize, locationFontSize, jobLines, locationLines }
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

function buildStyledTextXml(lines: string[], fontSize: number, bold = true): string {
  const attrs = fontAttributesXml(fontSize, bold)
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
  bounds: LabelBounds,
  options: { textFitMode: 'None' | 'ShrinkToFit'; bold?: boolean }
): string {
  const styled = buildStyledTextXml(lines, fontSize, options.bold ?? true)
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
    `<TextFitMode>${options.textFitMode}</TextFitMode>` +
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
    const gap = Math.max(48, Math.round(template.boundsHeight * 0.08))
    const inner = template.boundsHeight - gap
    const jobHeight = Math.round(inner * 0.62)
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
  const { jobFontSize, locationFontSize, jobLines, locationLines } = layout
  const regions = splitBoundsForLayout(template, jobLines, locationLines)
  const objects: string[] = []

  if (regions.job) {
    objects.push(
      buildTextObjectXml(LABEL_JOB_OBJECT_NAME, jobLines, jobFontSize, regions.job, {
        textFitMode: 'None',
        bold: true,
      })
    )
  }
  if (regions.location) {
    objects.push(
      buildTextObjectXml(
        LABEL_LOC_OBJECT_NAME,
        locationLines,
        locationFontSize,
        regions.location,
        { textFitMode: 'None', bold: true }
      )
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
  return buildLabelXml({ jobFontSize: fontSize, locationFontSize: fontSize, jobLines, locationLines }, template)
}

export function buildLabelXmlCandidates(layout: LabelRowLayout): string[] {
  return DYMO_PAPER_TEMPLATES.map((template) => buildLabelXml(layout, template))
}

export function buildLabelXmlForText(text: string): string {
  const raw = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const jobFontSize = LABEL_FONT_STEPS[0].size
  const locationFontSize = locationFontSizeForJob(jobFontSize, raw.length >= 1, raw.length > 1)
  if (raw.length === 0) {
    return buildLabelXml({
      jobFontSize,
      locationFontSize,
      jobLines: ['(no text)'],
      locationLines: [],
    })
  }
  if (raw.length === 1) {
    return buildLabelXml({ jobFontSize, locationFontSize, jobLines: raw, locationLines: [] })
  }
  return buildLabelXml({
    jobFontSize,
    locationFontSize,
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
