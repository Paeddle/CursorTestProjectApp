import type { PoLabelPrintRow } from '../types/poIpoint'

/** Largest font that fits wrapped job + location within the 30323 text bounds. */
const LABEL_FONT_STEPS = [
  { size: 36, charsPerLine: 14, maxLines: 3 },
  { size: 32, charsPerLine: 17, maxLines: 4 },
  { size: 28, charsPerLine: 19, maxLines: 5 },
  { size: 24, charsPerLine: 21, maxLines: 6 },
] as const

/**
 * DYMO 30323 Shipping (54mm × 101mm). Large fixed font per label (no shrink-to-fit),
 * centered horizontally and vertically; long text wraps to multiple lines.
 */
export const LABEL_XML_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Shipping</Id>
  <PaperName>30323 Shipping</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="2382" Height="638" Rx="180" Ry="180"/>
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>LABEL_TEXT</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>None</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <!--DYMO_STYLED_TEXT-->
      </StyledText>
    </TextObject>
    <Bounds X="128" Y="18" Width="2218" Height="608"/>
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

function linesForJobAndLocation(
  row: { job_name?: string | null; item_name?: string | null; location_name?: string | null },
  charsPerLine: number
): string[] {
  const job = String(row.job_name || row.item_name || '').trim()
  const loc = String(row.location_name || '—').trim() || '—'
  const lines = [...wrapTextToLines(job, charsPerLine), ...wrapTextToLines(loc, charsPerLine)]
  return lines.length > 0 ? lines : ['—']
}

/** Pick the largest font size that keeps all wrapped lines on the label. */
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
  return {
    fontSize: fallback.size,
    lines: linesForJobAndLocation(row, fallback.charsPerLine),
  }
}

export function labelTextLinesForRow(row: {
  job_name?: string | null
  item_name?: string | null
  location_name?: string | null
}): string[] {
  return labelLayoutForRow(row).lines
}

function buildStyledTextXml(lines: string[], fontSize: number): string {
  const font = `<Font Family="Arial" Size="${fontSize}" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>`
  return lines
    .map(
      (line) =>
        `        <Element><String>${escapeXmlText(line)}</String><Attributes>${font}</Attributes></Element>`
    )
    .join('\n')
}

export function buildLabelXml(lines: string[], fontSize: number): string {
  return LABEL_XML_TEMPLATE.replace(STYLED_TEXT_PLACEHOLDER, buildStyledTextXml(lines, fontSize))
}

/** Build full label XML with job + room lines. */
export function buildLabelXmlForText(text: string): string {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return buildLabelXml(['—'], LABEL_FONT_STEPS[0].size)
  }
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
