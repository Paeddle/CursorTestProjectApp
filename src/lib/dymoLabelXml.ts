import type { PoLabelPrintRow } from '../types/poIpoint'

/** Physical 30323 white shipping (face): ~59mm tall × 102mm wide in Landscape. */
export const LABEL_WIDTH_MM = 102
export const LABEL_HEIGHT_MM = 59

/**
 * DYMO 30323 Shipping in Landscape (matches DYMO Connect / Print Station).
 * Drawable label: 2382×638 twips; text box 2218×608 @ (128, 18).
 */
export const LABEL_DRAW_WIDTH = 2382
export const LABEL_DRAW_HEIGHT = 638
export const LABEL_PRINTABLE_X = 128
export const LABEL_PRINTABLE_Y = 18
export const LABEL_PRINTABLE_WIDTH = 2218
export const LABEL_PRINTABLE_HEIGHT = 608

/** Max font in XML; DYMO scales down with AlwaysFit to fill the text box. */
const LABEL_MAX_FONT_SIZE = 96

/** Soft wrap so long names do not force microscopic type when AlwaysFit scales. */
const MAX_CHARS_PER_LINE = 28
const MAX_LINES = 6

export const LABEL_XML_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Shipping</Id>
  <PaperName>30323 Shipping</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="${LABEL_DRAW_WIDTH}" Height="${LABEL_DRAW_HEIGHT}" Rx="180" Ry="180"/>
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>LABEL_TEXT</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>AlwaysFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <!--DYMO_STYLED_TEXT-->
      </StyledText>
    </TextObject>
    <Bounds X="${LABEL_PRINTABLE_X}" Y="${LABEL_PRINTABLE_Y}" Width="${LABEL_PRINTABLE_WIDTH}" Height="${LABEL_PRINTABLE_HEIGHT}"/>
  </ObjectInfo>
</DieCutLabel>`

const STYLED_TEXT_PLACEHOLDER = '        <!--DYMO_STYLED_TEXT-->'

/** Break text onto new lines at word boundaries; long tokens split to fit. */
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

/** Escape text embedded in DYMO label XML. */
export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

export function labelTextLinesForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  return labelLinesForPrint(row)
}

/** Job on first line(s), room on last — capped so AlwaysFit stays large. */
export function labelLinesForPrint(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  const job = String(row.job_name || row.item_name || '').trim()
  const loc = String(row.location_name || '').trim()
  const parts: string[] = []
  if (job) parts.push(...wrapTextToLines(job, MAX_CHARS_PER_LINE))
  if (loc) parts.push(...wrapTextToLines(loc, MAX_CHARS_PER_LINE))
  if (parts.length === 0) return ['—']
  return parts.slice(0, MAX_LINES)
}

/** @deprecated Use labelLinesForPrint — kept for callers that pick font steps. */
export function labelLayoutForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): { fontSize: number; lines: string[] } {
  const lines = labelLinesForPrint(row)
  return { fontSize: LABEL_MAX_FONT_SIZE, lines }
}

function buildStyledTextXml(lines: string[], fontSize: number): string {
  const font = `<Font Family="Arial" Size="${fontSize}" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>`
  const body = lines.map((line) => escapeXmlText(line)).join('&#10;')
  return `        <Element><String>${body}</String><Attributes>${font}</Attributes></Element>`
}

export function buildLabelXml(lines: string[], fontSize: number = LABEL_MAX_FONT_SIZE): string {
  return LABEL_XML_TEMPLATE.replace(
    STYLED_TEXT_PLACEHOLDER,
    buildStyledTextXml(lines, fontSize)
  )
}

export function buildLabelXmlForText(text: string): string {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
  return buildLabelXml(lines.length > 0 ? lines : ['—'])
}

export function buildLabelXmlForRow(
  row: Pick<PoLabelPrintRow, 'job_name' | 'item_name' | 'location_name'>
): string {
  return buildLabelXml(labelLinesForPrint(row))
}

/** Interpret DYMO PrintLabel / PrintLabel2 HTTP response bodies. */
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
