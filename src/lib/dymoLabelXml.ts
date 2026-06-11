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

/** Convert millimeters to DYMO twips (1/1440 inch per twip). */
export function mmToTwips(mm: number): number {
  return Math.round((mm / 25.4) * 1440)
}

/** Known-valid PaperName/Id pairs (invalid PaperName → "DieCutLabel is not declared"). */
export type DymoPaperTemplate = {
  id: string
  paperName: string
  /** DYMO catalog / SKU (e.g. 30251). */
  catalogSku?: string
  /** Label Studio roll picker label. */
  studioLabel?: string
  /** When false, omitted from Label Studio roll list (PO print may still use the template). */
  studioVisible?: boolean
  /** Twin Turbo feed when user leaves feed on Auto (LabelWriter 450 TT). */
  studioTwinTurboRoll?: 'Left' | 'Right'
  /** Physical label face width in mm (what you see on the sticker). */
  widthMm: number
  /** Physical label face height in mm. */
  heightMm: number
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
    catalogSku: '30256',
    studioLabel: 'Large Shipping Labels',
    studioTwinTurboRoll: 'Left',
    widthMm: 59,
    heightMm: 102,
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
    catalogSku: '30323',
    studioLabel: '30323 Shipping Labels',
    studioTwinTurboRoll: 'Left',
    widthMm: LABEL_WIDTH_MM,
    heightMm: LABEL_HEIGHT_MM,
    /** Must match DYMO Connect 30323 Shipping schema (do not use mmToTwips here — driver rejects XML). */
    drawWidth: 5811,
    drawHeight: 1581,
    boundsX: 200,
    boundsY: 50,
    boundsWidth: 5411,
    boundsHeight: 1481,
  },
  {
    id: 'Durable1933085',
    /** Designer / canvas id — DYMO Connect on LW450 rejects this PaperName in XML. */
    paperName: '1933085 LW Durable 3/4 in x 2-1/2 in',
    catalogSku: '1933085',
    studioLabel: 'LW Durable Labels',
    studioTwinTurboRoll: 'Right',
    /** 3/4" × 2-1/2" durable (19×64 mm), landscape on LabelWriter. */
    widthMm: 64,
    heightMm: 19,
    drawWidth: mmToTwips(64),
    drawHeight: mmToTwips(19),
    boundsX: 127,
    boundsY: 34,
    boundsWidth: 3374,
    boundsHeight: 1009,
  },
  {
    id: 'Address30251',
    paperName: '30252 Address',
    catalogSku: '30251',
    studioLabel: '30251 Address Labels',
    /** 3½×1⅛ in address (89×28 mm landscape) — DYMO driver schema is 30252 Address. */
    widthMm: 89,
    heightMm: 28,
    drawWidth: 1581,
    drawHeight: 5040,
    boundsX: 332,
    boundsY: 150,
    boundsWidth: 4455,
    boundsHeight: 1260,
  },
] as const

/**
 * LW450 has no 1933085 durable schema — print via 30330 Return Address (0.75"×2")
 * on the right Twin Turbo roll. Physical durable is 0.75"×2.5"; layout is close enough.
 */
export function durableLw450PrintProxyTemplate(): DymoPaperTemplate {
  return {
    id: 'ReturnAddress30330',
    paperName: '30330 Return Address',
    catalogSku: '30330',
    studioVisible: false,
    widthMm: 64,
    heightMm: 19,
    drawWidth: 2930,
    drawHeight: 557,
    boundsX: 212,
    boundsY: 47,
    boundsWidth: 2509,
    boundsHeight: 477,
    studioTwinTurboRoll: 'Right',
  }
}

/** Rolls shown in Label Studio roll picker. */
export function labelStudioPaperTemplates(
  templates: readonly DymoPaperTemplate[] = DYMO_PAPER_TEMPLATES
): readonly DymoPaperTemplate[] {
  return templates.filter((t) => t.studioVisible !== false)
}

/**
 * Map designer roll → DieCutLabel envelope accepted by DYMO Connect on this PC.
 * LW Durable → 30330 Return Address proxy on LW450 (see durableLw450PrintProxyTemplate).
 */
export function dymoTemplateForStudioPrint(template: DymoPaperTemplate): DymoPaperTemplate {
  if (template.id !== 'Durable1933085') return template
  return durableLw450PrintProxyTemplate()
}

/** Inner printable rectangle (same padding as PO job/location split). */
export function poInnerBoundsForTemplate(template: DymoPaperTemplate): {
  x: number
  y: number
  width: number
  height: number
} {
  const padX = Math.round(template.boundsWidth * 0.04)
  const padY = Math.round(template.boundsHeight * 0.06)
  return {
    x: template.boundsX + padX,
    y: template.boundsY + padY,
    width: template.boundsWidth - padX * 2,
    height: template.boundsHeight - padY * 2,
  }
}

export type LabelRowLayout = {
  jobFontSize: number
  locationFontSize: number
  jobLines: string[]
  locationLines: string[]
}

/** Location text is always at least this many pt smaller than the job title. */
export const LABEL_JOB_LOC_FONT_GAP = 8
export const LABEL_LOCATION_MIN_FONT_SIZE = 12

type LabelBounds = { x: number; y: number; width: number; height: number }

/** Approximate twips per line at a given point size (Arial bold on 30323). */
const LINE_HEIGHT_TWIPS_PER_PT = 28

