/**
 * 30251 address — studio face print test (rev 29).
 * node scripts/dymo-print-address30251-studio.mjs
 */
import QRCode from 'qrcode'
import { DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const paper = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Address30251')
const BARCODE = '681610503619'

const TEXT = { xPct: 2, yPct: 8, widthPct: 38, heightPct: 84 }
const QR = { xPct: 68, yPct: 10, widthPct: 28, heightPct: 80 }

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function face(t) {
  return { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
}

function canvasBounds(el, t) {
  const base = face(t)
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.xPct / 100) * base.width),
    y: base.y + Math.round((el.yPct / 100) * base.height),
    width,
    height,
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

function mapQr(el) {
  const rect = clamp(canvasBounds(el, paper), face(paper))
  const side = Math.max(80, Math.min(rect.width, rect.height))
  return clamp(
    {
      x: rect.x + Math.round((rect.width - side) / 2),
      y: rect.y + Math.round((rect.height - side) / 2),
      width: side,
      height: side,
    },
    face(paper)
  )
}

function textXml(lines, bounds, size) {
  const block = lines.map(esc).join('\n')
  return (
    `<ObjectInfo><TextObject><Name>ITEM</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${block}</String><Attributes>` +
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
  const t = paper
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation><Id>Address</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
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
  const textB = clamp(canvasBounds(TEXT, paper), face(paper))
  const qrB = mapQr(QR)
  const lines = ["1' Cat6 Patch Cable", 'SKU:CIS326001']
  console.log('rev29 30251 text', textB)
  console.log('rev29 30251 qr', qrB)
  await printXml('ADDR30251-rev29-studio', dieCut(textXml(lines, textB, 18) + (await qrImageXml(qrB))))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
