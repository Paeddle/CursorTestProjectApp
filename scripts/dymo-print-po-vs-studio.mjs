/**
 * Print PO label vs studio poInner mapping for physical comparison.
 * node scripts/dymo-print-po-vs-studio.mjs
 */
import { buildLabelXml, DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const catalog = DYMO_PAPER_TEMPLATES.find((t) => t.id === 'Shipping')
const ITEM = "1' Cat6 Patch Cable"

function poInner(t) {
  const padX = Math.round(t.boundsWidth * 0.04)
  const padY = Math.round(t.boundsHeight * 0.06)
  return {
    x: t.boundsX + padX,
    y: t.boundsY + padY,
    width: t.boundsWidth - padX * 2,
    height: t.boundsHeight - padY * 2,
  }
}

function anchor(el, base, w, h) {
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - w)),
    y: base.y + Math.round((el.yPct / 100) * (base.height - h)),
    width: w,
    height: h,
  }
}

function studioXml() {
  const inner = poInner(catalog)
  const TEXT = { xPct: 4, yPct: 8, widthPct: 92, heightPct: 32 }
  const QR = { xPct: 22, yPct: 42, widthPct: 56, heightPct: 52 }
  const textB = anchor(
    TEXT,
    inner,
    Math.max(80, Math.round((TEXT.widthPct / 100) * inner.width)),
    Math.max(60, Math.round((TEXT.heightPct / 100) * inner.height))
  )
  const qrB = anchor(
    QR,
    inner,
    Math.max(80, Math.round((QR.widthPct / 100) * inner.width)),
    Math.max(60, Math.round((QR.heightPct / 100) * inner.height))
  )
  const text =
    `<ObjectInfo><TextObject><Name>ITEM</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>None</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>STUDIO ${ITEM}</String><Attributes>` +
    `<Font Family="Arial" Size="18" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${textB.x}" Y="${textB.y}" Width="${textB.width}" Height="${textB.height}"/></ObjectInfo>`
  const qr =
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
    `<Bounds X="${qrB.x}" Y="${qrB.y}" Width="${qrB.width}" Height="${qrB.height}"/></ObjectInfo>`
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation><Id>${catalog.id}</Id>` +
    `<PaperName>${catalog.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${catalog.drawWidth}" Height="${catalog.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
    text +
    qr +
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
  if (!ok) console.log(print.body.slice(0, 200))
}

async function main() {
  const poXml = buildLabelXml(
    { jobFontSize: 22, locationFontSize: 14, jobLines: [`PO ${ITEM}`], locationLines: [] },
    catalog
  )
  const inner = poInner(catalog)
  console.log('poInner', inner)
  await printXml('PO-label', poXml)
  await printXml('STUDIO-poInner', studioXml())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
