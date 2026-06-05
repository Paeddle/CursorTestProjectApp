/**
 * User template rev 22 — calibrated size/Y scale.
 * Text 10/10/80/25  QR 32/51/36/38
 */
import { DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const catalog = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Shipping')
const ITEM = "1' Cat6 Patch Cable"
const WIDTH_SCALE = 1.45
const HEIGHT_SCALE = 1.25
const Y_POSITION_SCALE = 1.28

const TEXT = { xPct: 10, yPct: 10, widthPct: 80, heightPct: 25 }
const QR = { xPct: 32, yPct: 51, widthPct: 36, heightPct: 38 }

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function faceBounds(t) {
  return { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
}

function clamp(bounds, base) {
  const width = Math.min(bounds.width, base.width)
  const height = Math.min(bounds.height, base.height)
  const maxX = base.x + base.width - width
  const maxY = base.y + base.height - height
  return {
    x: Math.max(base.x, Math.min(maxX, bounds.x)),
    y: Math.max(base.y, Math.min(maxY, bounds.y)),
    width,
    height,
  }
}

function mapRect(el, base) {
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width * WIDTH_SCALE))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height * HEIGHT_SCALE))
  const y = base.y + Math.round((el.yPct / 100) * base.height * Y_POSITION_SCALE)
  return clamp(
    {
      x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
      y,
      width,
      height,
    },
    base
  )
}

function mapQr(el, base) {
  const rect = mapRect(el, base)
  const side = Math.max(80, Math.min(rect.width, rect.height))
  return clamp(
    {
      x: rect.x + Math.round((rect.width - side) / 2),
      y: rect.y + Math.round((rect.height - side) / 2),
      width: side,
      height: side,
    },
    base
  )
}

function textXml(lines, bounds, size) {
  return (
    `<ObjectInfo><TextObject><Name>ITEM</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>None</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${esc(lines)}</String><Attributes>` +
    `<Font Family="Arial" Size="${size}" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/></ObjectInfo>`
  )
}

function qrXml(bounds) {
  return (
    `<ObjectInfo><BarcodeObject><Name>QR</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<Text>681610503619</Text><Type>QRCode</Type><Size>Large</Size>` +
    `<TextPosition>None</TextPosition>` +
    `<TextFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<CheckSumFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<TextEmbedding>None</TextEmbedding><ECLevel>0</ECLevel><HorizontalAlignment>Center</HorizontalAlignment>` +
    `<QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0"/></BarcodeObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/></ObjectInfo>`
  )
}

function dieCut(objects) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation><Id>${catalog.id}</Id>` +
    `<PaperName>${catalog.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${catalog.drawWidth}" Height="${catalog.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
    objects +
    `</DieCutLabel>`
  )
}

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

async function printXml(name, labelXml) {
  const printers = await dymoRequest('GetPrinters')
  const printerName = printers.body.match(/<Name>([^<]+)<\/Name>/i)?.[1]?.trim()
  const print = await dymoRequest('PrintLabel2', {
    printerName,
    labelXml,
    printParamsXml:
      '<LabelWriterPrintParams><Copies>1</Copies><PrintQuality>Text</PrintQuality><TwinTurboRoll>Auto</TwinTurboRoll></LabelWriterPrintParams>',
    labelSetXml: '',
  })
  const ok = print.ok && String(print.body).trim().toLowerCase() !== 'false'
  console.log(`${ok ? 'PRINTED' : 'FAIL'} ${name}`)
}

async function main() {
  const base = faceBounds(catalog)
  const textB = mapRect(TEXT, base)
  const qrB = mapQr(QR, base)
  console.log('rev22 text', textB)
  console.log('rev22 qr', qrB)
  await printXml('STUDIO-rev22-calibrated', dieCut(textXml(ITEM, textB, 18) + qrXml(qrB)))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
