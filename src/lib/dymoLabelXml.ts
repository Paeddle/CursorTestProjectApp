import type { PoLabelPrintRow } from '../types/poIpoint'

/** Physical 30323 white shipping (face): ~102mm wide × 59mm tall when fed through LabelWriter. */
export const LABEL_WIDTH_MM = 102
export const LABEL_HEIGHT_MM = 59

/** DYMO object name — must match &lt;Name&gt; in the label XML. */
export const LABEL_TEXT_OBJECT_NAME = 'TEXT'

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

const LABEL_FONT_STEPS = [
  { size: 36, charsPerLine: 22, maxLines: 3 },
  { size: 32, charsPerLine: 24, maxLines: 4 },
  { size: 28, charsPerLine: 28, maxLines: 5 },
  { size: 24, charsPerLine: 32, maxLines: 6 },
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

export function labelLinesForPrint(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  const job = String(row.job_name || row.item_name || '').trim()
  const loc = String(row.location_name || '').trim()
  const parts: string[] = []
  if (job) parts.push(...wrapTextToLines(job, 32))
  if (loc) parts.push(...wrapTextToLines(loc, 32))
  if (parts.length === 0) return ['(no text)']
  return parts
}

export function labelTextLinesForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  return labelLinesForPrint(row)
}

function linesForJobAndLocation(
  row: { job_name?: string | null; item_name?: string | null; location_name?: string | null },
  charsPerLine: number
): string[] {
  const job = String(row.job_name || row.item_name || '').trim()
  const loc = String(row.location_name || '').trim()
  const block: string[] = []
  if (job) block.push(...wrapTextToLines(job, charsPerLine))
  if (loc) block.push(...wrapTextToLines(loc, charsPerLine))
  return block.length > 0 ? block : ['(no text)']
}

export function labelLayoutForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): { fontSize: number; lines: string[] } {
  for (const step of LABEL_FONT_STEPS) {
    const lines = linesForJobAndLocation(row, step.charsPerLine)
    if (lines.length <= step.maxLines) {
      return { fontSize: step.size, lines }
    }
  }
  const fallback = LABEL_FONT_STEPS[LABEL_FONT_STEPS.length - 1]
  const lines = linesForJobAndLocation(row, fallback.charsPerLine)
  return { fontSize: fallback.size, lines: lines.slice(0, fallback.maxLines) }
}

/** Plain text for DYMO setObjectText (job line, then location line). */
export function labelPlainTextForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string {
  const { lines } = labelLayoutForRow(row)
  return lines.join('\n')
}

/** Font attrs must match DYMO SDK samples (IsUnderline etc. fail schema validation). */
function fontAttributesXml(fontSize: number, bold = true): string {
  const b = bold ? 'True' : 'False'
  return (
    `<Font Family="Arial" Size="${fontSize}" Bold="${b}" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>`
  )
}

function buildStyledTextXml(lines: string[], fontSize: number): string {
  const attrs = fontAttributesXml(fontSize)
  const textLines = lines.length > 0 ? lines : ['(no text)']
  return textLines
    .map(
      (line) =>
        `<Element><String>${escapeXmlText(line)}</String><Attributes>${attrs}</Attributes></Element>`
    )
    .join('')
}

/** Complete DieCutLabel using a schema-known PaperName/Id (see DYMO DCD-SDK samples). */
export function buildLabelXml(
  lines: string[],
  fontSize: number,
  template: DymoPaperTemplate = DYMO_PAPER_TEMPLATES[0]
): string {
  const styled = buildStyledTextXml(lines, fontSize)
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
    `<ObjectInfo>` +
    `<TextObject>` +
    `<Name>${LABEL_TEXT_OBJECT_NAME}</Name>` +
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
    `<Bounds X="${t.boundsX}" Y="${t.boundsY}" Width="${t.boundsWidth}" Height="${t.boundsHeight}"/>` +
    `</ObjectInfo>` +
    `</DieCutLabel>`
  )
}

/** XML candidates to try when the installed roll / DYMO build rejects a PaperName. */
export function buildLabelXmlCandidates(
  lines: string[],
  fontSize: number
): string[] {
  return DYMO_PAPER_TEMPLATES.map((template) => buildLabelXml(lines, fontSize, template))
}

export function buildLabelXmlForText(text: string): string {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length === 0) return buildLabelXml(['(no text)'], LABEL_FONT_STEPS[0].size)
  const fontSize =
    LABEL_FONT_STEPS.find((s) => lines.length <= s.maxLines)?.size ??
    LABEL_FONT_STEPS[LABEL_FONT_STEPS.length - 1].size
  return buildLabelXml(lines, fontSize)
}

export function buildLabelXmlForRow(
  row: Pick<PoLabelPrintRow, 'job_name' | 'item_name' | 'location_name'>
): string {
  const { fontSize, lines } = labelLayoutForRow(row)
  return buildLabelXml(lines, fontSize)
}

export function buildLabelXmlCandidatesForRow(
  row: Pick<PoLabelPrintRow, 'job_name' | 'item_name' | 'location_name'>
): string[] {
  const { fontSize, lines } = labelLayoutForRow(row)
  return buildLabelXmlCandidates(lines, fontSize)
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
