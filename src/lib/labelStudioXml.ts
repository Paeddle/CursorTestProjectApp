import {
  DYMO_PAPER_TEMPLATES,
  dymoTemplateForStudioPrint,
  escapeXmlText,
  type DymoPaperTemplate,
} from './dymoLabelXml'
import {
  barcodeTextForPrint,
  dymoBarcodeSizeForStudioPrint,
  dymoBarcodeSymbologyXml,
  resolveBarcodeType,
} from './labelStudioBarcode'
import { barcodeCaptionFontPt, splitBarcodeElementBounds } from './labelStudioBarcodeLayout'
import { fetchUrlAsPngBase64 } from './labelStudioImage'
import { mergedBarcodeForElement, mergedImageUrlForElement, mergedLinesForElement } from './labelStudioMerge'
import type {
  LabelStudioBarcodeElement,
  LabelStudioElement,
  LabelStudioImageElement,
  LabelStudioItem,
  LabelStudioTemplate,
  LabelStudioTextElement,
} from '../types/labelStudio'
import {
  pctToDymoPrintBounds,
  studioPrintTextFontSizePt,
  shippingQrPrintBounds,
  studioPrintTextFontBoxTwips,
  type DymoLabelBounds,
  type StudioPrintBoundsOptions,
} from './labelStudioGeometry'
import { isBarcodeElement, isImageElement, isTextElement, paperTemplateById } from '../types/labelStudio'

function fontAttributesXml(fontSize: number, bold: boolean): string {
  const b = bold ? 'True' : 'False'
  return (
    `<Font Family="Arial" Size="${fontSize}" Bold="${b}" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>`
  )
}

function buildStyledTextBlockXml(lines: string[], fontSize: number, bold: boolean): string {
  const attrs = fontAttributesXml(fontSize, bold)
  const block = (lines.length > 0 ? lines : ['']).map(escapeXmlText).join('\n')
  return `<Element><String>${block}</String><Attributes>${attrs}</Attributes></Element>`
}

function studioPrintEnvelope(
  designPaper: DymoPaperTemplate
): { designTemplate: DymoPaperTemplate; printTemplate: DymoPaperTemplate; printOptions: StudioPrintBoundsOptions } {
  const printTemplate = dymoTemplateForStudioPrint(designPaper)
  return { designTemplate: designPaper, printTemplate, printOptions: { designTemplate: designPaper } }
}

function studioDieCutXml(
  template: DymoPaperTemplate,
  objectXml: string,
  _options?: StudioPrintBoundsOptions
): string {
  const t = template
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation>` +
    `<Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands>` +
    `<RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/>` +
    `</DrawCommands>` +
    objectXml +
    `</DieCutLabel>`
  )
}

function buildTextObjectXml(
  objectName: string,
  lines: string[],
  fontSize: number,
  bounds: DymoLabelBounds,
  paper: DymoPaperTemplate,
  options: {
    align: LabelStudioTextElement['align']
    bold: boolean
    textFitMode: LabelStudioTextElement['textFitMode']
  }
): string {
  const fontBoxTwips = studioPrintTextFontBoxTwips(bounds, paper)
  const fitMode = options.textFitMode === 'None' ? 'None' : 'ShrinkToFit'
  const pt = studioPrintTextFontSizePt(
    fontSize,
    Math.max(1, lines.length),
    fontBoxTwips,
    fitMode
  )
  const dymoFitMode = fitMode
  const styled = buildStyledTextBlockXml(lines, pt, options.bold)
  return (
    `<ObjectInfo>` +
    `<TextObject>` +
    `<Name>${escapeXmlText(objectName)}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName>` +
    `<Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored>` +
    `<IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>${options.align}</HorizontalAlignment>` +
    `<VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>${dymoFitMode}</TextFitMode>` +
    `<UseFullFontHeight>False</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized>` +
    `<StyledText>${styled}</StyledText>` +
    `</TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/>` +
    `</ObjectInfo>`
  )
}

function buildBarcodeObjectXml(
  el: LabelStudioBarcodeElement,
  encoded: string,
  symbology: Exclude<LabelStudioBarcodeElement['barcodeType'], 'Auto'>,
  bounds: DymoLabelBounds,
  paper: DymoPaperTemplate
): string {
  const dymoType = dymoBarcodeSymbologyXml(symbology)
  const dymoSize = dymoBarcodeSizeForStudioPrint(bounds, symbology, el.size, paper.id)

  return (
    `<ObjectInfo>` +
    `<BarcodeObject>` +
    `<Name>${escapeXmlText(el.name || el.id)}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName>` +
    `<Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored>` +
    `<IsVariable>False</IsVariable>` +
    `<Text>${escapeXmlText(encoded)}</Text>` +
    `<Type>${dymoType}</Type>` +
    `<Size>${dymoSize}</Size>` +
    `<TextPosition>None</TextPosition>` +
    `<TextFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<CheckSumFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False"/>` +
    `<TextEmbedding>None</TextEmbedding>` +
    `<ECLevel>0</ECLevel>` +
    `<HorizontalAlignment>Center</HorizontalAlignment>` +
    `<QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0"/>` +
    `</BarcodeObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/>` +
    `</ObjectInfo>`
  )
}

