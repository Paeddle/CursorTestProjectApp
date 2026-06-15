import type { DymoPaperTemplate } from './dymoLabelXml'
import { previewMaxFontSizePx, studioPrintFaceBounds, type DymoLabelBounds } from './labelStudioGeometry'
import type { LabelStudioTextElement } from '../types/labelStudio'

const FIT_TOLERANCE_PX = 2

function textFitsBox(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: { w: number; h: number },
  fontPx: number,
  bold: boolean
): boolean {
  ctx.font = `${bold ? '700' : '400'} ${fontPx}px Arial,sans-serif`
  const lineHeight = fontPx * 1.1
  const totalH = lines.length * lineHeight
  if (totalH > box.h + FIT_TOLERANCE_PX) return false
  for (const line of lines) {
    if (ctx.measureText(line).width > box.w + FIT_TOLERANCE_PX) return false
  }
  return true
}

function shrinkFontPx(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: { w: number; h: number },
  maxPx: number,
  bold: boolean,
  shrink: boolean
): number {
  const ceiling = Math.max(4, Math.floor(maxPx))
  if (!shrink || textFitsBox(ctx, lines, box, ceiling, bold)) return ceiling
  let lo = 4
  let hi = ceiling
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textFitsBox(ctx, lines, box, mid, bold)) lo = mid
    else hi = mid - 1
  }
  return Math.max(4, lo)
}

/** Same binary-search fit as Label Studio canvas — return pt for DYMO Font Size with TextFitMode None. */
export function studioCanvasFitFontPt(
  el: Pick<LabelStudioTextElement, 'fontSize' | 'bold' | 'textFitMode' | 'heightPct'>,
  lines: string[],
  bounds: DymoLabelBounds,
  designTemplate: DymoPaperTemplate
): number {
  if (lines.length === 0) return el.fontSize
  const faceH = studioPrintFaceBounds(designTemplate).height
  const faceHPx = Math.max(1, Math.round((faceH * 96) / 1440))
  const boxPx = {
    w: Math.max(1, Math.round((bounds.width * 96) / 1440)),
    h: Math.max(1, Math.round((bounds.height * 96) / 1440)),
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return el.fontSize
  const shrink = el.textFitMode !== 'None'
  const maxPx = previewMaxFontSizePx(
    el as LabelStudioTextElement,
    faceHPx,
    designTemplate
  )
  const fontPx = shrinkFontPx(ctx, lines, boxPx, maxPx, el.bold, shrink)
  return Math.max(8, fontPx)
}
