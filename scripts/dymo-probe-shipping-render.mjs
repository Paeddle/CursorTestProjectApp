/**
 * Save RenderLabel PNGs for 30323 layout comparison.
 * node scripts/dymo-probe-shipping-render.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildLabelXml, DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(scriptDir, 'dymo-probe-out')

const catalog = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Shipping')
const large = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'LargeShipping')
const HYBRID_SHIPPING = {
  id: 'Shipping',
  paperName: '30323 Shipping',
  drawWidth: large.drawWidth,
  drawHeight: large.drawHeight,
  boundsX: catalog.boundsX,
  boundsY: catalog.boundsY,
  boundsWidth: catalog.boundsWidth,
  boundsHeight: large.boundsHeight,
}

function pctHybridFace(el, t) {
  const padShort = Math.round(t.boundsWidth * 0.02)
  const padLong = Math.round(t.boundsHeight * 0.02)
  const x0 = t.boundsX + padShort
  const y0 = t.boundsY + padLong
  const axisShort = t.boundsWidth - padShort * 2
  const axisLong = t.boundsHeight - padLong * 2
  const boundHeight = Math.max(80, Math.round((el.widthPct / 100) * axisLong))
  const boundWidth = Math.max(60, Math.round((el.heightPct / 100) * axisShort))
  return {
    x: x0 + Math.round((el.yPct / 100) * (axisShort - boundWidth)),
    y: y0 + Math.round((el.xPct / 100) * (axisLong - boundHeight)),
    width: boundWidth,
    height: boundHeight,
  }
}

/** Keep draw twips; swap bounds so studio vertical % uses the long axis. */
const SWAP_BOUNDS_ONLY = {
  id: 'Shipping',
  paperName: '30323 Shipping',
  drawWidth: 5811,
  drawHeight: 1581,
  boundsX: 200,
  boundsY: 50,
  boundsWidth: 1481,
  boundsHeight: 5411,
}

function pctToBounds(el, t) {
  return {
    x: t.boundsX + Math.round((el.xPct / 100) * t.boundsWidth),
    y: t.boundsY + Math.round((el.yPct / 100) * t.boundsHeight),
    width: Math.max(80, Math.round((el.widthPct / 100) * t.boundsWidth)),
    height: Math.max(60, Math.round((el.heightPct / 100) * t.boundsHeight)),
  }
}

/** Studio y% → XML X, studio x% → XML Y (Landscape 30323 face vs twips). */
function pctSwapFace(el, t) {
  return {
    x: t.boundsX + Math.round((el.yPct / 100) * t.boundsWidth),
    y: t.boundsY + Math.round((el.xPct / 100) * t.boundsHeight),
    width: Math.max(80, Math.round((el.heightPct / 100) * t.boundsWidth)),
    height: Math.max(60, Math.round((el.widthPct / 100) * t.boundsHeight)),
  }
}

function studioInventoryXml(t, mapPct = pctHybridFace) {
  const item = mapPct({ xPct: 34, yPct: 6, widthPct: 62, heightPct: 38 }, t)
  const barcode = mapPct({ xPct: 34, yPct: 62, widthPct: 62, heightPct: 34 }, t)
  const text = (name, lines, b, size) =>
    `<ObjectInfo><TextObject><Name>${name}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${lines}</String><Attributes>` +
    `<Font Family="Arial" Size="${size}" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${b.x}" Y="${b.y}" Width="${b.width}" Height="${b.height}"/></ObjectInfo>`
  const capH = Math.max(72, Math.round(barcode.height * 0.22))
  const barsH = Math.max(80, barcode.height - capH - 3)
  const bc =
    `<ObjectInfo><BarcodeObject><Name>BC</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<Text>0012345678905</Text><Type>Code128Auto</Type><Size>Large</Size>` +
    `<TextPosition>None</TextPosition>` +
    `<TextFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<CheckSumFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<TextEmbedding>None</TextEmbedding><ECLevel>0</ECLevel><HorizontalAlignment>Center</HorizontalAlignment>` +
    `<QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0"/></BarcodeObject>` +
    `<Bounds X="${barcode.x}" Y="${barcode.y}" Width="${barcode.width}" Height="${barsH}"/></ObjectInfo>` +
    `<ObjectInfo><TextObject><Name>CAP</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>None</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>0012345678905</String><Attributes>` +
    `<Font Family="Arial" Size="12" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${barcode.x}" Y="${barcode.y + barsH + 3}" Width="${barcode.width}" Height="${capH}"/></ObjectInfo>`
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation><Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
    text('ITEM', '2Wire Converter', item, 20) +
    bc +
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

function extractBase64Png(body) {
  const m = body.match(/<ImageData>([^<]+)<\/ImageData>/i)
  if (m) return m[1]
  const trimmed = body.trim().replace(/^"|"$/g, '')
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 80))) return trimmed
  return null
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
  if (!printerName) process.exit(1)

  const layout = {
    jobFontSize: 22,
    locationFontSize: 14,
    jobLines: ['2Wire Converter'],
    locationLines: ['0012345678905'],
  }

  fs.mkdirSync(outDir, { recursive: true })
  const current = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Shipping')
  const variants = [
    ['po-current', current, 'po', null],
    ['studio-catalog', current, 'studio', pctToBounds],
    ['studio-hybrid-face', HYBRID_SHIPPING, 'studio', pctHybridFace],
  ]

  for (const [name, template, kind, mapPct] of variants) {
    const labelXml =
      kind === 'studio' ? studioInventoryXml(template, mapPct) : buildLabelXml(layout, template)
    const render = await dymoRequest(41951, 'RenderLabel', {
      printerName,
      labelXml,
      renderParamsXml: '',
    })
    const b64 = extractBase64Png(render.body)
    if (!b64) {
      console.log(`FAIL ${name}: no image`)
      continue
    }
    const buf = Buffer.from(b64, 'base64')
    const file = path.join(outDir, `${name}.png`)
    fs.writeFileSync(file, buf)
    console.log(`OK ${name} → ${file} (${buf.length} bytes)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
