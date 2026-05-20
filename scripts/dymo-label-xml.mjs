const LABEL_FONT_STEPS = [
  { size: 36, charsPerLine: 14, maxLines: 3 },
  { size: 32, charsPerLine: 17, maxLines: 4 },
  { size: 28, charsPerLine: 19, maxLines: 5 },
  { size: 24, charsPerLine: 21, maxLines: 6 },
]

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
  const loc = String(row.location_name || '—').trim() || '—'
  const lines = [...wrapText(job, charsPerLine), ...wrapText(loc, charsPerLine)]
  return lines.length > 0 ? lines : ['—']
}

export function labelLayoutForRow(row) {
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

function buildStyledTextXml(lines, fontSize) {
  const font = `<Font Family="Arial" Size="${fontSize}" Bold="True" IsUnderline="False" IsStrikeout="False" IsItalic="False"/>`
  return lines
    .map(
      (line) =>
        `        <Element><String>${escapeXmlText(line)}</String><Attributes>${font}</Attributes></Element>`
    )
    .join('\n')
}

export function buildLabelXmlForRow(row) {
  const { fontSize, lines } = labelLayoutForRow(row)
  return LABEL_XML_TEMPLATE.replace(STYLED_TEXT_PLACEHOLDER, buildStyledTextXml(lines, fontSize))
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