/** Barcode symbology + optional human-readable caption as a separate TextObject (reliable for QR). */
function buildBarcodePrintXml(
  el: LabelStudioBarcodeElement,
  displayText: string,
  bounds: DymoLabelBounds,
  paper: DymoPaperTemplate,
  printOptions?: StudioPrintBoundsOptions
): string {
  const symbology = resolveBarcodeType(el.barcodeType, displayText)
  const encoded = barcodeTextForPrint(displayText, symbology)
  if (!encoded) return ''

  const { barcode, caption } = splitBarcodeElementBounds(bounds, el.textPosition)
  const printBarcode =
    paper.id === 'Shipping' && symbology === 'QrCode'
      ? shippingQrPrintBounds(el, paper, printOptions)
      : barcode
  const barcodeXml = buildBarcodeObjectXml(el, encoded, symbology, printBarcode, paper)

  if (!caption || el.textPosition === 'None') return barcodeXml

  const captionXml = buildTextObjectXml(
    `${el.id}_caption`,
    [displayText],
    barcodeCaptionFontPt(caption),
    caption,
    paper,
    { align: 'Center', bold: false, textFitMode: 'None' }
  )
  return barcodeXml + captionXml
}

function buildImageObjectXml(
  el: LabelStudioImageElement,
  base64Png: string,
  bounds: DymoLabelBounds
): string {
  if (!base64Png) return ''
  return (
    `<ObjectInfo>` +
    `<ImageObject>` +
    `<Name>${escapeXmlText(el.name || el.id)}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName>` +
    `<Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored>` +
    `<IsVariable>False</IsVariable>` +
    `<ImageLocation/>` +
    `<Image>${base64Png}</Image>` +
    `<ScaleMode>${el.scaleMode ?? 'Uniform'}</ScaleMode>` +
    `<BorderWidth>0</BorderWidth>` +
    `<BorderColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<HorizontalAlignment>Center</HorizontalAlignment>` +
    `<VerticalAlignment>Center</VerticalAlignment>` +
    `</ImageObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/>` +
    `</ObjectInfo>`
  )
}

async function buildElementXmlAsync(
  el: LabelStudioElement,
  item: LabelStudioItem,
  template: DymoPaperTemplate,
  printOptions?: StudioPrintBoundsOptions
): Promise<string> {
  const bounds = pctToDymoPrintBounds(el, template, printOptions)
  if (isBarcodeElement(el)) {
    const value = mergedBarcodeForElement(el.content, item)
    return buildBarcodePrintXml(el, value, bounds, template, printOptions)
  }
  if (isImageElement(el)) {
    const imageUrl = mergedImageUrlForElement(el.content, item)
    if (!imageUrl) return ''
    const base64 = await fetchUrlAsPngBase64(imageUrl)
    if (!base64) return ''
    return buildImageObjectXml(el, base64, bounds)
  }
  if (isTextElement(el)) {
    const lines = mergedLinesForElement(el.content, item)
    if (lines.length === 0) return ''
    return buildTextObjectXml(el.name || el.id, lines, el.fontSize, bounds, template, {
      align: el.align,
      bold: el.bold,
      textFitMode: el.textFitMode ?? 'ShrinkToFit',
    })
  }
  return ''
}

