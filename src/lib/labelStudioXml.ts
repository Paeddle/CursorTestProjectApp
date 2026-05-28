import {
  DYMO_PAPER_TEMPLATES,
  escapeXmlText,
  type DymoPaperTemplate,
} from './dymoLabelXml'
import { barcodeTextForPrint, resolveBarcodeType } from './labelStudioBarcode'
import { mergedBarcodeForElement, mergedLinesForElement } from './labelStudioMerge'
import type {
  LabelStudioBarcodeElement,
  LabelStudioElement,
  LabelStudioItem,
  LabelStudioTemplate,
  LabelStudioTextElement,
} from '../types/labelStudio'
import { isBarcodeElement, isTextElement, paperTemplateById } from '../types/labelStudio'

type LabelBounds = { x: number; y: number; width: number; height: number }

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

function pctToBounds(
  el: Pick<LabelStudioElement, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>,
  template: DymoPaperTemplate
): LabelBounds {
  const baseX = template.boundsX
  const baseY = template.boundsY
  const baseW = template.boundsWidth
  const baseH = template.boundsHeight
  return {
    x: Math.round(baseX + (el.xPct / 100) * baseW),
    y: Math.round(baseY + (el.yPct / 100) * baseH),
    width: Math.max(80, Math.round((el.widthPct / 100) * baseW)),
    height: Math.max(60, Math.round((el.heightPct / 100) * baseH)),
  }
}

function buildTextObjectXml(
  objectName: string,
  lines: string[],
  fontSize: number,
  bounds: LabelBounds,
  options: { align: LabelStudioTextElement['align']; bold: boolean }
): string {
  const styled = buildStyledTextBlockXml(lines, fontSize, options.bold)
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
    `<TextFitMode>ShrinkToFit</TextFitMode>` +
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
  text: string,
  bounds: LabelBounds
): string {
  const symbology = resolveBarcodeType(el.barcodeType, text)
  const encoded = barcodeTextForPrint(text, symbology)
  if (!encoded) return ''

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
    `<Type>${symbology}</Type>` +
    `<Size>${el.size}</Size>` +
    `<TextPosition>${el.textPosition}</TextPosition>` +
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

function buildElementXml(el: LabelStudioElement, item: LabelStudioItem, template: DymoPaperTemplate): string {
  const bounds = pctToBounds(el, template)
  if (isBarcodeElement(el)) {
    const value = mergedBarcodeForElement(el.content, item)
    return buildBarcodeObjectXml(el, value, bounds)
  }
  if (isTextElement(el)) {
    const lines = mergedLinesForElement(el.content, item)
    if (lines.length === 0) return ''
    return buildTextObjectXml(el.name || el.id, lines, el.fontSize, bounds, {
      align: el.align,
      bold: el.bold,
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
        pctToBounds({ xPct: 4, yPct: 30, widthPct: 92, heightPct: 40 }, t),
        { align: 'Center', bold: true }
      )
    )
  }

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation>` +
    `<Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands>` +
    `<RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/>` +
    `</DrawCommands>` +
    objects.join('') +
    `</DieCutLabel>`
  )
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
