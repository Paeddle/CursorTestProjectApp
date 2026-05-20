const LABEL_DRAW_WIDTH = 2382
const LABEL_DRAW_HEIGHT = 638
const LABEL_PRINTABLE_X = 128
const LABEL_PRINTABLE_Y = 18
const LABEL_PRINTABLE_WIDTH = 2218
const LABEL_PRINTABLE_HEIGHT = 608

const LABEL_FONT_STEPS = [
  { size: 48, charsPerLine: 22, maxLines: 3 },
  { size: 42, charsPerLine: 24, maxLines: 4 },
  { size: 36, charsPerLine: 28, maxLines: 5 },
  { size: 30, charsPerLine: 32, maxLines: 6 },
]

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
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
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

function linesForJobAndLocation(row, charsPerLine) {
  const job = String(row.job_name || row.item_name || '').trim()
  const loc = String(row.location_name || '').trim()
  const block = []
  if (job) block.push(...wrapText(job, charsPerLine))
  if (loc) block.push(...wrapText(loc, charsPerLine))
  return block.length > 0 ? block : ['(no text)']
}

export function labelLayoutForRow(row) {
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

function buildStyledTextXml(lines, fontSize) {
  const font = `<Font Family="Arial" Size="${fontSize}" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>`
  const body = lines.map((line) => escapeXmlText(line)).join('&#10;')
  return `        <Element><String>${body || '(no text)'}</String><Attributes>${font}</Attributes></Element>`
}

export function buildLabelXmlForRow(row) {
  const { fontSize, lines } = labelLayoutForRow(row)
  return LABEL_XML_TEMPLATE.replace(
    STYLED_TEXT_PLACEHOLDER,
    buildStyledTextXml(lines, fontSize)
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
