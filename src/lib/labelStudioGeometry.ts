import { poInnerBoundsForTemplate, type DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 14

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** @deprecated Unused — kept for call-site compatibility. */ catalogTwips?: boolean }

/** poInner printable band (same as PO Info labels). */
function studioPrintableBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return poInnerBoundsForTemplate(template)
}

/** Direct map for non-30323 rolls. */
function pctToStudioPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioPrintableBounds(template)
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.yPct / 100) * (base.height - height)),
    width,
    height,
  }
}

/**
 * 30323: keep wide XML boxes (text runs along the label edge — correct on this printer).
 * Use face-linear Y so designer top/bottom % match print and stacked elements do not overlap.
 */
function pctToShippingPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioPrintableBounds(template)
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  const maxY = base.y + base.height - height
  return {
    x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
    y: Math.min(base.y + Math.round((el.yPct / 100) * base.height), maxY),
    width,
    height,
  }
}

/** Map studio 0–100% to DYMO object bounds for print XML. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate,
  _options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  if (template.id === 'Shipping') return pctToShippingPrintBounds(el, template)
  return pctToStudioPrintBounds(el, template)
}

/** Text flow axis in print XML (30323 wide Bounds.Width is along the readable edge). */
export function studioPrintTextVerticalTwips(
  bounds: DymoLabelBounds,
  template: DymoPaperTemplate
): number {
  if (template.id === 'Shipping') return bounds.width
  return bounds.height
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

/** Canvas preview uses face vertical (59 mm) — poInner height twips. */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return studioPrintableBounds(template).height
}

/** Canvas preview uses face horizontal (102 mm) — poInner width twips. */
export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return studioPrintableBounds(template).width
}

const LINE_HEIGHT_TWIPS_PER_PT = 28

export function studioPrintTextFontSizePt(
  fontSize: number,
  lineCount: number,
  boxVerticalTwips: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  const lines = Math.max(1, lineCount)
  const needed = lines * fontSize * LINE_HEIGHT_TWIPS_PER_PT
  if (textFitMode === 'None' || needed <= boxVerticalTwips) return fontSize
  return Math.max(8, Math.floor((fontSize * boxVerticalTwips) / needed))
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
