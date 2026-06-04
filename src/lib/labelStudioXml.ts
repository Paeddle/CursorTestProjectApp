import { DYMO_PAPER_TEMPLATES, escapeXmlText, type DymoPaperTemplate } from './dymoLabelXml'
import {
  barcodeTextForPrint,
  dymoBarcodeSizeForBounds,
  dymoBarcodeSymbologyXml,
  resolveBarcodeType,
} from './labelStudioBarcode'
import {
  BARCODE_CAPTION_MAX_FONT_PT,
  splitBarcodeElementBounds,
} from './labelStudioBarcodeLayout'
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
import { effectiveTextFontSizePt, pctToDymoPrintBounds, type DymoLabelBounds } from './labelStudioGeometry'
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

function studioDieCutXml(template: DymoPaperTemplate, objectXml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation>` +
    `<Id>${template.id}</Id>` +
    `<PaperName>${template.paperName}</PaperName>` +
    `<DrawCommands>` +
    `<RoundRectangle X="0" Y="0" Width="${template.drawWidth}" Height="${template.drawHeight}" Rx="270" Ry="270"/>` +
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
  options: {
    align: LabelStudioTextElement['align']
    bold: boolean
    textFitMode: LabelStudioTextElement['textFitMode']
  }
): string {
  const fitMode = options.textFitMode ?? 'ShrinkToFit'
  const pt = effectiveTextFontSizePt(
    fontSize,
    Math.max(1, lines.length),
    bounds.height,
    fitMode
  )
  const dymoFitMode = fitMode === 'None' ? 'None' : 'ShrinkToFit'
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
  bounds: DymoLabelBounds
): string {
  const dymoType = dymoBarcodeSymbologyXml(symbology)
  const dymoSize = dymoBarcodeSizeForBounds(bounds, symbology)

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
  bounds: DymoLabelBounds
): string {
  const symbology = resolveBarcodeType(el.barcodeType, displayText)
  const encoded = barcodeTextForPrint(displayText, symbology)
  if (!encoded) return ''

  const { barcode, caption } = splitBarcodeElementBounds(bounds, el.textPosition)
  const barcodeXml = buildBarcodeObjectXml(el, encoded, symbology, barcode)

  if (!caption || el.textPosition === 'None') return barcodeXml

  const captionXml = buildTextObjectXml(
    `${el.id}_caption`,
    [displayText],
    BARCODE_CAPTION_MAX_FONT_PT,
    caption,
    { align: 'Center', bold: false, textFitMode: 'ShrinkToFit' }
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
  template: DymoPaperTemplate
): Promise<string> {
  const bounds = pctToDymoPrintBounds(el, template)
  if (isBarcodeElement(el)) {
    const value = mergedBarcodeForElement(el.content, item)
    return buildBarcodePrintXml(el, value, bounds)
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
    return buildTextObjectXml(el.name || el.id, lines, el.fontSize, bounds, {
      align: el.align,
      bold: el.bold,
      textFitMode: el.textFitMode ?? 'ShrinkToFit',
    })
  }
  return ''
}

function buildElementXml(el: LabelStudioElement, item: LabelStudioItem, template: DymoPaperTemplate): string {
  const bounds = pctToDymoPrintBounds(el, template)
  if (isBarcodeElement(el)) {
    const value = mergedBarcodeForElement(el.content, item)
    return buildBarcodePrintXml(el, value, bounds)
  }
  if (isImageElement(el)) {
    return ''
  }
  if (isTextElement(el)) {
    const lines = mergedLinesForElement(el.content, item)
    if (lines.length === 0) return ''
    return buildTextObjectXml(el.name || el.id, lines, el.fontSize, bounds, {
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
  paper?: DymoPaperTemplate
): string {
  const t = paper ?? paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const objects = template.elements
    .map((el) => buildElementXml(el, item, t))
    .filter(Boolean)

  if (objects.length === 0) {
    objects.push(
      buildTextObjectXml(
        'TEXT',
        ['(empty label)'],
        18,
        pctToDymoPrintBounds({ xPct: 4, yPct: 30, widthPct: 92, heightPct: 40 }, t),
        { align: 'Center', bold: true, textFitMode: 'ShrinkToFit' }
      )
    )
  }

  return studioDieCutXml(t, objects.join(''))
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
  paper?: DymoPaperTemplate
): Promise<string> {
  const t = paper ?? paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const objectParts = await Promise.all(template.elements.map((el) => buildElementXmlAsync(el, item, t)))
  const objects = objectParts.filter(Boolean)

  if (objects.length === 0) {
    objects.push(
      buildTextObjectXml(
        'TEXT',
        ['(empty label)'],
        18,
        pctToDymoPrintBounds({ xPct: 4, yPct: 30, widthPct: 92, heightPct: 40 }, t),
        { align: 'Center', bold: true, textFitMode: 'ShrinkToFit' }
      )
    )
  }

  return studioDieCutXml(t, objects.join(''))
}

export async function buildLabelXmlCandidatesFromStudioForPrint(
  template: LabelStudioTemplate,
  item: LabelStudioItem
): Promise<string[]> {
  const preferred = paperTemplateById(template.paperTemplateId, DYMO_PAPER_TEMPLATES)
  const ordered = [
    preferred,
    ...DYMO_PAPER_TEMPLATES.filter((p) => p.id !== preferred.id),
  ]
  return Promise.all(ordered.map((paper) => buildLabelXmlFromStudioForPrint(template, item, paper)))
}
