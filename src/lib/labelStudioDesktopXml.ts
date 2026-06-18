import { escapeXmlText, DYMO_PAPER_TEMPLATES } from './dymoLabelXml'
import { barcodeTextForPrint, resolveBarcodeType } from './labelStudioBarcode'
import { fetchConnectElementImagePngBase64 } from './labelStudioImage'
import { mergedBarcodePayloadForElement, mergedImageUrlForElement, mergedLinesForElement } from './labelStudioMerge'
import { qrPngBase64ForPrint } from './labelStudioQr'
import { STUDIO_QR_GRAPHIC_FILL_FRAC, studioPreviewFontScale, type StudioPrintBoundsOptions } from './labelStudioGeometry'
import type {
  LabelStudioElement,
  LabelStudioItem,
  LabelStudioTemplate,
  LabelStudioTextElement,
} from '../types/labelStudio'
import { isBarcodeElement, isImageElement, isTextElement, paperTemplateById } from '../types/labelStudio'

/** Working DYMO Connect export for 1933085 Drbl — printable face in inches. */
export const DURABLE_CONNECT_LABEL_NAME = '1933085 Drbl 3/4 x 2-1/2 in'

/** DYMORect from Connect — label metadata only (not the canvas % origin). */
export const DURABLE_CONNECT_FACE_IN = {
  x: 0.22666666,
  y: 0.056666665,
  width: 2.2133334,
  height: 0.6533333,
} as const

/** Full die-cut label (2.5″ × 0.75″ landscape) — matches Label Studio canvas 0–100% grid. */
export const DURABLE_CONNECT_DRAW_IN = {
  width: 2.5,
  height: 0.75,
} as const

/** Tame AlwaysFit text — printable face is shorter than full draw height. */
const DURABLE_PRINT_FONT_SCALE = studioPreviewFontScale(
  paperTemplateById('Durable1933085', DYMO_PAPER_TEMPLATES)
)

function connectQrInches(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>
): { x: number; y: number; width: number; height: number } {
  const box = pctToConnectInches(el)
  let side = Math.min(box.width, box.height) * STUDIO_QR_GRAPHIC_FILL_FRAC
  side = Math.max(0.08, side)
  return {
    x: box.x + (box.width - side) / 2,
    y: box.y + (box.height - side) / 2,
    width: side,
    height: side,
  }
}

