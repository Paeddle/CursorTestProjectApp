import { escapeXmlText } from './dymoLabelXml'
import { fetchUrlAsPngBase64 } from './labelStudioImage'
import { mergedImageUrlForElement, mergedLinesForElement } from './labelStudioMerge'
import type { StudioPrintBoundsOptions } from './labelStudioGeometry'
import type {
  LabelStudioElement,
  LabelStudioItem,
  LabelStudioTemplate,
  LabelStudioTextElement,
} from '../types/labelStudio'
import { isImageElement, isTextElement } from '../types/labelStudio'

/** Working DYMO Connect export for 1933085 Drbl — printable face in inches. */
export const DURABLE_CONNECT_LABEL_NAME = '1933085 Drbl 3/4 x 2-1/2 in'

export const DURABLE_CONNECT_FACE_IN = {
  x: 0.22666666,
  y: 0.056666665,
  width: 2.2133334,
  height: 0.6533333,
} as const

function inchStr(n: number): string {
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

function pctToConnectInches(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  face = DURABLE_CONNECT_FACE_IN
): { x: number; y: number; width: number; height: number } {
  return {
    x: face.x + (el.xPct / 100) * face.width,
    y: face.y + (el.yPct / 100) * face.height,
    width: (el.widthPct / 100) * face.width,
    height: (el.heightPct / 100) * face.height,
  }
}

function connectTwipsFromInches(sideIn: number): number {
  return Math.max(80, Math.round(sideIn * 1440))
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
  const fontSize = Math.max(8, el.fontSize)

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
  const boundsTwips = {
    width: connectTwipsFromInches(box.width),
    height: connectTwipsFromInches(box.height),
  }
  const png = await fetchUrlAsPngBase64(
    url,
    boundsTwips,
    options?.thermalImage,
    el.scaleMode ?? 'Uniform'
  )
  if (!png) return ''

  const scaleMode = el.scaleMode === 'Fill' ? 'Fill' : 'Uniform'

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
    `<ScaleMode>${scaleMode}</ScaleMode>` +
    `<HorizontalAlignment>Center</HorizontalAlignment>` +
    `<VerticalAlignment>Middle</VerticalAlignment>` +
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
  const objects = [...textParts, ...imageParts.filter(Boolean)].join('')

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
