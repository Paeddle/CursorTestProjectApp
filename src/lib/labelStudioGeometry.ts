import { mmToTwips, type DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

/** Map studio 0–100% (label face) to DYMO printable bounds for the selected roll template. */
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

/** Label Studio canvas = physical sticker face; print uses bounds twips from the same template. */
export function printableMetricsForTemplate(template: DymoPaperTemplate): LabelPrintableMetrics {
  return {
    widthMm: template.widthMm,
    heightMm: template.heightMm,
  }
}

/**
 * On 30323, DYMO only prints in a band at the top of the physical sticker (~bounds vs full height mm).
 * Canvas uses this so element % matches print; gray area below is not printed.
 */
export function shippingPrintableHeightFraction(template: DymoPaperTemplate): number | null {
  if (template.id !== 'Shipping') return null
  const fullTwips = mmToTwips(template.heightMm)
  if (fullTwips <= 0) return null
  return Math.min(1, Math.max(0.35, template.boundsHeight / fullTwips))
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
  const boxHeightPx = Math.max(
    8,
    (el.heightPct / 100) * printableAreaHeightPx - LABEL_STUDIO_CONTENT_INSET_PX * 2
  )
  if (boxHeightPx <= 0 || boxHeightTwips <= 0) return Math.max(8, el.fontSize * 0.75)
  const px = (el.fontSize * LABEL_TWIPS_PER_PT * boxHeightPx) / boxHeightTwips
  return Math.max(6, Math.floor(px * 0.94))
}
