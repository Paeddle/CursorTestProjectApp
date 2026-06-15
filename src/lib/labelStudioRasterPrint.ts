import type { DymoPaperTemplate } from './dymoLabelXml'
import {
  loadImageBlobForPrint,
  loadOrientedImageSource,
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
  pctToDymoPrintBounds,
  previewMaxFontSizePx,
  studioPrintFaceBounds,
  twipsBoundsToFacePixels,
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
import type { LabelStudioImageScaleMode } from '../types/labelStudio'
import { isBarcodeElement, isImageElement, isTextElement } from '../types/labelStudio'

const FIT_TOLERANCE_PX = 2

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
  if (totalH > box.h + FIT_TOLERANCE_PX) return false
  for (const line of lines) {
    if (ctx.measureText(line).width > box.w + FIT_TOLERANCE_PX) return false
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
  designPaper: DymoPaperTemplate,
  printFontScale = 1
): void {
  if (lines.length === 0) return
  const shrink = el.textFitMode !== 'None'
  const maxPx = Math.max(
    4,
    Math.floor(previewMaxFontSizePx(el, faceH, designPaper) * printFontScale)
  )
  const fontPx = shrinkFontPx(ctx, lines, box, maxPx, el.bold, shrink)
  ctx.fillStyle = '#000000'
  ctx.font = `${el.bold ? '700' : '400'} ${fontPx}px Arial,sans-serif`
  ctx.textBaseline = 'middle'
  const lineHeight = fontPx * 1.1
  const totalH = lines.length * lineHeight
  let y = shrink
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

async function drawImageInBox(
  ctx: CanvasRenderingContext2D,
  url: string,
  box: { x: number; y: number; w: number; h: number },
  scaleMode: LabelStudioImageScaleMode,
  thermal?: ThermalImageProcessOptions
): Promise<void> {
  const blob = await loadImageBlobForPrint(url)
  if (!blob) return
  const oriented = await loadOrientedImageSource(blob)
  if (!oriented) return

  try {
    const srcW = Math.max(1, oriented.width)
    const srcH = Math.max(1, oriented.height)
    const scale =
      scaleMode === 'Fill'
        ? Math.max(box.w / srcW, box.h / srcH)
        : Math.min(box.w / srcW, box.h / srcH)
    const dw = Math.max(1, Math.round(srcW * scale))
    const dh = Math.max(1, Math.round(srcH * scale))
    const dx = box.x + Math.round((box.w - dw) / 2)
    const dy = box.y + Math.round((box.h - dh) / 2)
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

/** Paint printable face at 30330 GPD twips — canvas % scaled from durable design face. */
export async function composeDurableStudioLabelRasterBase64(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  designPaper: DymoPaperTemplate,
  printTemplate: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): Promise<string | null> {
  const printOptions: StudioPrintBoundsOptions = {
    designTemplate: designPaper,
    ...options,
  }
  const face = studioPrintFaceBounds(printTemplate)
  const { width: faceW, height: faceH } = labelRasterDimensionsForBounds({
    width: face.width,
    height: face.height,
  })
  const thermal = options?.thermalImage

  const elementBoxPx = (el: LabelStudioElement) =>
    twipsBoundsToFacePixels(
      pctToDymoPrintBounds(el, printTemplate, printOptions),
      face,
      faceW,
      faceH
    )

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

    for (const el of template.elements.filter(isImageElement)) {
      const url = mergedImageUrlForElement(el.content, item)
      if (!url) continue
      try {
        await drawImageInBox(
          ctx,
          url,
          elementBoxPx(el),
          el.scaleMode ?? 'Uniform',
          thermal
        )
      } catch {
        /* skip failed photo — still print text/barcode */
      }
    }

    for (const el of template.elements) {
      if (!isBarcodeElement(el)) continue
      try {
        await drawBarcodeElement(ctx, el, item, elementBoxPx(el))
      } catch {
        /* skip failed barcode */
      }
    }

    for (const el of template.elements) {
      if (!isTextElement(el)) continue
      const lines = mergedLinesForElement(el.content, item)
      drawTextElement(
        ctx,
        el,
        lines,
        elementBoxPx(el),
        faceH,
        designPaper,
        0.94
      )
    }

    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  }
}
