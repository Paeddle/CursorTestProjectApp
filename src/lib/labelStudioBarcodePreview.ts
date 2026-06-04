import JsBarcode from 'jsbarcode'
import { barcodeTextForPrint, resolveBarcodeType } from './labelStudioBarcode'
import type { LabelStudioBarcodeType } from '../types/labelStudio'

function jsBarcodeFormat(type: Exclude<LabelStudioBarcodeType, 'Auto'>): string {
  if (type === 'UpcA') return 'UPC'
  if (type === 'Ean13') return 'EAN13'
  if (type === 'Code39') return 'CODE39'
  return 'CODE128'
}

/** Raster barcode scaled to fit the studio element box (bars band only). */
export function linearBarcodePreviewDataUrl(
  text: string,
  barcodeType: LabelStudioBarcodeType,
  boxWidthPx: number,
  boxHeightPx: number
): string | null {
  const symbology = resolveBarcodeType(barcodeType, text)
  if (symbology === 'QrCode') return null
  const encoded = barcodeTextForPrint(text, symbology)
  if (!encoded) return null

  const maxW = Math.max(24, Math.floor(boxWidthPx))
  const maxH = Math.max(16, Math.floor(boxHeightPx))

  try {
    const scratch = document.createElement('canvas')
    JsBarcode(scratch, encoded, {
      format: jsBarcodeFormat(symbology),
      width: 2,
      height: Math.max(24, maxH),
      margin: 2,
      displayValue: false,
    })

    const srcW = scratch.width
    const srcH = scratch.height
    if (srcW <= 0 || srcH <= 0) return null

    const scale = Math.min((maxW - 4) / srcW, (maxH - 4) / srcH, 1)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.floor(srcW * scale))
    out.height = Math.max(1, Math.floor(srcH * scale))
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(scratch, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  } catch {
    return null
  }
}
