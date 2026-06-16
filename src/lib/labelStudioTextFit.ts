import type { DymoPaperTemplate } from './dymoLabelXml'
import { previewMaxFontSizePx, studioPrintFaceBounds, type DymoLabelBounds } from './labelStudioGeometry'
import type { LabelStudioTextElement } from '../types/labelStudio'

const FIT_TOLERANCE_PX = 2
const PREVIEW_LINE_HEIGHT = 1.1

export function splitPreviewTextLines(text: string): string[] {
  if (!text) return []
  return text.split('\n').map((l) => l.trimEnd())
}

export function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number,
  fontPx: number,
  bold: boolean
): string[] {
  ctx.font = `${bold ? '700' : '400'} ${fontPx}px Arial,sans-serif`
  const wrapped: string[] = []
  for (const raw of lines) {
    if (!raw) {
      wrapped.push('')
      continue
    }
    const words = raw.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      wrapped.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const test = current ? `${current} ${word}` : word
      if (ctx.measureText(test).width <= maxWidth + FIT_TOLERANCE_PX) {
        current = test
      } else if (!current) {
        wrapped.push(word)
      } else {
        wrapped.push(current)
        current = word
      }
    }
    if (current) wrapped.push(current)
  }
  return wrapped
}

function layoutFits(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: { w: number; h: number },
  fontPx: number,
  bold: boolean,
  allowWrap: boolean
): boolean {
  const displayLines = allowWrap ? wrapTextLines(ctx, lines, box.w, fontPx, bold) : lines
  ctx.font = `${bold ? '700' : '400'} ${fontPx}px Arial,sans-serif`
  const lineHeight = fontPx * PREVIEW_LINE_HEIGHT
  if (displayLines.length * lineHeight > box.h + FIT_TOLERANCE_PX) return false
  for (const line of displayLines) {
    if (ctx.measureText(line).width > box.w + FIT_TOLERANCE_PX) return false
  }
  return true
}

export type FittedPreviewLayout = {
  fontPx: number
  displayLines: string[]
  lineHeightPx: number
}

export function fittedPreviewLayout(
  lines: string[],
  box: { w: number; h: number },
  maxPx: number,
  bold: boolean,
  shrink: boolean,
  allowWrap = true
): FittedPreviewLayout {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const ceiling = Math.max(4, Math.floor(maxPx))
  if (!ctx || lines.length === 0) {
    return { fontPx: ceiling, displayLines: lines, lineHeightPx: ceiling * PREVIEW_LINE_HEIGHT }
  }

  let fontPx = ceiling
  if (shrink && !layoutFits(ctx, lines, box, ceiling, bold, allowWrap)) {
    let lo = 4
    let hi = ceiling
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (layoutFits(ctx, lines, box, mid, bold, allowWrap)) lo = mid
      else hi = mid - 1
    }
    fontPx = Math.max(4, lo)
  }

  const displayLines = allowWrap ? wrapTextLines(ctx, lines, box.w, fontPx, bold) : lines
  return {
    fontPx,
    displayLines,
    lineHeightPx: fontPx * PREVIEW_LINE_HEIGHT,
  }
}

function shrinkFontPx(
  lines: string[],
  box: { w: number; h: number },
  maxPx: number,
  bold: boolean,
  shrink: boolean
): number {
  return fittedPreviewLayout(lines, box, maxPx, bold, shrink).fontPx
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
  const fontPx = shrinkFontPx(lines, boxPx, maxPx, el.bold, shrink)
  return Math.max(8, fontPx)
}
