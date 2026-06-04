import {
  dymoTemplateForStudioPrint,
  poInnerBoundsForTemplate,
  type DymoPaperTemplate,
} from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** Use short 30323 catalog twips (fallback if hybrid rejected). */ catalogTwips?: boolean }

/** 30323 face is 102×59 mm; hybrid draw is ~59×102 mm in XML (X short, Y long). */
function shippingHybridFaceAxes(template: DymoPaperTemplate): {
  x0: number
  y0: number
  /** Twips along studio vertical (59 mm) → XML X. */
  axisShort: number
  /** Twips along studio horizontal (102 mm) → XML Y. */
  axisLong: number
} {
  const padShort = Math.round(template.boundsWidth * 0.02)
  const padLong = Math.round(template.boundsHeight * 0.02)
  return {
    x0: template.boundsX + padShort,
    y0: template.boundsY + padLong,
    axisShort: template.boundsWidth - padShort * 2,
    axisLong: template.boundsHeight - padLong * 2,
  }
}

/** Map studio % on 102×59 face to hybrid tall draw (stacked layout, not side-by-side). */
function pctToDymoShippingHybridBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const { x0, y0, axisShort, axisLong } = shippingHybridFaceAxes(template)
  const boundHeight = Math.max(80, Math.round((el.widthPct / 100) * axisLong))
  const boundWidth = Math.max(60, Math.round((el.heightPct / 100) * axisShort))
  return {
    x: x0 + Math.round((el.yPct / 100) * (axisShort - boundWidth)),
    y: y0 + Math.round((el.xPct / 100) * (axisLong - boundHeight)),
    width: boundWidth,
    height: boundHeight,
  }
}

/** Map studio 0–100% to DYMO printable bounds. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  if (template.id === 'Shipping' && !options?.catalogTwips) {
    return pctToDymoShippingHybridBounds(el, dymoTemplateForStudioPrint(template))
  }

  const t = options?.catalogTwips ? template : dymoTemplateForStudioPrint(template)
  const base = poInnerBoundsForTemplate(t)
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.yPct / 100) * (base.height - height)),
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

/** Studio vertical (59 mm) twips for font/box scaling on 30323 hybrid print. */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  const t = dymoTemplateForStudioPrint(template)
  if (t.id === 'Shipping') return t.boundsWidth
  return t.boundsHeight
}

/** Studio horizontal (102 mm) twips for font/box scaling on 30323 hybrid print. */
export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  const t = dymoTemplateForStudioPrint(template)
  if (t.id === 'Shipping') return t.boundsHeight
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