function buildElementXml(
  el: LabelStudioElement,
  item: LabelStudioItem,
  template: DymoPaperTemplate,
  printOptions?: StudioPrintBoundsOptions
): string {
  const bounds = pctToDymoPrintBounds(el, template, printOptions)
  if (isBarcodeElement(el)) {
    const value = mergedBarcodeForElement(el.content, item)
    return buildBarcodePrintXml(el, value, bounds, template, printOptions)
  }
  if (isImageElement(el)) {
    return ''
  }
  if (isTextElement(el)) {
    const lines = mergedLinesForElement(el.content, item)
    if (lines.length === 0) return ''
    return buildTextObjectXml(el.name || el.id, lines, el.fontSize, bounds, template, {
      align: el.align,
      bold: el.bold,
      textFitMode: el.textFitMode ?? 'ShrinkToFit',
    })
  }
  return ''
}

export function buildLabelXmlFromStudio(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  paper?: DymoPaperTemplate,
  printOptions?: StudioPrintBoundsOptions
): string {
  const designPaper = paper ?? paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const envelope = studioPrintEnvelope(designPaper)
  const options = { ...envelope.printOptions, ...printOptions }
  const objects = template.elements
    .map((el) => buildElementXml(el, item, envelope.printTemplate, options))
    .filter(Boolean)

  if (objects.length === 0) {
    objects.push(
      buildTextObjectXml(
        'TEXT',
        ['(empty label)'],
        18,
        pctToDymoPrintBounds({ xPct: 4, yPct: 30, widthPct: 92, heightPct: 40 }, envelope.printTemplate, options),
        envelope.printTemplate,
        { align: 'Center', bold: true, textFitMode: 'ShrinkToFit' }
      )
    )
  }

  return studioDieCutXml(envelope.printTemplate, objects.join(''), options)
}

export function buildLabelXmlCandidatesFromStudio(
  template: LabelStudioTemplate,
  item: LabelStudioItem
): string[] {
  const preferred = paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const ordered = [
    preferred,
    ...DYMO_PAPER_TEMPLATES.filter((p) => p.id !== preferred.id),
  ]
  return ordered.map((paper) => buildLabelXmlFromStudio(template, item, paper))
}

/** Like buildLabelXmlFromStudio but embeds product images as base64 PNG for DYMO printing. */
export async function buildLabelXmlFromStudioForPrint(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  paper?: DymoPaperTemplate,
  printOptions?: StudioPrintBoundsOptions
): Promise<string> {
  const designPaper = paper ?? paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const envelope = studioPrintEnvelope(designPaper)
  const options = { ...envelope.printOptions, ...printOptions }
  const objectParts = await Promise.all(
    template.elements.map((el) => buildElementXmlAsync(el, item, envelope.printTemplate, options))
  )
  const objects = objectParts.filter(Boolean)

  if (objects.length === 0) {
    objects.push(
      buildTextObjectXml(
        'TEXT',
        ['(empty label)'],
        18,
        pctToDymoPrintBounds({ xPct: 4, yPct: 30, widthPct: 92, heightPct: 40 }, envelope.printTemplate, options),
        envelope.printTemplate,
        { align: 'Center', bold: true, textFitMode: 'ShrinkToFit' }
      )
    )
  }

  return studioDieCutXml(envelope.printTemplate, objects.join(''), options)
}

export async function buildLabelXmlCandidatesFromStudioForPrint(
  template: LabelStudioTemplate,
  item: LabelStudioItem
): Promise<string[]> {
  const preferred = paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const hybrid = await buildLabelXmlFromStudioForPrint(template, item, preferred)
  if (preferred.id === 'Shipping') {
    return [hybrid]
  }
  const rest = DYMO_PAPER_TEMPLATES.filter((p) => p.id !== preferred.id)
  const more = await Promise.all(rest.map((paper) => buildLabelXmlFromStudioForPrint(template, item, paper)))
  return [hybrid, ...more]
}
