import type { PoLabelPrintRow } from '../types/poIpoint'

/** Physical 30323 white shipping (face): ~102mm wide × 59mm tall when fed through LabelWriter. */
export const LABEL_WIDTH_MM = 102
export const LABEL_HEIGHT_MM = 59

/** DYMO 30323 Shipping — landscape draw area (portrait page 638×2382 rotated). */
export const LABEL_DRAW_WIDTH = 2382
export const LABEL_DRAW_HEIGHT = 638

/** DYMO object name — must match &lt;Name&gt; in the label XML. */
export const LABEL_TEXT_OBJECT_NAME = 'TEXT'

/**
 * Empty 30323 template for DYMO Connect framework (setObjectText after openLabelXml).
 * Text box covers the full draw area so Center/Middle alignment works.
 */
export const LABEL_XML_SKELETON = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Shipping</Id>
  <PaperName>30323 Shipping</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="${LABEL_DRAW_WIDTH}" Height="${LABEL_DRAW_HEIGHT}" Rx="180" Ry="180"/>
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>${LABEL_TEXT_OBJECT_NAME}</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element>
          <String> </String>
          <Attributes>
            <Font Family="Arial" Size="28" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>
          </Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="0" Y="0" Width="${LABEL_DRAW_WIDTH}" Height="${LABEL_DRAW_HEIGHT}"/>
  </ObjectInfo>
</DieCutLabel>`

/** @deprecated Use LABEL_XML_SKELETON */
export const LABEL_XML_TEMPLATE = LABEL_XML_SKELETON

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

function buildStyledTextXml(lines: string[], fontSize: number): string {
  const font = `<Font Family="Arial" Size="${fontSize}" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>`
  const body = lines.map((line) => escapeXmlText(line)).join('&#10;')
  if (!body.trim()) {
    return `        <Element><String>(no text)</String><Attributes>${font}</Attributes></Element>`
  }
  return `        <Element><String>${body}</String><Attributes>${font}</Attributes></Element>`
}

/** Full label XML for DYMO Connect HTTP PrintLabel2 (no framework). */
export function buildLabelXml(lines: string[], fontSize: number): string {
  const styled = buildStyledTextXml(lines, fontSize)
  return LABEL_XML_SKELETON.replace(
    /<StyledText>[\s\S]*?<\/StyledText>/,
    `<StyledText>\n${styled}\n      </StyledText>`
  )
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

export function assertDymoPrintSucceeded(result: unknown, endpoint: string): void {
  if (result === true) return
  const s = String(result ?? '').trim()
  if (!s || s.toLowerCase() === 'true') return
  if (s.toLowerCase() === 'false') {
    throw new Error(`${endpoint}: DYMO rejected the label (is 30323 Shipping loaded in DYMO Connect?)`)
  }
  if (/error|exception|invalid|not found|failed/i.test(s)) {
    throw new Error(`${endpoint}: ${s.slice(0, 400)}`)
  }
}
