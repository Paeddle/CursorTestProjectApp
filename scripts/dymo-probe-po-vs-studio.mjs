/**
 * Which template does PO print use first? Does 30323 PaperName accept 30256 draw dims?
 */
import { buildLabelXml, DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const layout = {
  jobFontSize: 22,
  locationFontSize: 14,
  jobLines: ['2Wire Converter'],
  locationLines: ['Room A'],
}

const HYBRID = {
  id: 'Shipping',
  paperName: '30323 Shipping',
  drawWidth: 3331,
  drawHeight: 5715,
  boundsX: 336,
  boundsY: 58,
  boundsWidth: 5338,
  boundsHeight: 3192,
}

async function dymoRequest(port, endpoint, form) {
  const url = `https://127.0.0.1:${port}/DYMO/DLS/Printing/${endpoint}`
  const init = { method: form ? 'POST' : 'GET' }
  if (form) {
    init.body = new URLSearchParams(form)
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await fetch(url, init)
  return { ok: res.ok, body: await res.text() }
}

async function renderOk(printerName, labelXml) {
  const render = await dymoRequest(41951, 'RenderLabel', {
    printerName,
    labelXml,
    renderParamsXml: '',
  })
  return (
    render.ok &&
    render.body.length > 200 &&
    !/error|exception|invalid|not declared/i.test(render.body)
  )
}

async function main() {
  const status = await dymoRequest(41951, 'StatusConnected')
  if (!status.ok) {
    console.error('DYMO not on 41951')
    process.exit(1)
  }
  const printers = await dymoRequest(41951, 'GetPrinters')
  const m = printers.body.match(/<Name>([^<]+)<\/Name>/i)
  const printerName = m?.[1]?.trim()
  if (!printerName) process.exit(1)
  console.log(`Printer: ${printerName}\n`)

  const tests = [
    ...DYMO_PAPER_TEMPLATES.map((t) => ({ name: `PO-${t.id}`, template: t })),
    { name: 'hybrid-30323-name-30256-dims', template: HYBRID },
  ]

  for (const { name, template } of tests) {
    const xml = buildLabelXml(layout, template)
    const ok = await renderOk(printerName, xml)
    console.log(`${ok ? 'OK ' : 'FAIL'} ${name} (${template.paperName}) draw=${template.drawWidth}x${template.drawHeight} boundsH=${template.boundsHeight}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
