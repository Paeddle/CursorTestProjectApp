import type { DymoPaperTemplate } from './dymoLabelXml'
import {
  loadImageBlobForPrint,
  loadOrientedImageSource,
  type StudioFaceImageLayer,
} from './labelStudioImage'
import { labelRasterDimensionsForBounds } from './labelStudioRaster'
import {
  mergedBarcodeForElement,
  mergedImageUrlForElement,
  mergedLinesForElement,
} from './labelStudioMerge'
import { qrPngBase64ForPrint } from './labelStudioQr'
import { resolveBarcodeType } from './labelStudioBarcode'
import {
  previewMaxFontSizePx,
  studioPrintFaceBounds,
  type StudioPrintBoundsOptions,
} from './labelStudioGeometry'
import {
  processThermalImageData,
  thermalToneNeedsProcessing,
  type ThermalImageProcessOptions,
} from './labelStudioThermalImage'
import type {
  LabelStudioElement,
  LabelStudioItem,
  LabelStudioTemplate,
  LabelStudioTextElement,
} from '../types/labelStudio'
import { isBarcodeElement, isImageElement, isTextElement } from '../types/labelStudio'

function pctBoxPx(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  faceW: number,
  faceH: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round((el.xPct / 100) * faceW),
    y: Math.round((el.yPct / 100) * faceH),
    w: Math.max(1, Math.round((el.widthPct / 100) * faceW)),
    h: Math.max(1, Math.round((el.heightPct / 100) * faceH)),
  }
}

function textFitsBox(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: { w: number; h: number },
  fontPx: number,
  bold: boolean
): boolean {
  ctx.font = `${bold ? '700' : '400'} ${fontPx}px Arial,sans-serif`
  const lineHeight = fontPx * 1.1
  const totalH = lines.length * lineHeight
  if (totalH > box.h + 2) return false
  for (const line of lines) {
    if (ctx.measureText(line).width > box.w + 2) return false
  }
  return true
}

function shrinkFontPx(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: { w: number; h: number },
  maxPx: number,
  bold: boolean,
  shrink: boolean
): number {
  const ceiling = Math.max(4, Math.floor(maxPx))
  if (!shrink || textFitsBox(ctx, lines, box, ceiling, bold)) return ceiling
  let lo = 4
  let hi = ceiling
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textFitsBox(ctx, lines, box, mid, bold)) lo = mid
    else hi = mid - 1
  }
  return Math.max(4, lo)
}

function drawTextElement(
  ctx: CanvasRenderingContext2D,
  el: LabelStudioTextElement,
  lines: string[],
  box: { x: number; y: number; w: number; h: number },
  faceH: number,
  designPaper: DymoPaperTemplate
): void {
  if (lines.length === 0) return
  const shrink = el.textFitMode !== 'None'
  const maxPx = previewMaxFontSizePx(el, faceH, designPaper)
  const fontPx = shrinkFontPx(ctx, lines, box, maxPx, el.bold, shrink)
  ctx.fillStyle = '#000000'
  ctx.font = `${el.bold ? '700' : '400'} ${fontPx}px Arial,sans-serif`
  ctx.textBaseline = 'middle'
  const lineHeight = fontPx * 1.1
  const totalH = lines.length * lineHeight
  const verticalTop = shrink || el.align !== 'Center'
  let y = verticalTop
    ? box.y + lineHeight / 2
    : box.y + (box.h - totalH) / 2 + lineHeight / 2
  for (const line of lines) {
    let x = box.x
    if (el.align === 'Center') {
      ctx.textAlign = 'center'
      x = box.x + box.w / 2
    } else if (el.align === 'Right') {
      ctx.textAlign = 'right'
      x = box.x + box.w
    } else {
      ctx.textAlign = 'left'
    }
    ctx.fillText(line, x, y)
    y += lineHeight
  }
}

