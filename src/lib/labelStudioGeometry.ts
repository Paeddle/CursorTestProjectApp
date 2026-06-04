import {
  dymoTemplateForStudioPrint,
  type DymoPaperTemplate,
} from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** Use short 30323 catalog twips (fallback if hybrid rejected). */ catalogTwips?: boolean }

/**
 * Hybrid tall draw (3331×5715) vs 30323 studio face (102×59 mm):
 * - Horizontal on the sticker (102 mm) → XML Y / drawHeight
 * - Vertical on the sticker (59 mm) → XML X / drawWidth
 * Same xPct → same Y (centered); different yPct → different X (stacked).
 */
function shippingDrawFaceAxes(template: DymoPaperTemplate): {
  x0: number
  y0: number
  axisX: number
  axisY: number
} {
  const pad = 50
  return {
    x0: pad,
    y0: pad,
    axisX: template.drawWidth - pad * 2,
    axisY: template.drawHeight - pad * 2,
  }
}

function pctToDymoShippingHybridBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const { x0, y0, axisX, axisY } = shippingDrawFaceAxes(template)
  const width = Math.max(60, Math.round((el.heightPct / 100) * axisX))
  const height = Math.max(80, Math.round((el.widthPct / 100) * axisY))
  return {
    x: x0 + Math.round((el.yPct / 100) * (axisX - width)),
    y: y0 + Math.round((el.xPct / 100) * (axisY - height)),
    width,
    height,
  }
}

function pctToCatalogBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const pad = 40
  const base = {
    x: template.boundsX + pad,
    y: template.boundsY + pad,
    width: template.boundsWidth - pad * 2,
    height: template.boundsHeight - pad * 2,
  }
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.yPct / 100) * (base.height - height)),
    width,
    height,
  }
}

/** Map studio 0–100% (102×59 face) to DYMO object bounds inside the draw rectangle. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  if (options?.catalogTwips) return pctToCatalogBounds(el, template)
  const t = dymoTemplateForStudioPrint(template)
  if (t.id === 'Shipping') return pctToDymoShippingHybridBounds(el, t)
  const pad = 50
  const width = Math.max(80, Math.round((el.widthPct / 100) * (t.drawWidth - pad * 2)))
  const height = Math.max(60, Math.round((el.heightPct / 100) * (t.drawHeight - pad * 2)))
  return {
    x: pad + Math.round((el.xPct / 100) * (t.drawWidth - pad * 2 - width)),
    y: pad + Math.round((el.yPct / 100) * (t.drawHeight - pad * 2 - height)),
    width,
    height,
  }
}

export type LabelPrintableMetrics = {
  widthMm: number
  heightMm: number
}

export function printableMetricsForTemplate(template: DymoPaperTemplate): LabelPrintableMetrics {
  return {
    widthMm: template.widthMm,
    heightMm: template.heightMm,
  }
}

/** Studio vertical (59 mm) — maps to drawWidth on 30323 hybrid print. */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  const t = dymoTemplateForStudioPrint(template)
  if (t.id === 'Shipping') return t.drawWidth
  return t.boundsHeight
}

/** Studio horizontal (102 mm) — maps to drawHeight on 30323 hybrid print. */
export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  const t = dymoTemplateForStudioPrint(template)
  if (t.id === 'Shipping') return t.drawHeight
  return t.boundsWidth
}

export function effectiveTextFontSizePt(
  fontSize: number,
  _lineCount: number,
  _boxHeightTwips: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  if (textFitMode === 'ShrinkToFit' || textFitMode == null) return fontSize
  return fontSize
}

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
