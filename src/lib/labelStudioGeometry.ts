import { poInnerBoundsForTemplate, type DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 22
// rev 22: WIDTH_SCALE 1.45, HEIGHT_SCALE 1.25 on designer % (positions unchanged)

/** Measured vs designer: width/height print ~65–70% of XML; boost separately. */
const SHIPPING_WIDTH_SCALE = 1.45
const SHIPPING_HEIGHT_SCALE = 1.25
/** Hardware compresses XML Y toward the top — boost top-edge % only (not box height). */
const SHIPPING_Y_POSITION_SCALE = 1.28

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = { /** @deprecated Unused — kept for call-site compatibility. */ catalogTwips?: boolean }

/** Full catalog printable face — matches the Label Studio canvas (102×59 mm on 30323). */
function studioFaceBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }
}

/** Printable band for preview font scaling and non-30323 rolls. */
function studioPrintableBounds(template: DymoPaperTemplate): DymoLabelBounds {
  if (template.id === 'Shipping') return studioFaceBounds(template)
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

function clampShippingBounds(
  bounds: DymoLabelBounds,
  base: DymoLabelBounds
): DymoLabelBounds {
  const width = Math.min(bounds.width, base.width)
  const height = Math.min(bounds.height, base.height)
  const maxX = base.x + base.width - width
  const maxY = base.y + base.height - height
  return {
    x: Math.max(base.x, Math.min(maxX, bounds.x)),
    y: Math.max(base.y, Math.min(maxY, bounds.y)),
    width,
    height,
  }
}

/**
 * 30323: literal designer % on catalog face.
 * Y is face-linear (yPct = top edge on canvas) so stacked fields keep designer gaps.
 * X uses inset anchor so wide elements honor width% without overflowing.
 */
function pctToShippingPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioFaceBounds(template)
  const width = Math.max(
    80,
    Math.round((el.widthPct / 100) * base.width * SHIPPING_WIDTH_SCALE)
  )
  const height = Math.max(
    60,
    Math.round((el.heightPct / 100) * base.height * SHIPPING_HEIGHT_SCALE)
  )
  const y = base.y + Math.round((el.yPct / 100) * base.height * SHIPPING_Y_POSITION_SCALE)
  return clampShippingBounds(
    {
      x: base.x + Math.round((el.xPct / 100) * (base.width - width)),
      y,
      width,
      height,
    },
    base
  )
}

/**
 * 30323 QR: square sized from width% (102 mm face) — hardware scales the wide XML axis.
 * Centered inside the designer barcode rectangle.
 */
export function shippingQrPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioFaceBounds(template)
  const rect = pctToShippingPrintBounds(el, template)
  const side = Math.max(80, Math.min(rect.width, rect.height))
  return clampShippingBounds(
    {
      x: rect.x + Math.round((rect.width - side) / 2),
      y: rect.y + Math.round((rect.height - side) / 2),
      width: side,
      height: side,
    },
    base
  )
}

/** Fit text like the canvas ShrinkToFit preview within the element box. */
export function shippingPrintFontSizePt(
  lines: string[],
  fontSize: number,
  bounds: DymoLabelBounds
): number {
  const byHeight = studioPrintTextFontSizePt(
    fontSize,
    Math.max(1, lines.length),
    bounds.height,
    'ShrinkToFit'
  )
  const chars = Math.max(1, lines.join(' ').length)
  const byWidth = Math.max(8, Math.floor(bounds.width / (chars * 11)))
  return Math.min(fontSize, byHeight, byWidth)
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

/** Twips used to size print font — match canvas (element height band on 30323). */
export function studioPrintTextFontBoxTwips(
  bounds: DymoLabelBounds,
  _template: DymoPaperTemplate
): number {
  return bounds.height
}

/** @deprecated Use studioPrintTextFontBoxTwips */
export function studioPrintTextVerticalTwips(
  bounds: DymoLabelBounds,
  template: DymoPaperTemplate
): number {
  return studioPrintTextFontBoxTwips(bounds, template)
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

/** Canvas preview vertical axis in twips (59 mm on 30323). */
export function studioBoundsHeightTwips(template: DymoPaperTemplate): number {
  return studioPrintableBounds(template).height
}

/** Canvas preview horizontal axis in twips (102 mm on 30323). */
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
