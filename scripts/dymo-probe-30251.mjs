/**
 * Find valid PaperName for 30251 address labels.
 * node scripts/dymo-probe-30251.mjs
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const CANDIDATES = []
for (const paperName of [
  '30251 Address',
  '30251 Return Address',
  '30251 Return Address Label',
  '30251 White Address Labels',
  '30330 Address',
  '30320 Address',
]) {
  CANDIDATES.push({ id: 'Address', paperName })
}
CANDIDATES.push({ id: 'Address30251', paperName: '30251 Address' })

async function dymoRequest(endpoint, form) {
  const url = `https://127.0.0.1:41951/DYMO/DLS/Printing/${endpoint}`
  const init = { method: form ? 'POST' : 'GET' }
  if (form) {
    init.body = new URLSearchParams(form)
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await fetch(url, init)
  return { ok: res.ok, body: await res.text() }
}

function probeXml(id, paperName, drawW, drawH, bounds) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation><Id>${id}</Id>` +
    `<PaperName>${paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${drawW}" Height="${drawH}" Rx="270" Ry="270"/></DrawCommands>` +
    `<ObjectInfo><TextObject><Name>T</Name><StyledText>` +
    `<Element><String>probe</String><Attributes>` +
    `<Font Family="Arial" Size="12" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `</Attributes></Element></StyledText></TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.w}" Height="${bounds.h}"/></ObjectInfo>` +
    `</DieCutLabel>`
  )
}

async function main() {
  const status = await dymoRequest('StatusConnected')
  if (!status.ok) {
    console.error('DYMO Connect not on 41951')
    process.exit(1)
  }
  const printers = await dymoRequest('GetPrinters')
  const printerName = printers.body.match(/<Name>([^<]+)<\/Name>/i)?.[1]?.trim() ?? ''

  const geom = [
    { tag: '30252-catalog', drawW: 1581, drawH: 5040, bounds: { x: 332, y: 150, w: 4455, h: 1260 } },
    { tag: '30251-mm-89x28', drawW: 5040, drawH: 1581, bounds: { x: 150, y: 34, w: 4455, h: 1260 } },
    { tag: '30251-swap-draw', drawW: 1581, drawH: 5040, bounds: { x: 332, y: 150, w: 4455, h: 1260 } },
  ]

  for (const c of CANDIDATES) {
    for (const g of geom) {
      const xml = probeXml(c.id, c.paperName, g.drawW, g.drawH, g.bounds)
      const render = await dymoRequest('RenderLabel', {
        labelXml: xml,
        renderParamsXml: '<RenderParams LabelColor="Black" />',
        printerName,
      })
      const ok =
        render.ok &&
        render.body.length > 200 &&
        !/error|exception|invalid|not declared/i.test(render.body)
      console.log(`${ok ? 'OK' : 'FAIL'}\t${c.paperName}\t${c.id}\t${g.tag}\tlen=${render.body.length}`)
      if (!ok && render.body.length < 120) console.log(`     ${render.body}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