function inchStr(n: number): string {
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

/** Canvas % → inches on full draw (same grid as Label Studio preview). */
function pctToConnectInches(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  draw = DURABLE_CONNECT_DRAW_IN
): { x: number; y: number; width: number; height: number } {
  return {
    x: (el.xPct / 100) * draw.width,
    y: (el.yPct / 100) * draw.height,
    width: (el.widthPct / 100) * draw.width,
    height: (el.heightPct / 100) * draw.height,
  }
}

function solidBrushXml(): string {
  return (
    `<BackgroundBrush><SolidColorBrush><Color A="0" R="0" G="0" B="0"></Color></SolidColorBrush></BackgroundBrush>` +
    `<BorderBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></BorderBrush>` +
    `<StrokeBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></StrokeBrush>` +
    `<FillBrush><SolidColorBrush><Color A="0" R="0" G="0" B="0"></Color></SolidColorBrush></FillBrush>`
  )
}

function objectLayoutXml(box: { x: number; y: number; width: number; height: number }): string {
  return (
    `<ObjectLayout>` +
    `<DYMOPoint><X>${inchStr(box.x)}</X><Y>${inchStr(box.y)}</Y></DYMOPoint>` +
    `<Size><Width>${inchStr(box.width)}</Width><Height>${inchStr(box.height)}</Height></Size>` +
    `</ObjectLayout>`
  )
}

function connectHorizontalAlignment(align: LabelStudioTextElement['align']): string {
  return align === 'Right' ? 'Right' : align === 'Left' ? 'Left' : 'Center'
}

function buildConnectTextObjectXml(el: LabelStudioTextElement, item: LabelStudioItem): string {
  const lines = mergedLinesForElement(el.content, item)
  if (lines.length === 0) return ''
  const box = pctToConnectInches(el)
  const text = lines.map(escapeXmlText).join('\n')
  const align = connectHorizontalAlignment(el.align)
  const bold = el.bold ? 'True' : 'False'
  const fontSize = Math.max(8, Math.round(el.fontSize * DURABLE_PRINT_FONT_SCALE))

  return (
    `<TextObject>` +
    `<Name>${escapeXmlText(el.name || el.id)}</Name>` +
    `<Brushes>${solidBrushXml()}</Brushes>` +
    `<Rotation>Rotation0</Rotation>` +
    `<OutlineThickness>1</OutlineThickness>` +
    `<IsOutlined>False</IsOutlined>` +
    `<BorderStyle>SolidLine</BorderStyle>` +
    `<Margin><DYMOThickness Left="0" Top="0" Right="0" Bottom="0" /></Margin>` +
    `<HorizontalAlignment>${align}</HorizontalAlignment>` +
    `<VerticalAlignment>Middle</VerticalAlignment>` +
    `<FitMode>AlwaysFit</FitMode>` +
    `<IsVertical>False</IsVertical>` +
    `<FormattedText>` +
    `<FitMode>AlwaysFit</FitMode>` +
    `<HorizontalAlignment>${align}</HorizontalAlignment>` +
    `<VerticalAlignment>Middle</VerticalAlignment>` +
    `<IsVertical>False</IsVertical>` +
    `<LineTextSpan>` +
    `<TextSpan>` +
    `<Text>${text}</Text>` +
    `<FontInfo>` +
    `<FontName>Arial</FontName>` +
    `<FontSize>${fontSize}</FontSize>` +
    `<IsBold>${bold}</IsBold>` +
    `<IsItalic>False</IsItalic>` +
    `<IsUnderline>False</IsUnderline>` +
    `<FontBrush><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></FontBrush>` +
    `</FontInfo>` +
    `</TextSpan>` +
    `</LineTextSpan>` +
    `</FormattedText>` +
    objectLayoutXml(box) +
    `</TextObject>`
  )
}

async function buildConnectImageObjectXml(
  el: LabelStudioElement,
  item: LabelStudioItem,
  options?: StudioPrintBoundsOptions
): Promise<string> {
  if (!isImageElement(el)) return ''
  const url = mergedImageUrlForElement(el.content, item)
  if (!url) return ''
  const box = pctToConnectInches(el)
  const scaleMode = el.scaleMode ?? 'Uniform'
  const png = await fetchConnectElementImagePngBase64(url, options?.thermalImage)
  if (!png) return ''

  const dymoFill = scaleMode === 'Fill'

  return (
    `<ImageObject>` +
    `<Name>${escapeXmlText(el.name || el.id)}</Name>` +
    `<Brushes>${solidBrushXml()}</Brushes>` +
    `<Rotation>Rotation0</Rotation>` +
    `<OutlineThickness>1</OutlineThickness>` +
    `<IsOutlined>False</IsOutlined>` +
    `<BorderStyle>SolidLine</BorderStyle>` +
    `<Margin><DYMOThickness Left="0" Top="0" Right="0" Bottom="0" /></Margin>` +
    `<Data>${png}</Data>` +
    `<ScaleMode>${dymoFill ? 'Fill' : 'Uniform'}</ScaleMode>` +
    `<HorizontalAlignment>${dymoFill ? 'Left' : 'Center'}</HorizontalAlignment>` +
    `<VerticalAlignment>${dymoFill ? 'Top' : 'Middle'}</VerticalAlignment>` +
    objectLayoutXml(box) +
    `</ImageObject>`
  )
}

async function buildConnectBarcodeObjectXml(
  el: LabelStudioElement,
  item: LabelStudioItem
): Promise<string> {
  if (!isBarcodeElement(el)) return ''
  const value = mergedBarcodePayloadForElement(el.content, item, el.barcodeType)
  if (!value) return ''
  const symbology = resolveBarcodeType(el.barcodeType, value)
  if (symbology !== 'QrCode') return ''
  const encoded = barcodeTextForPrint(value, symbology)
  if (!encoded) return ''
  const box = connectQrInches(el)
  const sideTwips = Math.max(80, Math.round(Math.min(box.width, box.height) * 1440))
  const png = await qrPngBase64ForPrint(encoded, sideTwips)
  if (!png) return ''

  return (
    `<ImageObject>` +
    `<Name>${escapeXmlText(el.name || el.id)}</Name>` +
    `<Brushes>${solidBrushXml()}</Brushes>` +
    `<Rotation>Rotation0</Rotation>` +
    `<OutlineThickness>1</OutlineThickness>` +
    `<IsOutlined>False</IsOutlined>` +
    `<BorderStyle>SolidLine</BorderStyle>` +
    `<Margin><DYMOThickness Left="0" Top="0" Right="0" Bottom="0" /></Margin>` +
    `<Data>${png}</Data>` +
    `<ScaleMode>Fill</ScaleMode>` +
    `<HorizontalAlignment>Left</HorizontalAlignment>` +
    `<VerticalAlignment>Top</VerticalAlignment>` +
    objectLayoutXml(box) +
    `</ImageObject>`
  )
}

/** DYMO Connect DesktopLabel XML — same schema as a label designed in Connect. */
export async function buildDesktopLabelXmlFromStudioForPrint(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  buildOptions?: StudioPrintBoundsOptions
): Promise<string> {
  const face = DURABLE_CONNECT_FACE_IN
  const textParts = template.elements
    .filter(isTextElement)
    .map((el) => buildConnectTextObjectXml(el, item))
    .filter(Boolean)
  const imageParts = await Promise.all(
    template.elements.filter(isImageElement).map((el) => buildConnectImageObjectXml(el, item, buildOptions))
  )
  const barcodeParts = await Promise.all(
    template.elements.filter(isBarcodeElement).map((el) => buildConnectBarcodeObjectXml(el, item))
  )
  const objects = [...textParts, ...barcodeParts.filter(Boolean), ...imageParts.filter(Boolean)].join('')

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DesktopLabel Version="1">` +
    `<DYMOLabel Version="4">` +
    `<Description>DYMO Label</Description>` +
    `<Orientation>Landscape</Orientation>` +
    `<LabelName>${escapeXmlText(DURABLE_CONNECT_LABEL_NAME)}</LabelName>` +
    `<InitialLength>0</InitialLength>` +
    `<BorderStyle>SolidLine</BorderStyle>` +
    `<DYMORect>` +
    `<DYMOPoint><X>${inchStr(face.x)}</X><Y>${inchStr(face.y)}</Y></DYMOPoint>` +
    `<Size><Width>${inchStr(face.width)}</Width><Height>${inchStr(face.height)}</Height></Size>` +
    `</DYMORect>` +
    `<BorderColor><SolidColorBrush><Color A="1" R="0" G="0" B="0"></Color></SolidColorBrush></BorderColor>` +
    `<BorderThickness>1</BorderThickness>` +
    `<Show_Border>False</Show_Border>` +
    `<HasFixedLength>False</HasFixedLength>` +
    `<FixedLengthValue>0</FixedLengthValue>` +
    `<DynamicLayoutManager>` +
    `<RotationBehavior>ClearObjects</RotationBehavior>` +
    `<LabelObjects>${objects}</LabelObjects>` +
    `</DynamicLayoutManager>` +
    `</DYMOLabel>` +
    `<LabelApplication>Blank</LabelApplication>` +
    `<DataTable><Columns></Columns><Rows></Rows></DataTable>` +
    `</DesktopLabel>`
  )
}
