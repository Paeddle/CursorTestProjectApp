const DYMO_MAX_CHARS = 21

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
        <Element><String>LINE1</String><Attributes><Font Family="Arial" Size="24" Bold="True"/></Attributes></Element>
      </StyledText>
    </TextObject>
    <Bounds X="128" Y="18" Width="2218" Height="608"/>
  </ObjectInfo>
</DieCutLabel>`

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

export function buildLabelXmlForRow(row) {
  const text = [
    ...wrapText(row.job_name || row.item_name || '', DYMO_MAX_CHARS),
    ...wrapText(row.location_name || '—', DYMO_MAX_CHARS),
  ].join('\n')
  const escaped = escapeXmlText(text)
  return LABEL_XML_TEMPLATE.replace('<String>LINE1</String>', `<String>${escaped}</String>`)
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
