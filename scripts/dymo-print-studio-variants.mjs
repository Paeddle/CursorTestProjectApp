/**
 * Print stacked text+QR layout variants to the local LabelWriter for comparison.
 * node scripts/dymo-print-studio-variants.mjs
 */
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
const SWAP_DRAW = {
  id: 'Shipping',
  paperName: '30323 Shipping',
  drawWidth: 1581,
  drawHeight: 5811,
  boundsX: 50,
  boundsY: 200,
  boundsWidth: 1481,
  boundsHeight: 5411,
}

const TEXT = { xPct: 4, yPct: 8, widthPct: 92, heightPct: 32 }
const QR = { xPct: 22, yPct: 42, widthPct: 56, heightPct: 52 }

function anchor(el, base, w, h) {
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - w)),
    y: base.y + Math.round((el.yPct / 100) * (base.height - h)),
    width: w,
    height: h,
  }
}

function mapDirect(el, t) {
  const base = { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
  return anchor(
    el,
    base,
    Math.max(80, Math.round((el.widthPct / 100) * base.width)),
    Math.max(60, Math.round((el.heightPct / 100) * base.height))
  )
}

function mapSwapAnchor(el, t) {
  const base = { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
  const w = Math.max(80, Math.round((el.heightPct / 100) * base.width))
  const h = Math.max(60, Math.round((el.widthPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.yPct / 100) * (base.width - w)),
    y: base.y + Math.round((el.xPct / 100) * (base.height - h)),
    width: w,
    height: h,
  }
}

function mapHybridDrawFace(el, t) {
  const pad = 50
  const axisX = t.drawWidth - pad * 2
  const axisY = t.drawHeight - pad * 2
  const w = Math.max(80, Math.round((el.heightPct / 100) * axisX))
  const h = Math.max(60, Math.round((el.widthPct / 100) * axisY))
  return {
    x: pad + Math.round((el.yPct / 100) * (axisX - w)),
    y: pad + Math.round((el.xPct / 100) * (axisY - h)),
    width: w,
    height: h,
  }
}

function mapPoInner(el, t) {
  const padX = Math.round(t.boundsWidth * 0.04)
  const padY = Math.round(t.boundsHeight * 0.06)
  const base = {
    x: t.boundsX + padX,
    y: t.boundsY + padY,
    width: t.boundsWidth - padX * 2,
    height: t.boundsHeight - padY * 2,
  }
  return anchor(
    el,
    base,
    Math.max(80, Math.round((el.widthPct / 100) * base.width)),
    Math.max(60, Math.round((el.heightPct / 100) * base.height))
  )
}

function buildXml(t, orientation, textB, qrB, tag) {
  const text =
    `<ObjectInfo><TextObject><Name>ITEM</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>None</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>${tag} Cat6 Patch Cable</String><Attributes>` +
    `<Font Family="Arial" Size="18" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>` +
    `</StyledText></TextObject>` +
    `<Bounds X="${textB.x}" Y="${textB.y}" Width="${textB.width}" Height="${textB.height}"/></ObjectInfo>`
  const qrXml =
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
    `<PaperOrientation>${orientation}</PaperOrientation><Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
    text +
    qrXml +
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

async function main() {
  const status = await dymoRequest('StatusConnected')
  if (!status.ok) {
    console.error('DYMO Connect not on 41951')
    process.exit(1)
  }
  const printers = await dymoRequest('GetPrinters')
  const m = printers.body.match(/<Name>([^<]+)<\/Name>/i)
  const printerName = m?.[1]?.trim()
  if (!printerName) process.exit(1)
  console.log(`Printer: ${printerName}\n`)

  const variants = [
    ['A-direct', catalog, mapDirect, 'Landscape'],
    ['B-swap', catalog, mapSwapAnchor, 'Landscape'],
    ['C-hybrid-face', HYBRID, mapHybridDrawFace, 'Landscape'],
    ['D-swapdraw', SWAP_DRAW, mapDirect, 'Portrait'],
    ['E-swapdraw-swap', SWAP_DRAW, mapSwapAnchor, 'Portrait'],
    ['F-po-inner', catalog, mapPoInner, 'Landscape'],
  ]

  for (const [tag, template, mapFn, orientation] of variants) {
    const labelXml = buildXml(template, orientation, mapFn(TEXT, template), mapFn(QR, template), tag)
    const render = await dymoRequest('RenderLabel', {
      printerName,
      labelXml,
      renderParamsXml: '',
    })
    const renderRejected = /error|exception|invalid|not declared/i.test(render.body)
    if (!render.ok || render.body.length < 200 || renderRejected) {
      console.log(`SKIP ${tag}: render failed (${render.body.slice(0, 120)})`)
      continue
    }
    const print = await dymoRequest('PrintLabel2', {
      printerName,
      labelXml,
      printParamsXml:
        '<LabelWriterPrintParams><Copies>1</Copies><PrintQuality>Text</PrintQuality><TwinTurboRoll>Auto</TwinTurboRoll></LabelWriterPrintParams>',
      labelSetXml: '',
    })
    const ok = print.ok && String(print.body).trim().toLowerCase() !== 'false'
    console.log(`${ok ? 'PRINTED' : 'FAIL'} ${tag} (${orientation})`)
  }
  console.log('\nCompare labels A–F. Each prefix is printed in the item text.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
