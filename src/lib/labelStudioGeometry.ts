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

/** Point size used in DYMO XML so print matches the studio box (not DYMO auto-shrink). */
export function effectiveTextFontSizePt(
  fontSize: number,
  lineCount: number,
  boxHeightTwips: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  if (textFitMode === 'None') return fontSize
  const lines = Math.max(1, lineCount)
  const maxByBox = Math.floor(boxHeightTwips / (lines * LABEL_TWIPS_PER_PT))
  return Math.max(8, Math.min(fontSize, maxByBox))
}

/** Preview font size (px) inside the element box on the canvas. */
export function previewFontSizePx(
  el: LabelStudioTextElement,
  printableAreaHeightPx: number,
  template: DymoPaperTemplate,
  lineCount?: number
): number {
  const lines = lineCount ?? Math.max(1, el.content.split('\n').length)
  const studioH = studioBoundsHeightTwips(template)
  const boxHeightTwips = (el.heightPct / 100) * studioH
  const boxHeightPx = (el.heightPct / 100) * printableAreaHeightPx
  if (boxHeightPx <= 0 || boxHeightTwips <= 0) return Math.max(8, el.fontSize * 0.5)
  const pt = effectiveTextFontSizePt(el.fontSize, lines, boxHeightTwips, el.textFitMode)
  return Math.max(6, (pt * LABEL_TWIPS_PER_PT * boxHeightPx) / boxHeightTwips)
}
