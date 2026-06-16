import type { DymoPaperTemplate } from '../lib/dymoLabelXml'

export type LabelStudioTextAlign = 'Left' | 'Center' | 'Right'
/** Like DYMO / Label Live “Shrink to fit” vs fixed font size. */
export type LabelStudioTextFitMode = 'ShrinkToFit' | 'None'

export type LabelStudioBarcodeType =
  | 'Auto'
  | 'Code128Auto'
  | 'UpcA'
  | 'Ean13'
  | 'Code39'
  | 'QrCode'

export type LabelStudioBarcodeSize = 'Small' | 'Medium' | 'Large' | 'ExtraLarge'
export type LabelStudioBarcodeTextPosition = 'None' | 'Bottom' | 'Top'

type LabelStudioElementBase = {
  id: string
  name: string
  /** Merge template, e.g. `{{barcode}}` */
  content: string
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export type LabelStudioTextElement = LabelStudioElementBase & {
  kind: 'text'
  fontSize: number
  bold: boolean
  align: LabelStudioTextAlign
  textFitMode: LabelStudioTextFitMode
}

export type LabelStudioBarcodeElement = LabelStudioElementBase & {
  kind: 'barcode'
  barcodeType: LabelStudioBarcodeType
  size: LabelStudioBarcodeSize
  textPosition: LabelStudioBarcodeTextPosition
  /** Human-readable caption under/above barcode (pt); used when textPosition is not None. */
  textFontSize?: number
}

export type LabelStudioImageScaleMode = 'Uniform' | 'Fill'

export type LabelStudioImageElement = LabelStudioElementBase & {
  kind: 'image'
  scaleMode: LabelStudioImageScaleMode
}

export type LabelStudioElement =
  | LabelStudioTextElement
  | LabelStudioBarcodeElement
  | LabelStudioImageElement

/** @deprecated Saved templates may omit `kind`; normalized on load. */
export type LegacyLabelStudioElement = Omit<LabelStudioTextElement, 'kind' | 'textFitMode'> & {
  kind?: string
  textFitMode?: LabelStudioTextFitMode
}

export type LabelStudioTemplate = {
  id: string
  name: string
  paperTemplateId: string
  elements: LabelStudioElement[]
  updatedAt: string
}

export type LabelStudioItemSource =
  | 'items'
  | 'location'
  | 'barcode'
  | 'po_line'
  | 'excel'

/** Flat merge-field record for one printable item. */
export type LabelStudioItem = {
  id: string
  source: LabelStudioItemSource
  title: string
  fields: Record<string, string>
}

/** Merge fields shown in Label Studio — matches inventory picker columns only. */
export const LABEL_STUDIO_MERGE_FIELDS: { key: string; label: string; example: string }[] = [
  { key: 'item', label: 'Item name', example: 'HDMI Cable 6ft' },
  { key: 'part_number', label: 'Part number', example: 'ABC-123' },
  { key: 'manufacturer', label: 'Manufacturer', example: 'Lutron' },
  { key: 'barcode', label: 'Barcode', example: '012345678901' },
  { key: 'url', label: 'URL', example: 'https://example.com/product' },
  { key: 'picture', label: 'Product image', example: '(image on label)' },
]

export const DEFAULT_PAPER_TEMPLATE_ID = 'Shipping'

/** Unsaved working template (not in localStorage until Save). */
export function createBlankLabelStudioTemplate(): LabelStudioTemplate {
  return {
    id: `draft-${Date.now().toString(36)}`,
    name: 'Untitled template',
    paperTemplateId: DEFAULT_PAPER_TEMPLATE_ID,
    elements: [],
    updatedAt: new Date().toISOString(),
  }
}

export function createElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function isBarcodeElement(el: LabelStudioElement): el is LabelStudioBarcodeElement {
  return el.kind === 'barcode'
}

export function isTextElement(el: LabelStudioElement): el is LabelStudioTextElement {
  return el.kind === 'text'
}

export function isImageElement(el: LabelStudioElement): el is LabelStudioImageElement {
  return el.kind === 'image'
}

/** Upgrade templates saved before barcode support. */
export function normalizeStudioElement(raw: LegacyLabelStudioElement | LabelStudioElement): LabelStudioElement {
  if (raw.kind === 'barcode') {
    const b = raw as LabelStudioBarcodeElement
    return {
      ...b,
      textFontSize: b.textFontSize ?? 10,
      size: b.size ?? 'Medium',
    }
  }
  if (raw.kind === 'image') return raw as LabelStudioImageElement
  if (raw.kind === 'text') return raw as LabelStudioTextElement
  const legacy = raw as LegacyLabelStudioElement
  return {
    kind: 'text',
    id: legacy.id,
    name: legacy.name,
    content: legacy.content,
    xPct: legacy.xPct,
    yPct: legacy.yPct,
    widthPct: legacy.widthPct,
    heightPct: legacy.heightPct,
    fontSize: legacy.fontSize ?? 18,
    bold: legacy.bold ?? true,
    align: legacy.align ?? 'Center',
    textFitMode: legacy.textFitMode ?? 'ShrinkToFit',
  }
}

export function normalizeStudioTemplate(t: LabelStudioTemplate): LabelStudioTemplate {
  return {
    ...t,
    elements: t.elements.map((el) => normalizeStudioElement(el as LegacyLabelStudioElement)),
  }
}

export function defaultShippingTemplate(): LabelStudioTemplate {
  const now = new Date().toISOString()
  return {
    id: 'preset-shipping',
    name: 'Job + location (30323)',
    paperTemplateId: DEFAULT_PAPER_TEMPLATE_ID,
    updatedAt: now,
    elements: [
      {
        kind: 'text',
        id: createElementId(),
        name: 'JOB',
        content: '{{job}}\n{{item}}',
        xPct: 4,
        yPct: 6,
        widthPct: 92,
        heightPct: 52,
        fontSize: 22,
        bold: true,
        align: 'Center',
        textFitMode: 'ShrinkToFit',
      },
      {
        kind: 'text',
        id: createElementId(),
        name: 'LOC',
        content: '{{location}}',
        xPct: 4,
        yPct: 58,
        widthPct: 92,
        heightPct: 36,
        fontSize: 16,
        bold: true,
        align: 'Center',
        textFitMode: 'ShrinkToFit',
      },
    ],
  }
}

export function defaultInventoryTemplate(): LabelStudioTemplate {
  const now = new Date().toISOString()
  return {
    id: 'preset-inventory',
    name: 'Item + scannable barcode',
    paperTemplateId: DEFAULT_PAPER_TEMPLATE_ID,
    updatedAt: now,
    elements: [
      {
        kind: 'image',
        id: createElementId(),
        name: 'PICTURE',
        content: '{{picture}}',
        xPct: 4,
        yPct: 6,
        widthPct: 28,
        heightPct: 88,
        scaleMode: 'Uniform',
      },
      {
        kind: 'text',
        id: createElementId(),
        name: 'ITEM',
        content: '{{item}}',
        xPct: 34,
        yPct: 6,
        widthPct: 62,
        heightPct: 38,
        fontSize: 20,
        bold: true,
        align: 'Center',
        textFitMode: 'ShrinkToFit',
      },
      {
        kind: 'text',
        id: createElementId(),
        name: 'PART',
        content: '{{part_number}}',
        xPct: 34,
        yPct: 44,
        widthPct: 62,
        heightPct: 16,
        fontSize: 13,
        bold: false,
        align: 'Center',
        textFitMode: 'ShrinkToFit',
      },
      {
        kind: 'barcode',
        id: createElementId(),
        name: 'BARCODE',
        content: '{{barcode}}',
        xPct: 34,
        yPct: 62,
        widthPct: 62,
        heightPct: 34,
        barcodeType: 'Auto',
        size: 'Small',
        textPosition: 'Bottom',
        textFontSize: 10,
      },
    ],
  }
}

export function paperTemplateById(
  id: string,
  templates: readonly DymoPaperTemplate[]
): DymoPaperTemplate {
  const resolvedId = id === 'Address' ? 'Address30251' : id
  return (
    templates.find((t) => t.id === resolvedId) ??
    templates.find((t) => t.id === 'Shipping') ??
    templates[0]
  )
}
