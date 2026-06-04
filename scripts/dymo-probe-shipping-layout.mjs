/**
 * Probe 30323 Shipping layout variants (RenderLabel only).
 * Run from repo root: node scripts/dymo-probe-shipping-layout.mjs
 */
import { buildLabelXml } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE = {
  id: 'Shipping',
  paperName: '30323 Shipping',
  widthMm: 102,
  heightMm: 59,
}

const VARIANTS = [
  {
    name: 'current-bounds',
    template: {
      ...BASE,
      drawWidth: 5811,
      drawHeight: 1581,
      boundsX: 200,
      boundsY: 50,
      boundsWidth: 5411,
      boundsHeight: 1481,
    },
    map: 'bounds',
    orientation: 'Landscape',
  },
  {
    name: 'draw-area',
    template: {
      ...BASE,
      drawWidth: 5811,
      drawHeight: 1581,
      boundsX: 200,
      boundsY: 50,
      boundsWidth: 5411,
      boundsHeight: 1481,
    },
    map: 'draw',
    orientation: 'Landscape',
  },
  {
    name: 'sdk-draw-3060x5715',
    template: {
      ...BASE,
      drawWidth: 3060,
      drawHeight: 5715,
      boundsX: 319,
      boundsY: 150,
      boundsWidth: 4560,
      boundsHeight: 1343,
    },
    map: 'bounds',
    orientation: 'Landscape',
  },
  {
    name: 'sdk-draw-portrait',
    template: {
      ...BASE,
      drawWidth: 3060,
      drawHeight: 5715,
      boundsX: 319,
      boundsY: 150,
      boundsWidth: 4560,
      boundsHeight: 1343,
    },
    map: 'bounds',
    orientation: 'Portrait',
  },
  {
    name: 'tall-draw-5811h',
    template: {
      ...BASE,
      drawWidth: 1581,
      drawHeight: 5811,
      boundsX: 50,
      boundsY: 200,
      boundsWidth: 1481,
      boundsHeight: 5411,
    },
    map: 'bounds-swap-xy',
    orientation: 'Landscape',
  },
  {
    name: 'current-bounds-portrait',
    template: {
      ...BASE,
      drawWidth: 5811,
      drawHeight: 1581,
      boundsX: 200,
      boundsY: 50,
      boundsWidth: 5411,
      boundsHeight: 1481,
    },
    map: 'bounds',
    orientation: 'Portrait',
  },
  {
    name: 'swap-draw-1581x5811',
    template: {
      ...BASE,
      drawWidth: 1581,
      drawHeight: 5811,
      boundsX: 50,
      boundsY: 200,
      boundsWidth: 1481,
      boundsHeight: 5411,
    },
    map: 'bounds',
    orientation: 'Landscape',
  },
  {
    name: 'sdk-portrait-swap-map',
    template: {
      ...BASE,
      drawWidth: 3060,
      drawHeight: 5715,
      boundsX: 319,
      boundsY: 150,
      boundsWidth: 4560,
      boundsHeight: 1343,
    },
    map: 'swap-xy-pct',
    orientation: 'Portrait',
  },
]

function mapRect(el, template, mode) {
  const w = Math.max(80, Math.round((el.widthPct / 100) * template.boundsWidth))
  const h = Math.max(60, Math.round((el.heightPct / 100) * template.boundsHeight))
  if (mode === 'bounds') {
    return {
      x: template.boundsX + Math.round((el.xPct / 100) * template.boundsWidth),
      y: template.boundsY + Math.round((el.yPct / 100) * template.boundsHeight),
      width: Math.max(80, Math.round((el.widthPct / 100) * template.boundsWidth)),
      height: Math.max(60, Math.round((el.heightPct / 100) * template.boundsHeight)),
    }
  }
  if (mode === 'draw') {
    const width = Math.max(80, Math.round((el.widthPct / 100) * template.drawWidth))
    const height = Math.max(60, Math.round((el.heightPct / 100) * template.drawHeight))
    return {
      x: Math.round((el.xPct / 100) * (template.drawWidth - width)),
      y: Math.round((el.yPct / 100) * (template.drawHeight - height)),
      width,
      height,
    }
  }
  if (mode === 'bounds-swap-xy') {
    return {
      x: template.boundsY + Math.round((el.yPct / 100) * template.boundsHeight),
      y: template.boundsX + Math.round((el.xPct / 100) * template.boundsWidth),
      width: Math.max(80, Math.round((el.heightPct / 100) * template.boundsHeight)),
      height: Math.max(60, Math.round((el.widthPct / 100) * template.boundsWidth)),
    }
  }
  /** Studio xPct=horizontal, yPct=vertical on 102×59 face; map vertical % → X on tall Portrait draw. */
  if (mode === 'swap-xy-pct') {
    return {
      x: template.boundsX + Math.round((el.yPct / 100) * template.boundsWidth),
      y: template.boundsY + Math.round((el.xPct / 100) * template.boundsHeight),
      width: Math.max(80, Math.round((el.heightPct / 100) * template.boundsWidth)),
      height: Math.max(60, Math.round((el.widthPct / 100) * template.boundsHeight)),
    }
  }
  return mapRect(el, template, 'bounds')
}

function buildStudioSampleXml(template, mode, orientation) {
  const title = { xPct: 10, yPct: 6, widthPct: 80, heightPct: 38 }
  const barcode = { xPct: 10, yPct: 62, widthPct: 80, heightPct: 34 }
  const titleB = mapRect(title, template, mode)
  const barcodeB = mapRect(barcode, template, mode)

  const textXml = (name, lines, bounds, fontSize) =>
    `<ObjectInfo><TextObject><Name>${name}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${lines}</String><Attributes>` +
    `<Font Family="Arial" Size="${fontSize}" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/></ObjectInfo>`

  const t = template
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>${orientation}</PaperOrientation>` +
    `<Id>${t.id}</Id><PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
    textXml('TITLE', '2Wire Converter', titleB, 20) +
    textXml('BARCODE_TXT', '0012345678905', barcodeB, 10) +
    `</DieCutLabel>`
  )
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

async function main() {
  const status = await dymoRequest(41951, 'StatusConnected')
  if (!status.ok) {
    console.error('DYMO Connect not on 41951')
    process.exit(1)
  }
  const printers = await dymoRequest(41951, 'GetPrinters')
  const m = printers.body.match(/<Name>([^<]+)<\/Name>/i)
  const printerName = m?.[1]?.trim()
  if (!printerName) {
    console.error('No printer')
    process.exit(1)
  }
  console.log(`Printer: ${printerName}\n`)

  for (const v of VARIANTS) {
    const xml = buildStudioSampleXml(v.template, v.map, v.orientation)
    const render = await dymoRequest(41951, 'RenderLabel', {
      printerName,
      labelXml: xml,
      renderParamsXml: '',
    })
    const ok =
      render.ok &&
      render.body.length > 200 &&
      !/error|exception|invalid|not declared/i.test(render.body)
    console.log(`${ok ? 'OK ' : 'FAIL'} ${v.name} (${v.map}, ${v.orientation})`)
    if (!ok) console.log(`     ${render.body.slice(0, 160)}`)
    else {
      const titleB = mapRect({ xPct: 10, yPct: 6, widthPct: 80, heightPct: 38 }, v.template, v.map)
      const barcodeB = mapRect({ xPct: 10, yPct: 62, widthPct: 80, heightPct: 34 }, v.template, v.map)
      console.log(
        `     title Y=${titleB.y} h=${titleB.height}  barcode Y=${barcodeB.y} h=${barcodeB.height}  drawH=${v.template.drawHeight}`
      )
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
