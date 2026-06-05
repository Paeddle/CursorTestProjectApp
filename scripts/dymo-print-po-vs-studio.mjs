/**
 * Print PO vs studio rev 15 (catalog bounds + face-linear Y + ShrinkToFit).
 * node scripts/dymo-print-po-vs-studio.mjs
 */
import { buildLabelXml, DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const catalog = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Shipping')
const ITEM = "1' Cat6 Patch Cable"

function faceBounds(t) {
  return { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
}

/** Rev 16: catalog face + face-linear Y + hardware nudge. */
const NUDGE_X = 0.03
const NUDGE_Y = 0.035

function mapRev16(el, base) {
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  const maxX = base.x + base.width - width
  const maxY = base.y + base.height - height
  const x = base.x + Math.round((el.xPct / 100) * (base.width - width))
  const y = Math.min(base.y + Math.round((el.yPct / 100) * base.height), maxY)
  return {
    x: Math.min(maxX, x + Math.round(base.width * NUDGE_X)),
    y: Math.min(maxY, y + Math.round(base.height * NUDGE_Y)),
    width,
    height,
  }
}

function textXml(tag, lines, bounds, size, fit) {
  return (
    `<ObjectInfo><TextObject><Name>TXT</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>${fit}</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${tag} ${lines}</String><Attributes>` +
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
    `<Text>0012345678905</Text><Type>QRCode</Type><Size>Large</Size>` +
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

function studioXml() {
  const base = faceBounds(catalog)
  const textB = mapRev16({ xPct: 4, yPct: 8, widthPct: 92, heightPct: 32 }, base)
  const qrB = mapRev16({ xPct: 22, yPct: 42, widthPct: 56, heightPct: 52 }, base)
  return dieCut(textXml('STUDIO', ITEM, textB, 18, 'ShrinkToFit') + qrXml(qrB))
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
  const textB = mapRev16({ xPct: 4, yPct: 8, widthPct: 92, heightPct: 32 }, base)
  const qrB = mapRev16({ xPct: 22, yPct: 42, widthPct: 56, heightPct: 52 }, base)
  console.log('rev16 catalog face', base)
  console.log('text', textB, 'qr', qrB)
  const poXml = buildLabelXml(
    { jobFontSize: 22, locationFontSize: 14, jobLines: [`PO ${ITEM}`], locationLines: [] },
    catalog
  )
  await printXml('PO-label', poXml)
  await printXml('STUDIO-rev16', studioXml())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