async function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: StudioFaceImageLayer,
  faceW: number,
  faceH: number,
  thermal?: ThermalImageProcessOptions
): Promise<void> {
  const blob = await loadImageBlobForPrint(layer.url)
  if (!blob) return
  const oriented = await loadOrientedImageSource(blob)
  if (!oriented) return

  try {
    const x = Math.round((layer.xPct / 100) * faceW)
    const y = Math.round((layer.yPct / 100) * faceH)
    const w = Math.max(1, Math.round((layer.widthPct / 100) * faceW))
    const h = Math.max(1, Math.round((layer.heightPct / 100) * faceH))
    const srcW = Math.max(1, oriented.width)
    const srcH = Math.max(1, oriented.height)
    const scale =
      layer.scaleMode === 'Fill'
        ? Math.max(w / srcW, h / srcH)
        : Math.min(w / srcW, h / srcH)
    const dw = Math.max(1, Math.round(srcW * scale))
    const dh = Math.max(1, Math.round(srcH * scale))
    const dx = x + Math.round((w - dw) / 2)
    const dy = y + Math.round((h - dh) / 2)
    ctx.drawImage(oriented.source, dx, dy, dw, dh)
    if (thermal && thermalToneNeedsProcessing(thermal.tone)) {
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      processThermalImageData(imageData, thermal.tone)
      ctx.putImageData(imageData, dx, dy)
    }
  } finally {
    oriented.cleanup?.()
  }
}

async function drawBarcodeElement(
  ctx: CanvasRenderingContext2D,
  el: LabelStudioElement,
  item: LabelStudioItem,
  box: { x: number; y: number; w: number; h: number }
): Promise<void> {
  if (!isBarcodeElement(el)) return
  const value = mergedBarcodeForElement(el.content, item)
  if (!value) return
  const symbology = resolveBarcodeType(el.barcodeType, value)
  if (symbology === 'QrCode') {
    const side = Math.max(32, Math.min(box.w, box.h))
    const png = await qrPngBase64ForPrint(value, side * 15)
    if (!png) return
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('qr load failed'))
      img.src = `data:image/png;base64,${png}`
    })
    const dx = box.x + Math.round((box.w - side) / 2)
    const dy = box.y + Math.round((box.h - side) / 2)
    ctx.drawImage(img, dx, dy, side, side)
  }
}

/** Paint the whole durable label face — WYSIWYG bitmap for a single DYMO ImageObject. */
export async function composeDurableStudioLabelRasterBase64(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  designPaper: DymoPaperTemplate,
  printTemplate: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): Promise<string | null> {
  const face = studioPrintFaceBounds(printTemplate)
  const { width: faceW, height: faceH } = labelRasterDimensionsForBounds({
    width: face.width,
    height: face.height,
  })
  const thermal = options?.thermalImage

  try {
    const canvas = document.createElement('canvas')
    canvas.width = faceW
    canvas.height = faceH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, faceW, faceH)

    const imageEls = template.elements.filter(isImageElement)
    for (const el of imageEls) {
      const url = mergedImageUrlForElement(el.content, item)
      if (!url) continue
      try {
        await drawImageLayer(
          ctx,
          {
            url,
            xPct: el.xPct,
            yPct: el.yPct,
            widthPct: el.widthPct,
            heightPct: el.heightPct,
            scaleMode: el.scaleMode ?? 'Uniform',
          },
          faceW,
          faceH,
          thermal
        )
      } catch {
        /* skip failed photo — still print text/barcode */
      }
    }

    for (const el of template.elements) {
      if (!isBarcodeElement(el)) continue
      try {
        await drawBarcodeElement(ctx, el, item, pctBoxPx(el, faceW, faceH))
      } catch {
        /* skip failed barcode */
      }
    }

    for (const el of template.elements) {
      if (!isTextElement(el)) continue
      const lines = mergedLinesForElement(el.content, item)
      drawTextElement(ctx, el, lines, pctBoxPx(el, faceW, faceH), faceH, designPaper)
    }

    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  }
}