const LABEL_FONT_STEPS = [
  { size: 26, maxJobLines: 5, maxLocLines: 2 },
  { size: 24, maxJobLines: 6, maxLocLines: 2 },
  { size: 22, maxJobLines: 6, maxLocLines: 3 },
  { size: 20, maxJobLines: 7, maxLocLines: 3 },
  { size: 18, maxJobLines: 8, maxLocLines: 4 },
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

/** Chars that fit one line on a 30323 label at this font size (fixed size, no ShrinkToFit). */
function jobCharsPerLineForFont(fontSize: number): number {
  if (fontSize >= 24) return 14
  if (fontSize >= 21) return 15
  if (fontSize >= 18) return 17
  if (fontSize >= 16) return 18
  return 20
}

function textBlockHeightTwips(lineCount: number, fontSize: number): number {
  if (lineCount <= 0) return 0
  return lineCount * fontSize * LINE_HEIGHT_TWIPS_PER_PT
}

/** Keep job + gap + location inside the printable sticker height. */
function layoutFitsOnSticker(
  jobLines: string[],
  locationLines: string[],
  jobFontSize: number,
  locationFontSize: number,
  template: DymoPaperTemplate
): boolean {
  const margin = Math.round(template.boundsHeight * 0.1)
  const available = template.boundsHeight - margin
  const gap =
    jobLines.length > 0 && locationLines.length > 0
      ? Math.max(28, Math.round(template.boundsHeight * 0.05))
      : 0
  const total =
    textBlockHeightTwips(jobLines.length, jobFontSize) +
    gap +
    textBlockHeightTwips(locationLines.length, locationFontSize)
  return total <= available
}

function locationCharsPerLineForFont(locationFontSize: number): number {
  return jobCharsPerLineForFont(locationFontSize) + 4
}

/** Insert break-friendly spaces so long job names wrap onto multiple lines. */
function prepareJobTextForWrap(job: string): string {
  return job
    .replace(/([/\\|])/g, '$1 ')
    .replace(/(\s*[-–—]\s*)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function labelLayoutForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): LabelRowLayout {
  const { job, location } = jobAndLocationText(row)
  const hasJob = Boolean(job)
  const hasLocation = Boolean(location)

  const jobSource = job ? prepareJobTextForWrap(job) : ''
  const sizeTemplate = DYMO_PAPER_TEMPLATES.find((t) => t.paperName === '30323 Shipping') ?? DYMO_PAPER_TEMPLATES[0]

  for (const step of LABEL_FONT_STEPS) {
    const jobFontSize = step.size
    const locationFontSize = locationFontSizeForJob(jobFontSize, hasJob, hasLocation)
    const jobChars = jobCharsPerLineForFont(jobFontSize)
    const locChars = locationCharsPerLineForFont(locationFontSize)
    const jobLines = jobSource ? wrapTextToLines(jobSource, jobChars) : []
    const locationLines = location ? wrapTextToLines(location, locChars) : []
    if (
      jobLines.length <= step.maxJobLines &&
      locationLines.length <= step.maxLocLines &&
      layoutFitsOnSticker(jobLines, locationLines, jobFontSize, locationFontSize, sizeTemplate)
    ) {
      return { jobFontSize, locationFontSize, jobLines, locationLines }
    }
  }

  const fallback = LABEL_FONT_STEPS[LABEL_FONT_STEPS.length - 1]
  const jobFontSize = fallback.size
  const locationFontSize = locationFontSizeForJob(jobFontSize, hasJob, hasLocation)
  const jobChars = jobCharsPerLineForFont(jobFontSize)
  const locChars = locationCharsPerLineForFont(locationFontSize)
  const jobLines = jobSource ? wrapTextToLines(jobSource, jobChars) : []
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

/** DYMO renders multi-line text reliably as one Element with embedded newlines. */
function buildStyledTextBlockXml(lines: string[], fontSize: number, bold = true): string {
  const attrs = fontAttributesXml(fontSize, bold)
  const block = (lines.length > 0 ? lines : ['']).map(escapeXmlText).join('\n')
  return `<Element><String>${block}</String><Attributes>${attrs}</Attributes></Element>`
}

function buildTextObjectXml(
  objectName: string,
  lines: string[],
  fontSize: number,
  bounds: LabelBounds,
  options: { textFitMode: 'None' | 'ShrinkToFit'; bold?: boolean }
): string {
  const styled = buildStyledTextBlockXml(lines, fontSize, options.bold ?? true)
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
    `<UseFullFontHeight>False</UseFullFontHeight>` +
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
  const base = poInnerBoundsForTemplate(template)

  const hasJob = jobLines.length > 0 && jobLines[0] !== '(no text)'
  const hasLoc = locationLines.length > 0

  if (hasJob && hasLoc) {
    const gap = Math.max(28, Math.round(base.height * 0.06))
    const inner = base.height - gap
    const jobLineCount = Math.max(1, jobLines.length)
    const locLineCount = Math.max(1, locationLines.length)
    const jobShare = jobLineCount / (jobLineCount + locLineCount)
    const jobHeight = Math.round(inner * Math.min(0.72, 0.42 + jobShare * 0.34))
    const locHeight = Math.max(Math.round(inner * 0.22), inner - jobHeight)
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
