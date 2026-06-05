/**
 * Render Label Studio stacked layouts (text + QR) for mapping comparison.
 * node scripts/dymo-probe-studio-layout.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DYMO_PAPER_TEMPLATES } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(scriptDir, 'dymo-probe-out')

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

/** User-style stacked layout from designer screenshot. */
const TEXT = { xPct: 4, yPct: 8, widthPct: 92, heightPct: 32 }
const QR = { xPct: 22, yPct: 42, widthPct: 56, heightPct: 52 }

function anchor(el, base, width, height) {
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.yPct / 100) * (base.height - height)),
    width,
    height,
  }
}

function mapDirect(el, t) {
  const base = { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return anchor(el, base, width, height)
}

/** Studio vertical% → XML X, horizontal% → XML Y; sizes swapped. */
function mapSwapAnchor(el, t) {
  const base = { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
  const width = Math.max(80, Math.round((el.heightPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.widthPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.yPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.xPct / 100) * (base.height - height)),
    width,
    height,
  }
}

/** Swap width/height only — position stays studio x→X, y→Y. */
function mapSwapSizeOnly(el, t) {
  const base = { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
  const width = Math.max(80, Math.round((el.heightPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.widthPct / 100) * base.height))
  return anchor(el, base, width, height)
}

/** Swap position only; keep width=studio width, height=studio height for ShrinkToFit. */
function mapSwapPosOnly(el, t) {
  const base = { x: t.boundsX, y: t.boundsY, width: t.boundsWidth, height: t.boundsHeight }
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.yPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.xPct / 100) * (base.height - height)),
    width,
    height,
  }
}

function mapDraw(el, t) {
  const pad = 50
  const base = { x: pad, y: pad, width: t.drawWidth - pad * 2, height: t.drawHeight - pad * 2 }
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return anchor(el, base, width, height)
}

/** Studio % → catalog face, then scale coords into hybrid bounds (mixed envelope). */
function mapCatalogScaledToHybrid(el, catalogT, hybridT) {
  const direct = mapDirect(el, catalogT)
  const cat = { x: catalogT.boundsX, y: catalogT.boundsY, width: catalogT.boundsWidth, height: catalogT.boundsHeight }
  const hyb = { x: hybridT.boundsX, y: hybridT.boundsY, width: hybridT.boundsWidth, height: hybridT.boundsHeight }
  const scaleX = hyb.width / cat.width
  const scaleY = hyb.height / cat.height
  return {
    x: hyb.x + Math.round((direct.x - cat.x) * scaleX),
    y: hyb.y + Math.round((direct.y - cat.y) * scaleY),
    width: Math.max(80, Math.round(direct.width * scaleX)),
    height: Math.max(60, Math.round(direct.height * scaleY)),
  }
}

function mapHybridDrawSwap(el, t) {
  const pad = 50
  const base = { x: pad, y: pad, width: t.drawWidth - pad * 2, height: t.drawHeight - pad * 2 }
  const width = Math.max(80, Math.round((el.heightPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.widthPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.yPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.xPct / 100) * (base.height - height)),
    width,
    height,
  }
}

function buildXml(t, textB, qrB, textFit = 'ShrinkToFit', orientation = 'Landscape', fontSize = 20) {
  const text =
    `<ObjectInfo><TextObject><Name>ITEM</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored><IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>${textFit}</TextFitMode><UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized><StyledText>` +
    `<Element><String>1' Cat6 Patch Cable</String><Attributes>` +
    `<Font Family="Arial" Size="${fontSize}" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
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
    `<PaperOrientation>${orientation}</PaperOrientation><Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/></DrawCommands>` +
    text +
    qr +
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
  console.log(`Printer: ${printerName}\n`)

  const swapDraw = {
    id: 'Shipping',
    paperName: '30323 Shipping',
    drawWidth: 1581,
    drawHeight: 5811,
    boundsX: 50,
    boundsY: 200,
    boundsWidth: 1481,
    boundsHeight: 5411,
  }

  const variants = [
    ['rev9-direct-catalog', catalog, mapDirect, 'ShrinkToFit', 'Landscape'],
    ['catalog-L-swap-size', catalog, mapSwapSizeOnly, 'ShrinkToFit', 'Landscape'],
    ['catalog-L-swap-size-none', catalog, mapSwapSizeOnly, 'None', 'Landscape'],
    ['catalog-P-direct', catalog, mapDirect, 'ShrinkToFit', 'Portrait'],
    ['catalog-L-swap', catalog, mapSwapAnchor, 'ShrinkToFit', 'Landscape'],
    ['catalog-P-swap', catalog, mapSwapAnchor, 'ShrinkToFit', 'Portrait'],
    ['swapdraw-L-direct', swapDraw, mapDirect, 'ShrinkToFit', 'Landscape'],
    ['swapdraw-P-direct', swapDraw, mapDirect, 'ShrinkToFit', 'Portrait'],
    ['swapdraw-L-swap', swapDraw, mapSwapAnchor, 'ShrinkToFit', 'Landscape'],
    ['swapdraw-P-swap', swapDraw, mapSwapAnchor, 'ShrinkToFit', 'Portrait'],
    ['draw-catalog', catalog, mapDraw, 'ShrinkToFit', 'Landscape'],
    ['hybrid-draw-swap', HYBRID, mapHybridDrawSwap, 'ShrinkToFit', 'Landscape'],
    ['hybrid-draw-swap-none22', HYBRID, mapHybridDrawSwap, 'None', 'Landscape'],
    ['rev9-direct-none22', catalog, mapDirect, 'None', 'Landscape'],
    ['hybrid-scaled-catalog', HYBRID, (el, t) => mapCatalogScaledToHybrid(el, catalog, t), 'ShrinkToFit', 'Landscape'],
    ['hybrid-scaled-none22', HYBRID, (el, t) => mapCatalogScaledToHybrid(el, catalog, t), 'None', 'Landscape'],
  ]

  fs.mkdirSync(outDir, { recursive: true })

  for (const [name, template, mapFn, textFit, orientation] of variants) {
    const textB = mapFn(TEXT, template)
    const qrB = mapFn(QR, template)
    const fontSize = textFit === 'None' ? 22 : 20
    const labelXml = buildXml(template, textB, qrB, textFit, orientation, fontSize)
    const render = await dymoRequest(41951, 'RenderLabel', {
      printerName,
      labelXml,
      renderParamsXml: '',
    })
    const b64 = extractBase64Png(render.body)
    if (!b64) {
      console.log(`FAIL ${name}`)
      continue
    }
    const file = path.join(outDir, `studio-probe-${name}.png`)
    fs.writeFileSync(file, Buffer.from(b64, 'base64'))
    console.log(
      `OK ${name} text=${textB.width}x${textB.height}@${textB.x},${textB.y} qr=${qrB.width}x${qrB.height}@${qrB.x},${qrB.y}`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
