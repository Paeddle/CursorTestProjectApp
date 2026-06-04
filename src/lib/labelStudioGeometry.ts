import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

/**
 * 30323 Landscape: DYMO bounds are wide×short in XML (≈102mm×28mm twips) while the sticker
 * face is 102×59 mm. Map studio vertical % → bounds X and horizontal % → bounds Y so
 * stacked layouts use the long axis (see scripts/dymo-probe-shipping-render.mjs).
 */
function shippingStudioFaceBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  return {
    x: template.boundsX + Math.round((el.yPct / 100) * template.boundsWidth),
    y: template.boundsY + Math.round((el.xPct / 100) * template.boundsHeight),
    width: Math.max(80, Math.round((el.heightPct / 100) * template.boundsWidth)),
    height: Math.max(60, Math.round((el.widthPct / 100) * template.boundsHeight)),
  }
}

/** Map studio 0–100% (label face) to DYMO printable bounds for the selected roll template. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  if (template.id === 'Shipping') return shippingStudioFaceBounds(el, template)
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

/** Twips along the studio vertical axis (used for print font / caption scaling). */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  if (template.id === 'Shipping') return template.boundsWidth
  return template.boundsHeight
}

export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  if (template.id === 'Shipping') return template.boundsHeight
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
