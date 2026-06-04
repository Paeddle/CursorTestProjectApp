import {
  effectiveTextFontSizePt,
  LABEL_STUDIO_CONTENT_INSET_PX,
  LABEL_TWIPS_PER_PT,
  studioBoundsHeightTwips,
  type DymoLabelBounds,
} from './labelStudioGeometry'
import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioBarcodeElement, LabelStudioBarcodeTextPosition } from '../types/labelStudio'

export const DEFAULT_BARCODE_TEXT_FONT_SIZE = 10

/** Caption band height as % of the barcode element box. */
export function barcodeCaptionHeightPct(textFontSize: number): number {
  return Math.min(42, Math.max(16, 12 + textFontSize * 1.1))
}

/** Pixel size of the bars/QR band inside the dashed element (excludes caption). */
export function previewBarcodeBarsBoxPx(
  el: Pick<LabelStudioBarcodeElement, 'widthPct' | 'heightPct' | 'textPosition' | 'textFontSize'>,
  printableWidthPx: number,
  printableHeightPx: number
): { width: number; height: number } {
  const band = el.textPosition !== 'None' ? barcodeCaptionHeightPct(el.textFontSize ?? DEFAULT_BARCODE_TEXT_FONT_SIZE) : 0
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
