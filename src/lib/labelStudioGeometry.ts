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

/** Slight upscale so print matches studio preview size (photo calibration). */
const SHIPPING_PRINT_SIZE_SCALE = 1.1
/** Pull content up — printed labels were vertically centered vs upper-weighted preview. */
const SHIPPING_PRINT_Y_NUDGE_PCT = -3

function calibratedStudioPct(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'> {
  if (template.id !== 'Shipping') return el
  const scale = SHIPPING_PRINT_SIZE_SCALE
  const widthPct = Math.min(98, el.widthPct * scale)
  const heightPct = Math.min(98, el.heightPct * scale)
  const xPct = el.xPct + (el.widthPct - widthPct) / 2
  const yPct = Math.max(0, el.yPct + (el.heightPct - heightPct) / 2 + SHIPPING_PRINT_Y_NUDGE_PCT)
  return { xPct, yPct, widthPct, heightPct }
}

/** Full hybrid printable face — same 0–100% grid as the studio canvas. */
function studioPrintFaceBounds(template: DymoPaperTemplate): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }
}

/** Map studio 0–100% (102×59 face) to DYMO bounds — x→x, y→y (stacked layouts stay stacked). */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  const t = options?.catalogTwips ? template : dymoTemplateForStudioPrint(template)
  const pct = options?.catalogTwips ? el : calibratedStudioPct(el, template)
  const base = studioPrintFaceBounds(t)
  const width = Math.max(80, Math.round((pct.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((pct.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((pct.xPct / 100) * (base.width - width)),
    y: base.y + Math.round((pct.yPct / 100) * (base.height - height)),
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

export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return dymoTemplateForStudioPrint(template).boundsHeight
}

export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return dymoTemplateForStudioPrint(template).boundsWidth
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
