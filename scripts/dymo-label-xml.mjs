/** DYMO 30323 Shipping — Landscape; printable box 2218×608 @ (128,18). */
const LABEL_DRAW_WIDTH = 2382
const LABEL_DRAW_HEIGHT = 638
const LABEL_PRINTABLE_X = 128
const LABEL_PRINTABLE_Y = 18
const LABEL_PRINTABLE_WIDTH = 2218
const LABEL_PRINTABLE_HEIGHT = 608
const LABEL_MAX_FONT_SIZE = 96
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

export function escapeXmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

export function wrapText(text, maxChars) {
  const t = String(text || '').trim()
  if (!t) return []
  const lines = []
  let current = ''
  const flush = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }
  for (const word of t.split(/\s+/)) {
    let rest = word
    while (rest.length) {
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
  flush()
  return lines
}

function labelLinesForPrint(row) {
  const job = String(row.job_name || row.item_name || '').trim()
  const loc = String(row.location_name || '').trim()
  const parts = []
  if (job) parts.push(...wrapText(job, MAX_CHARS_PER_LINE))
  if (loc) parts.push(...wrapText(loc, MAX_CHARS_PER_LINE))
  if (parts.length === 0) return ['—']
  return parts.slice(0, MAX_LINES)
}

export function labelLayoutForRow(row) {
  const lines = labelLinesForPrint(row)
  return { fontSize: LABEL_MAX_FONT_SIZE, lines }
}

function buildStyledTextXml(lines, fontSize) {
  const font = `<Font Family="Arial" Size="${fontSize}" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>`
  const body = lines.map((line) => escapeXmlText(line)).join('&#10;')
  return `        <Element><String>${body}</String><Attributes>${font}</Attributes></Element>`
}

export function buildLabelXmlForRow(row) {
  const lines = labelLinesForPrint(row)
  return LABEL_XML_TEMPLATE.replace(
    STYLED_TEXT_PLACEHOLDER,
    buildStyledTextXml(lines, LABEL_MAX_FONT_SIZE)
  )
}

export function assertDymoPrintSucceeded(result, endpoint) {
  if (result === true) return
  const s = String(result ?? '').trim()
  if (!s || s.toLowerCase() === 'true') return
  if (s.toLowerCase() === 'false') {
    throw new Error(
      `${endpoint}: DYMO rejected the label (add "30323 Shipping" in DYMO Connect or check roll size)`
    )
  }
  if (/error|exception|invalid|not found|failed/i.test(s)) {
    throw new Error(`${endpoint}: ${s.slice(0, 400)}`)
  }
}
