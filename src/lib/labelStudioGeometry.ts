import { poInnerBoundsForTemplate, type DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 12

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** @deprecated Unused — kept for call-site compatibility. */ catalogTwips?: boolean }

/**
 * Printable rectangle the LabelWriter actually uses (same poInner band as PO Info labels).
 * Studio canvas is the full 102×59 mm face; 0–100% maps into this inner bounds rect.
 */
function studioPrintableBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return poInnerBoundsForTemplate(template)
}

/** Map studio 0–100% into poInner bounds — direct x/y, same as PO label coordinates. */
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

/** Map studio 0–100% to DYMO object bounds for print XML. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate,
  _options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  return pctToStudioPrintBounds(el, template)
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

/** Printable height in twips for preview font scaling (poInner, matches print). */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return studioPrintableBounds(template).height
}

/** Printable width in twips for preview font scaling. */
export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return studioPrintableBounds(template).width
}

const LINE_HEIGHT_TWIPS_PER_PT = 28

/** Fixed font size for hardware print (PO labels use TextFitMode=None the same way). */
export function studioPrintTextFontSizePt(
  fontSize: number,
  lineCount: number,
  boxHeightTwips: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  const lines = Math.max(1, lineCount)
  const needed = lines * fontSize * LINE_HEIGHT_TWIPS_PER_PT
  if (textFitMode === 'None' || needed <= boxHeightTwips) return fontSize
  return Math.max(8, Math.floor((fontSize * boxHeightTwips) / needed))
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
