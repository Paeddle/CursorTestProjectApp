import {
  initDymoFramework,
  isRemoteAppOrigin,
  loadDymoSdk,
  getDymoPrinterNames,
} from './dymoLabelPrint'
import {
  buildLabelWriterPrintParamsXml,
  resolveStudioTwinTurboRoll,
  type DymoPrintQuality,
  type DymoTwinTurboRoll,
} from './dymoPrintParams'
import type { ThermalImageProcessOptions } from './labelStudioThermalImage'
import { printLabelXmlViaWebService } from './dymoWebService'
import { LABEL_STUDIO_PRINT_GEOMETRY_REV } from './labelStudioGeometry'
import { buildLabelXmlCandidatesFromStudioForPrint } from './labelStudioXml'
import type { LabelStudioItem, LabelStudioTemplate } from '../types/labelStudio'

export { LABEL_STUDIO_PRINT_GEOMETRY_REV }

export type PrintStudioLabelsOptions = {
  printerName?: string
  twinTurboRoll?: DymoTwinTurboRoll
  printQuality?: DymoPrintQuality
  thermalImage?: ThermalImageProcessOptions
}

async function printXmlCandidatesViaFramework(
  candidates: string[],
  printerName?: string,
  twinTurboRoll?: DymoTwinTurboRoll,
  printQuality?: DymoPrintQuality
): Promise<number> {
  await loadDymoSdk()
  await initDymoFramework()
  const fw = window.dymo?.label?.framework
  if (!fw) throw new Error('DYMO Connect JavaScript SDK did not load.')

  const printers = getDymoPrinterNames()
  const target =
    printerName && printers.includes(printerName)
      ? printerName
      : printers.find((n) => /labelwriter|dymo/i.test(n)) ?? printers[0]
  if (!target) throw new Error('No DYMO LabelWriter printer found.')

  const printParams = buildLabelWriterPrintParamsXml({ twinTurboRoll, printQuality })
  const errors: string[] = []

  for (const labelXml of candidates) {
    if (fw.printLabel) {
      try {
        fw.printLabel(target, printParams, labelXml, '')
        return 1
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
        continue
      }
    }
    try {
      const label = fw.openLabelXml(labelXml)
      if (label.isValidLabel && !label.isValidLabel()) {
        errors.push('Label XML failed validation')
        continue
      }
      label.print(target)
      return 1
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  throw new Error(errors[errors.length - 1] ?? 'DYMO rejected all label templates')
}

async function printOneStudioItem(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  options?: PrintStudioLabelsOptions
): Promise<'dymo-web' | 'dymo-framework'> {
  const twinTurboRoll = resolveStudioTwinTurboRoll(template.paperTemplateId, options?.twinTurboRoll)
  const candidateXml = await buildLabelXmlCandidatesFromStudioForPrint(template, item, {
    thermalImage: options?.thermalImage,
  })
  const errors: string[] = []

  try {
    await printLabelXmlViaWebService(
      candidateXml,
      options?.printerName,
      twinTurboRoll,
      options?.printQuality
    )
    return 'dymo-web'
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  try {
    await printXmlCandidatesViaFramework(
      candidateXml,
      options?.printerName,
      twinTurboRoll,
      options?.printQuality
    )
    return 'dymo-framework'
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  const detail = errors.join('\n• ')
  if (isRemoteAppOrigin()) {
    throw new Error(
      `Print failed.\n• ${detail}\n\n` +
        'Use this app in a browser on the PC where DYMO Connect is running (localhost is fine). ' +
        'In DYMO Connect, confirm the roll size matches “Label roll in printer” in Label Studio.'
    )
  }
  throw new Error(detail)
}

export async function printStudioLabels(
  template: LabelStudioTemplate,
  items: LabelStudioItem[],
  options?: PrintStudioLabelsOptions
): Promise<{
  printed: number
  method: 'dymo-web' | 'dymo-framework'
  geometryRev: number
}> {
  if (items.length === 0) throw new Error('No items selected to print.')

  let method: 'dymo-web' | 'dymo-framework' = 'dymo-web'
  for (const item of items) {
    method = await printOneStudioItem(template, item, options)
  }

  return { printed: items.length, method, geometryRev: LABEL_STUDIO_PRINT_GEOMETRY_REV }
}
