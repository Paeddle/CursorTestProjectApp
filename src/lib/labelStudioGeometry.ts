import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 11

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** @deprecated Unused — kept for call-site compatibility. */ catalogTwips?: boolean }

/** Canvas/preview face (0–100% of 102×59 mm). */
function studioPrintFaceBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }
}

/** Direct map — matches DYMO RenderLabel preview, not this LabelWriter's physical feed. */
function pctToStudioFaceBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioPrintFaceBounds(template)
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
 * 30323 Landscape on LabelWriter: studio vertical% → XML X, horizontal% → XML Y (probe + PrintLabel2).
 * RenderLabel preview looks side-by-side; physical output matches the stacked studio layout.
 */
function pctToShippingLandscapePrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioPrintFaceBounds(template)
  const width = Math.max(80, Math.round((el.heightPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.widthPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.yPct / 100) * (base.width - width)),
    y: base.y + Math.round((el.xPct / 100) * (base.height - height)),
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
  if (template.id === 'Shipping') return pctToShippingLandscapePrintBounds(el, template)
  return pctToStudioFaceBounds(el, template)
}

/** Twips along the text line-height axis after print-axis mapping. */
export function studioPrintTextBoxVerticalTwips(
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

/** Printable height in twips for preview font scaling (same face as print XML). */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return studioPrintFaceBounds(template).height
}

/** Printable width in twips for preview font scaling. */
export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return studioPrintFaceBounds(template).width
}

const LINE_HEIGHT_TWIPS_PER_PT = 28

/** PO-style fixed print size for hardware (ShrinkToFit previews OK in RenderLabel only). */
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

/** @deprecated Use studioPrintTextFontSizePt for print XML. */
export function effectiveTextFontSizePt(
  fontSize: number,
  lineCount: number,
  boxHeightTwips: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  return studioPrintTextFontSizePt(fontSize, lineCount, boxHeightTwips, textFitMode)
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
