import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

/** Map studio 0–100% (full canvas face) to DYMO printable bounds — matches driver scale. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  return {
    x: template.boundsX + Math.round((el.xPct / 100) * template.boundsWidth),
    y: template.boundsY + Math.round((el.yPct / 100) * template.boundsHeight),
    width: Math.max(80, Math.round((el.widthPct / 100) * template.boundsWidth)),
    height: Math.max(60, Math.round((el.heightPct / 100) * template.boundsHeight)),
  }
}

export type LabelPrintableMetrics = {
  /** Physical width / height for canvas aspect ratio. */
  widthMm: number
  heightMm: number
}

/** Label Studio canvas = physical sticker face; print uses DYMO bounds twips for sizing. */
export function printableMetricsForTemplate(template: DymoPaperTemplate): LabelPrintableMetrics {
  return {
    widthMm: template.widthMm,
    heightMm: template.heightMm,
  }
}

export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return template.boundsHeight
}

export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return template.boundsWidth
}

/** Point size for fixed-size text (ShrinkToFit uses max size + DYMO TextFitMode instead). */
export function effectiveTextFontSizePt(
  fontSize: number,
  _lineCount: number,
  _boxHeightTwips: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  if (textFitMode === 'ShrinkToFit' || textFitMode == null) return fontSize
  return fontSize
}

/** Max preview font (px) before shrink-to-fit — matches configured pt size in the element box. */
export function previewMaxFontSizePx(
  el: LabelStudioTextElement,
  printableAreaHeightPx: number,
  template: DymoPaperTemplate
): number {
  const studioH = studioBoundsHeightTwips(template)
  const boxHeightTwips = (el.heightPct / 100) * studioH
  const boxHeightPx = (el.heightPct / 100) * printableAreaHeightPx
  if (boxHeightPx <= 0 || boxHeightTwips <= 0) return Math.max(8, el.fontSize * 0.75)
  return Math.max(6, (el.fontSize * LABEL_TWIPS_PER_PT * boxHeightPx) / boxHeightTwips)
}
