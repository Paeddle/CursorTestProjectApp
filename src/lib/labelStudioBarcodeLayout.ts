import {
  effectiveTextFontSizePt,
  LABEL_TWIPS_PER_PT,
  studioBoundsHeightTwips,
  type DymoLabelBounds,
} from './labelStudioGeometry'
import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioBarcodeTextPosition } from '../types/labelStudio'

export const DEFAULT_BARCODE_TEXT_FONT_SIZE = 10

/** Caption band height as % of the barcode element box. */
export function barcodeCaptionHeightPct(textFontSize: number): number {
  return Math.min(42, Math.max(16, 12 + textFontSize * 1.1))
}

export function splitBarcodeElementBounds(
  bounds: DymoLabelBounds,
  textPosition: LabelStudioBarcodeTextPosition,
  textFontSize: number
): { barcode: DymoLabelBounds; caption?: DymoLabelBounds } {
  if (textPosition === 'None') return { barcode: bounds }

  const gap = 3
  const captionH = Math.max(72, Math.round(bounds.height * (barcodeCaptionHeightPct(textFontSize) / 100)))
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

/** Canvas caption font size (px) aligned with printed caption band. */
export function previewBarcodeCaptionFontPx(
  textFontSize: number,
  elementHeightPct: number,
  printableAreaHeightPx: number,
  template: DymoPaperTemplate
): number {
  const elementHeightPx = (elementHeightPct / 100) * printableAreaHeightPx
  const bandPct = barcodeCaptionHeightPct(textFontSize)
  const captionPx = elementHeightPx * (bandPct / 100)
  const studioH = studioBoundsHeightTwips(template)
  const captionTwips = (elementHeightPct / 100) * studioH * (bandPct / 100)
  if (captionTwips <= 0 || captionPx <= 0) return textFontSize
  const pt = effectiveTextFontSizePt(textFontSize, 1, captionTwips, 'None')
  return Math.max(6, (pt * LABEL_TWIPS_PER_PT * captionPx) / captionTwips)
}
