import { mmToTwips, type DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** DYMO label XML: approximate twips per point for Arial on LabelWriter rolls. */
export const LABEL_TWIPS_PER_PT = 28

export type LabelPrintableMetrics = {
  /** Physical width / height for canvas aspect ratio. */
  widthMm: number
  heightMm: number
  /** Twips used for Label Studio print XML (full physical face). */
  studioWidthTwips: number
  studioHeightTwips: number
}

/** Label Studio canvas = full physical sticker; coordinates map 0–100% to that face. */
export function printableMetricsForTemplate(template: DymoPaperTemplate): LabelPrintableMetrics {
  return {
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    studioWidthTwips: mmToTwips(template.widthMm),
    studioHeightTwips: mmToTwips(template.heightMm),
  }
}

export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return mmToTwips(template.heightMm)
}

export function studioBoundsWidthTwips(template: DymoPaperTemplate): number {
  return mmToTwips(template.widthMm)
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
