import { poInnerBoundsForTemplate, type DymoPaperTemplate } from './dymoLabelXml'
import type { ThermalImageProcessOptions } from './labelStudioThermalImage'
import type { LabelStudioElement, LabelStudioTextElement, LabelStudioTextFitMode } from '../types/labelStudio'

/** Twips per point (1440 twips/in ÷ 72 pt/in). */
export const LABEL_TWIPS_PER_PT = 20

/** Keep canvas/print preview content inside the dashed element border. */
export const LABEL_STUDIO_CONTENT_INSET_PX = 6

/** Bumped when print mapping changes — shown after print so you can confirm the loaded app. */
export const LABEL_STUDIO_PRINT_GEOMETRY_REV = 58

/** @deprecated Durable uses WYSIWYG raster print — native TextObject no longer needs a fudge factor. */
export const DURABLE_STUDIO_TEXT_PRINT_SCALE = 1

/** QR square fills this fraction of the barcode element box (canvas CSS + print bounds). */
export const STUDIO_QR_GRAPHIC_FILL_FRAC = 0.92

/** Rolls that map designer % on the catalog face (same grid as the Label Studio canvas). */
const STUDIO_FACE_PRINT_TEMPLATE_IDS = new Set([
  'Shipping',
  'Durable1933085',
  'Address30251',
])

function usesStudioFacePrint(template: DymoPaperTemplate): boolean {
  return STUDIO_FACE_PRINT_TEMPLATE_IDS.has(template.id)
}

export type DymoLabelBounds = { x: number; y: number; width: number; height: number }

export type StudioPrintBoundsOptions = {
  /** Catalog template used by the designer canvas (30323 face). */
  designTemplate?: DymoPaperTemplate
  /** @deprecated Unused — kept for call-site compatibility. */
  catalogTwips?: boolean
  /** Optional thermal tuning for embedded product images. */
  thermalImage?: ThermalImageProcessOptions
}

/** Full catalog printable face — matches the Label Studio canvas (102×59 mm on 30323). */
export function studioPrintFaceBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }
}

function studioFaceBounds(template: DymoPaperTemplate): DymoLabelBounds {
  return studioPrintFaceBounds(template)
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

/** Map bounds from designer roll face → accepted print envelope (e.g. PO inner band). */
function scaleBoundsBetweenFaces(
  bounds: DymoLabelBounds,
  fromFace: DymoLabelBounds,
  toFace: DymoLabelBounds
): DymoLabelBounds {
  const scaleX = toFace.width / fromFace.width
  const scaleY = toFace.height / fromFace.height
  return {
    x: toFace.x + Math.round((bounds.x - fromFace.x) * scaleX),
    y: toFace.y + Math.round((bounds.y - fromFace.y) * scaleY),
    width: Math.max(80, Math.round(bounds.width * scaleX)),
    height: Math.max(60, Math.round(bounds.height * scaleY)),
  }
}

/** Same printable face twips — canvas % map 1:1 (durable hybrid on 30330 PaperName). */
function studioFaceLayoutsMatch(design: DymoPaperTemplate, print: DymoPaperTemplate): boolean {
  const d = studioFaceBounds(design)
  const p = studioFaceBounds(print)
  return d.x === p.x && d.y === p.y && d.width === p.width && d.height === p.height
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

/** Map scaled print twips → pixels on a face bitmap (0,0 = top-left of printable face). */
export function twipsBoundsToFacePixels(
  bounds: DymoLabelBounds,
  face: DymoLabelBounds,
  facePixelWidth: number,
  facePixelHeight: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.max(0, Math.round(((bounds.x - face.x) / face.width) * facePixelWidth)),
    y: Math.max(0, Math.round(((bounds.y - face.y) / face.height) * facePixelHeight)),
    w: Math.max(1, Math.round((bounds.width / face.width) * facePixelWidth)),
    h: Math.max(1, Math.round((bounds.height / face.height) * facePixelHeight)),
  }
}

/** Map studio 0–100% to DYMO object bounds for print XML. */
export function pctToDymoPrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  printTemplate: DymoPaperTemplate,
  options?: StudioPrintBoundsOptions
): DymoLabelBounds {
  const designTemplate = options?.designTemplate ?? printTemplate
  if (!usesStudioFacePrint(designTemplate)) {
    return pctToStudioPrintBounds(el, printTemplate)
  }

  const printFace = studioFaceBounds(printTemplate)
  const onDesign = pctToCanvasFaceBounds(el, designTemplate)
  if (designTemplate.id === printTemplate.id) {
    return clampWithinFace(onDesign, printFace)
  }
  const bounds = studioFaceLayoutsMatch(designTemplate, printTemplate)
    ? onDesign
    : scaleBoundsBetweenFaces(onDesign, studioFaceBounds(designTemplate), printFace)
  return clampWithinFace(bounds, printFace)
}

/** @deprecated Images use durable-native bounds like text (see fetchProductImagePngBase64). */
export function studioDurableImagePrintBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  designTemplate: DymoPaperTemplate,
  gpdTemplate: DymoPaperTemplate
): DymoLabelBounds {
  return pctToDymoPrintBounds(el, gpdTemplate, { designTemplate })
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

/** Scale designer fontSize when the print box is smaller than the canvas box. */
export function studioPrintTextFontSizeForElement(
  el: Pick<LabelStudioTextElement, 'fontSize' | 'heightPct'>,
  bounds: DymoLabelBounds,
  designTemplate: DymoPaperTemplate | undefined,
  printTemplate: DymoPaperTemplate,
  lineCount: number,
  textFitMode: LabelStudioTextFitMode | undefined
): number {
  const fit = studioPrintTextFitMode(textFitMode, designTemplate, printTemplate)
  let fontSize = el.fontSize
  if (designTemplate && designTemplate.id !== printTemplate.id) {
    const designBoxH = (el.heightPct / 100) * studioFaceBounds(designTemplate).height
    if (designBoxH > 0 && bounds.height > 0 && Math.abs(designBoxH - bounds.height) > 8) {
      fontSize = Math.max(8, Math.round((el.fontSize * bounds.height) / designBoxH))
    }
  }
  if (fit === 'ShrinkToFit') {
    if (designTemplate?.id === 'Durable1933085') {
      fontSize = Math.max(8, Math.round(fontSize * DURABLE_STUDIO_TEXT_PRINT_SCALE))
    }
    return fontSize
  }
  return studioPrintTextFontSizePt(fontSize, lineCount, bounds.height, fit)
}

/** When printing on a proxy envelope, always shrink text like the canvas preview. */
export function studioPrintTextFitMode(
  textFitMode: LabelStudioTextFitMode | undefined,
  designTemplate: DymoPaperTemplate | undefined,
  printTemplate: DymoPaperTemplate
): LabelStudioTextFitMode {
  if (designTemplate && designTemplate.id !== printTemplate.id) return 'ShrinkToFit'
  return textFitMode ?? 'ShrinkToFit'
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
