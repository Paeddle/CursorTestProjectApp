import {
  LABEL_STUDIO_CONTENT_INSET_PX,
  LABEL_TWIPS_PER_PT,
  studioBoundsHeightTwips,
  type DymoLabelBounds,
} from './labelStudioGeometry'
import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioBarcodeElement, LabelStudioBarcodeTextPosition } from '../types/labelStudio'

export const DEFAULT_BARCODE_TEXT_FONT_SIZE = 10

/** Caption band as % of the barcode element (numbers auto-fit inside this band). */
export const BARCODE_CAPTION_BAND_PCT = 22

/** Max point size sent to DYMO before ShrinkToFit scales the caption down. */
export const BARCODE_CAPTION_MAX_FONT_PT = 14

export function barcodeCaptionHeightPct(_textFontSize?: number): number {
  return BARCODE_CAPTION_BAND_PCT
}

/** Pixel size of the bars/QR band inside the dashed element (excludes caption). */
export function previewBarcodeBarsBoxPx(
  el: Pick<LabelStudioBarcodeElement, 'widthPct' | 'heightPct' | 'textPosition' | 'textFontSize'>,
  printableWidthPx: number,
  printableHeightPx: number
): { width: number; height: number } {
  const band = el.textPosition !== 'None' ? BARCODE_CAPTION_BAND_PCT : 0
  const inset = LABEL_STUDIO_CONTENT_INSET_PX
  const innerW = (el.widthPct / 100) * printableWidthPx - inset * 2
  const innerH = (el.heightPct / 100) * printableHeightPx - inset * 2
  return {
    width: Math.max(16, innerW),
    height: Math.max(12, innerH * (1 - band / 100)),
  }
}

export function splitBarcodeElementBounds(
  bounds: DymoLabelBounds,
  textPosition: LabelStudioBarcodeTextPosition
): { barcode: DymoLabelBounds; caption?: DymoLabelBounds } {
  if (textPosition === 'None') return { barcode: bounds }

  const gap = 3
  const captionH = Math.max(72, Math.round(bounds.height * (BARCODE_CAPTION_BAND_PCT / 100)))
  const barcodeH = Math.max(80, bounds.height - captionH - gap)

  if (textPosition === 'Bottom') {
    return {
      barcode: { ...bounds, height: barcodeH },
      caption: {
        x: bounds.x,
        y: bounds.y + barcodeH + gap,
        width: bounds.width,
        height: captionH,
      },
    }
  }

  return {
    caption: { x: bounds.x, y: bounds.y, width: bounds.width, height: captionH },
    barcode: {
      x: bounds.x,
      y: bounds.y + captionH + gap,
      width: bounds.width,
      height: barcodeH,
    },
  }
}

/** Max canvas font (px) for barcode caption shrink-to-fit. */
export function previewBarcodeCaptionMaxFontPx(
  elementHeightPct: number,
  printableAreaHeightPx: number,
  template: DymoPaperTemplate
): number {
  const studioH = studioBoundsHeightTwips(template)
  const captionHeightTwips = (elementHeightPct / 100) * studioH * (BARCODE_CAPTION_BAND_PCT / 100)
  const captionHeightPx = Math.max(
    6,
    (elementHeightPct / 100) * printableAreaHeightPx * (BARCODE_CAPTION_BAND_PCT / 100) - 2
  )
  if (captionHeightPx <= 0 || captionHeightTwips <= 0) return 10
  const px =
    (BARCODE_CAPTION_MAX_FONT_PT * LABEL_TWIPS_PER_PT * captionHeightPx) / captionHeightTwips
  return Math.max(5, Math.floor(px * 0.9))
}
