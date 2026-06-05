import { poInnerBoundsForTemplate, type DymoPaperTemplate } from './dymoLabelXml'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 32

/** QR square fills this fraction of the barcode element box (canvas CSS + print bounds). */
export const STUDIO_QR_GRAPHIC_FILL_FRAC = 0.92

/** Rolls that map designer % on the catalog face (same grid as the Label Studio canvas). */
const STUDIO_FACE_PRINT_TEMPLATE_IDS = new Set([
  'Shipping',
  'Durable1933085',
  'Address30251',
])

/** Hybrid bounds origin differs from 30323 catalog — anchor from catalog face like the canvas. */
const SHIPPING_HYBRID_X_FROM_DESIGN_ORIGIN = true
const SHIPPING_HYBRID_Y_FROM_DESIGN_ORIGIN = true
/** Legacy Y calibration — disabled so print matches the canvas (rev 30). */
const SHIPPING_PRINT_Y_UP_FRAC = 0

function usesStudioFacePrint(template: DymoPaperTemplate): boolean {
  return STUDIO_FACE_PRINT_TEMPLATE_IDS.has(template.id)
}

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = {
  /** Catalog template used by the designer canvas (30323 face). */
  designTemplate?: DymoPaperTemplate
  /** @deprecated Unused — kept for call-site compatibility. */
  catalogTwips?: boolean
}

/** Full catalog printable face — matches the Label Studio canvas (102×59 mm on 30323). */
function studioFaceBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }
}

/** Printable band for preview font scaling — matches canvas % grid on studio rolls. */
function studioPrintableBounds(template: DymoPaperTemplate): DymoLabelBounds {
  if (usesStudioFacePrint(template)) return studioFaceBounds(template)
  return poInnerBoundsForTemplate(template)
}

/**
 * Designer % → twips on the canvas face (top-left anchor, same as CSS left/top/width/height %).
 * DYMO Connect RenderLabel matches this mapping on 30323 catalog bounds.
 */
function pctToCanvasFaceBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): DymoLabelBounds {
  const base = studioFaceBounds(template)
  const width = Math.max(80, Math.round((el.widthPct / 100) * base.width))
  const height = Math.max(60, Math.round((el.heightPct / 100) * base.height))
  return {
    x: base.x + Math.round((el.xPct / 100) * base.width),
    y: base.y + Math.round((el.yPct / 100) * base.height),
    width,
    height,
  }
}

/** Scale catalog-face bounds into the print envelope (30256 hybrid on 30323 rolls). */
function scaleFaceBoundsToPrintTemplate(
  bounds: DymoLabelBounds,
  designTemplate: DymoPaperTemplate,
  printTemplate: DymoPaperTemplate
): DymoLabelBounds {
  const design = studioFaceBounds(designTemplate)
  const print = studioFaceBounds(printTemplate)
  if (
    design.x === print.x &&
    design.y === print.y &&
    design.width === print.width &&
    design.height === print.height
  ) {
    return bounds
  }
  const scaleX = print.width / design.width
  const scaleY = print.height / design.height
  const x =
    SHIPPING_HYBRID_X_FROM_DESIGN_ORIGIN
      ? design.x + Math.round((bounds.x - design.x) * scaleX)
      : print.x + Math.round((bounds.x - design.x) * scaleX)
  const y =
    SHIPPING_HYBRID_Y_FROM_DESIGN_ORIGIN
      ? design.y + Math.round((bounds.y - design.y) * scaleY)
      : print.y + Math.round((bounds.y - design.y) * scaleY)
  return {
    x,
    y,
    width: Math.max(80, Math.round(bounds.width * scaleX)),
    height: Math.max(60, Math.round(bounds.height * scaleY)),
  }
}

function nudgeShippingPrintYUp(
  bounds: DymoLabelBounds,
  printTemplate: DymoPaperTemplate
): DymoLabelBounds {
  const face = studioFaceBounds(printTemplate)
  const up = Math.round(face.height * SHIPPING_PRINT_Y_UP_FRAC)
  return { ...bounds, y: bounds.y - up }
}

function clampWithinFace(bounds: DymoLabelBounds, face: DymoLabelBounds): DymoLabelBounds {
  const width = Math.min(bounds.width, face.width)
  const height = Math.min(bounds.height, face.height)
  const maxX = face.x + face.width - width
  const maxY = face.y + face.height - height
  return {
    x: Math.max(face.x, Math.min(maxX, bounds.x)),
    y: Math.max(face.y, Math.min(maxY, bounds.y)),
    width,
    height,
  }
}

/** Direct map for non-30323 rolls (poInner + inset anchor). */
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

/** QR: square centered in the designer barcode rectangle (ImageObject fill on print). */
export function studioQrPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  printTemplate: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  const rect = pctToDymoPrintBounds(el, printTemplate, options)
  let side = Math.max(80, Math.min(rect.width, rect.height))
  side = Math.max(80, Math.round(side * STUDIO_QR_GRAPHIC_FILL_FRAC))
  const face = studioFaceBounds(printTemplate)
  return clampWithinFace(
    {
      x: rect.x + Math.round((rect.width - side) / 2),
      y: rect.y + Math.round((rect.height - side) / 2),
      width: side,
      height: side,
    },
    face
  )
}

/** @deprecated Use studioQrPrintBounds */
export function shippingQrPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  printTemplate: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  return studioQrPrintBounds(el, printTemplate, options)
}

export function usesStudioQrImagePrint(template: DymoPaperTemplate): boolean {
  return usesStudioFacePrint(template)
}

/** Map studio 0–100% to DYMO object bounds for print XML. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  printTemplate: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  if (!usesStudioFacePrint(printTemplate)) return pctToStudioPrintBounds(el, printTemplate)

  const designTemplate = options?.designTemplate ?? printTemplate
  const onCanvas = pctToCanvasFaceBounds(el, designTemplate)

  const face = studioFaceBounds(printTemplate)
  let mapped: DymoLabelBounds
  if (printTemplate.id === 'Shipping') {
    const scaled = scaleFaceBoundsToPrintTemplate(onCanvas, designTemplate, printTemplate)
    mapped = nudgeShippingPrintYUp(scaled, printTemplate)
  } else {
    mapped = onCanvas
  }

  return clampWithinFace(mapped, face)
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

/** DYMO vertical alignment for studio text (wrap + shrink like the canvas). */
export function studioPrintVerticalAlignment(align: LabelStudioTextElement['align']): string {
  return align === 'Center' ? 'Middle' : 'Top'
}

export function previewMaxFontSizePx(
  el: LabelStudioTextElement,
  printableAreaHeightPx: number,
  template: DymoPaperTemplate
): number {
  const studioH = studioBoundsHeightTwips(template)
  const boxHeightTwips = (el.heightPct / 100) * studioH
  const boxHeightPx = Math.max(8, (el.heightPct / 100) * printableAreaHeightPx)
  if (boxHeightPx <= 0 || boxHeightTwips <= 0) return Math.max(8, el.fontSize * 0.75)
  const px = (el.fontSize * LABEL_TWIPS_PER_PT * boxHeightPx) / boxHeightTwips
  return Math.max(6, Math.floor(px))
}
