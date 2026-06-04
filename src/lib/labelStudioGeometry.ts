import type { DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** DYMO label XML: approximate twips per point for Arial on LabelWriter rolls. */
export const LABEL_TWIPS_PER_PT = 28

export type LabelPrintableMetrics = {
  marginLeftPct: number
  marginTopPct: number
  printableWidthPct: number
  printableHeightPct: number
  boundsWidth: number
  boundsHeight: number
  drawWidth: number
  drawHeight: number
}

export function printableMetricsForTemplate(template: DymoPaperTemplate): LabelPrintableMetrics {
  return {
    marginLeftPct: (template.boundsX / template.drawWidth) * 100,
    marginTopPct: (template.boundsY / template.drawHeight) * 100,
    printableWidthPct: (template.boundsWidth / template.drawWidth) * 100,
    printableHeightPct: (template.boundsHeight / template.drawHeight) * 100,
    boundsWidth: template.boundsWidth,
    boundsHeight: template.boundsHeight,
    drawWidth: template.drawWidth,
    drawHeight: template.drawHeight,
  }
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
  const boxHeightTwips = (el.heightPct / 100) * template.boundsHeight
  const boxHeightPx = (el.heightPct / 100) * printableAreaHeightPx
  if (boxHeightPx <= 0 || boxHeightTwips <= 0) return Math.max(8, el.fontSize * 0.5)
  const pt = effectiveTextFontSizePt(el.fontSize, lines, boxHeightTwips, el.textFitMode)
  return Math.max(6, (pt * LABEL_TWIPS_PER_PT * boxHeightPx) / boxHeightTwips)
}
