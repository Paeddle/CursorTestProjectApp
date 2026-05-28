import type { DymoPaperTemplate } from '../lib/dymoLabelXml'

export type LabelStudioTextAlign = 'Left' | 'Center' | 'Right'

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
}

export type LabelStudioBarcodeElement = LabelStudioElementBase & {
  kind: 'barcode'
  barcodeType: LabelStudioBarcodeType
  size: LabelStudioBarcodeSize
  textPosition: LabelStudioBarcodeTextPosition
}

export type LabelStudioElement = LabelStudioTextElement | LabelStudioBarcodeElement

/** @deprecated Saved templates may omit `kind`; normalized on load. */
export type LegacyLabelStudioElement = Omit<LabelStudioTextElement, 'kind'> & { kind?: string }

export type LabelStudioTemplate = {
  id: string
  name: string
  paperTemplateId: string
  elements: LabelStudioElement[]
  updatedAt: string
}

export type LabelStudioItemSource =
  | 'inventory'
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

export const LABEL_STUDIO_MERGE_FIELDS: { key: string; label: string; example: string }[] = [
  { key: 'item', label: 'Item name', example: 'HDMI Cable 6ft' },
  { key: 'part_number', label: 'Part number', example: 'ABC-123' },
  { key: 'manufacturer', label: 'Manufacturer', example: 'Lutron' },
  { key: 'barcode', label: 'Barcode', example: '012345678901' },
  { key: 'description', label: 'Description', example: 'Customer description' },
  { key: 'category', label: 'Category', example: 'Wire' },
  { key: 'vendor', label: 'Vendor', example: 'ADI' },
  { key: 'location', label: 'Location / room', example: 'Master BR Closet' },
  { key: 'job', label: 'Job / customer', example: 'Smith Residence' },
  { key: 'po_number', label: 'PO number', example: 'PO-4152' },
  { key: 'ref_number', label: 'Job ref #', example: '4152' },
  { key: 'quantity', label: 'Quantity', example: '4' },
  { key: 'price', label: 'Unit price', example: '12.99' },
  { key: 'color', label: 'Color', example: 'White' },
  { key: 'unit', label: 'Unit', example: 'EA' },
]

export const DEFAULT_PAPER_TEMPLATE_ID = 'Shipping'

export function createElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function isBarcodeElement(el: LabelStudioElement): el is LabelStudioBarcodeElement {
  return el.kind === 'barcode'
}

export function isTextElement(el: LabelStudioElement): el is LabelStudioTextElement {
  return el.kind === 'text'
}

/** Upgrade templates saved before barcode support. */
export function normalizeStudioElement(raw: LegacyLabelStudioElement | LabelStudioElement): LabelStudioElement {
  if (raw.kind === 'barcode') return raw as LabelStudioBarcodeElement
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
        kind: 'text',
        id: createElementId(),
        name: 'ITEM',
        content: '{{item}}',
        xPct: 4,
        yPct: 6,
        widthPct: 92,
        heightPct: 38,
        fontSize: 20,
        bold: true,
        align: 'Center',
      },
      {
        kind: 'text',
        id: createElementId(),
        name: 'PART',
        content: '{{part_number}}',
        xPct: 4,
        yPct: 44,
        widthPct: 92,
        heightPct: 16,
        fontSize: 13,
        bold: false,
        align: 'Center',
      },
      {
        kind: 'barcode',
        id: createElementId(),
        name: 'BARCODE',
        content: '{{barcode}}',
        xPct: 8,
        yPct: 62,
        widthPct: 84,
        heightPct: 34,
        barcodeType: 'Auto',
        size: 'Medium',
        textPosition: 'Bottom',
      },
    ],
  }
}

export function paperTemplateById(
  id: string,
  templates: readonly DymoPaperTemplate[]
): DymoPaperTemplate {
  return templates.find((t) => t.id === id) ?? templates[0]
}
