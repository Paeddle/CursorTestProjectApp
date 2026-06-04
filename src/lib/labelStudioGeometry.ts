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

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 7

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** Use short 30323 catalog twips (fallback if hybrid rejected). */ catalogTwips?: boolean }

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

/**
 * Map studio 0–100% (102×59 mm face) into the same inner bounds rectangle PO labels use
 * on the hybrid 30323 template (tall draw + large bounds). Direct x/y — wide text boxes so
 * ShrinkToFit is not crushed by a narrow width.
 */
function pctToPoInnerBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = poInnerBoundsForTemplate(template)
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
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  if (options?.catalogTwips) return pctToCatalogBounds(el, template)
  const t = dymoTemplateForStudioPrint(template)
  return pctToPoInnerBounds(el, t)
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

/** Printable height in twips for preview font scaling (inner bounds, not raw catalog bounds). */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return poInnerBoundsForTemplate(dymoTemplateForStudioPrint(template)).height
}

/** Printable width in twips for preview font scaling. */
export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return poInnerBoundsForTemplate(dymoTemplateForStudioPrint(template)).width
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
