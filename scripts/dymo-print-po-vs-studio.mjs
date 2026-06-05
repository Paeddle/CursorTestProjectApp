/**
 * User template rev 27 — shift layout up to match designer.
 * Text 10/10/80/25  QR 32/51/36/38
 */
import QRCode from 'qrcode'
import { DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const catalog = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Shipping')
const large = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'LargeShipping')
const HYBRID = {
  id: 'Shipping',
  paperName: '30323 Shipping',
  drawWidth: large.drawWidth,
  drawHeight: large.drawHeight,
  boundsX: large.boundsX,
  boundsY: large.boundsY,
  boundsWidth: large.boundsWidth,
  boundsHeight: large.boundsHeight,
}

const ITEM = "1' Cat6 Patch Cable"
const Y_UP_FRAC = 0
const BARCODE = '681610503619'
const TEXT = { xPct: 10, yPct: 10, widthPct: 80, heightPct: 25 }
const QR = { xPct: 32, yPct: 51, widthPct: 36, heightPct: 38 }

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function face(t) {
  return { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
}

function canvasBounds(el, design) {
  const base = face(design)
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.xPct / 100) * base.width),
    y: base.y + Math.round((el.yPct / 100) * base.height),
    width,
    height,
  }
}

function scaleToPrint(bounds, design, print) {
  const d = face(design)
  const p = face(print)
  const scaleX = p.width / d.width
  const scaleY = p.height / d.height
  return {
    x: d.x + Math.round((bounds.x - d.x) * scaleX),
    y: d.y + Math.round((bounds.y - d.y) * scaleY),
    width: Math.max(80, Math.round(bounds.width * scaleX)),
    height: Math.max(60, Math.round(bounds.height * scaleY)),
  }
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

function mapRect(el) {
  const onCanvas = canvasBounds(el, catalog)
  const scaled = scaleToPrint(onCanvas, catalog, HYBRID)
  const up = Math.round(face(HYBRID).height * Y_UP_FRAC)
  return clamp({ ...scaled, y: scaled.y - up }, face(HYBRID))
}

function mapQr(el) {
  const rect = mapRect(el)
  const side = Math.max(80, Math.min(rect.width, rect.height))
  return clamp(
    {
      x: rect.x + Math.round((rect.width - side) / 2),
      y: rect.y + Math.round((rect.height - side) / 2),
      width: side,
      height: side,
    },
    face(HYBRID)
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
    `<TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${esc(lines)}</String><Attributes>` +
    `<Font Family="Arial" Size="${size}" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/></ObjectInfo>`
  )
}

async function qrImageXml(bounds) {
  const dataUrl = await QRCode.toDataURL(BARCODE, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
  const png = dataUrl.replace(/^data:image\/png;base64,/, '')
  return (
    `<ObjectInfo><ImageObject><Name>QR</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<ImageLocation/><Image>${png}</Image>` +
    `<ScaleMode>Uniform</ScaleMode><BorderWidth>0</BorderWidth>` +
    `<BorderColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Center</VerticalAlignment>` +
    `</ImageObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/></ObjectInfo>`
  )
}

function dieCut(objects) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation><Id>${HYBRID.id}</Id>` +
    `<PaperName>${HYBRID.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${HYBRID.drawWidth}" Height="${HYBRID.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
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
  const textB = mapRect(TEXT)
  const qrB = mapQr(QR)
  console.log('rev27 canvas', canvasBounds(TEXT, catalog), canvasBounds(QR, catalog))
  console.log('rev27 hybrid text', textB)
  console.log('rev27 hybrid qr image bounds', qrB)
  await printXml('STUDIO-rev27-up', dieCut(textXml(ITEM, textB, 18) + (await qrImageXml(qrB))))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
