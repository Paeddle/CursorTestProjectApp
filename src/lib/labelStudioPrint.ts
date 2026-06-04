import {
  initDymoFramework,
  isRemoteAppOrigin,
  loadDymoSdk,
  getDymoPrinterNames,
} from './dymoLabelPrint'
import { assertDymoPrintSucceeded } from './dymoLabelXml'
import { findDymoWebService, resolveDymoWebPrinter } from './dymoWebService'
import { buildLabelXmlFromStudioForPrint } from './labelStudioXml'
import type { LabelStudioItem, LabelStudioTemplate } from '../types/labelStudio'

const PRINT_PARAMS =
  '<LabelWriterPrintParams><Copies>1</Copies><PrintQuality>Text</PrintQuality></LabelWriterPrintParams>'

async function printXmlViaWebService(xmlList: string[], printerName?: string): Promise<number> {
  const service = await findDymoWebService()
  if (!service) throw new Error('DYMO Connect is not reachable on this PC.')

  const printer = await resolveDymoWebPrinter(service, printerName)

  for (const labelXml of xmlList) {
    const res = await fetch(
      `https://${service.host}:${service.port}/DYMO/DLS/Printing/PrintLabel2`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          printerName: printer,
          labelXml,
          printParamsXml: PRINT_PARAMS,
          labelSetXml: '',
        }),
      }
    )
    const ct = res.headers.get('content-type') ?? ''
    const body = ct.includes('json') ? await res.json() : await res.text()
    if (!res.ok) throw new Error(`PrintLabel2 HTTP ${res.status}: ${String(body).slice(0, 300)}`)
    assertDymoPrintSucceeded(body, 'PrintLabel2')
  }
  return xmlList.length
}

async function printXmlViaFramework(xmlList: string[], printerName?: string): Promise<number> {
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

  for (const labelXml of xmlList) {
    let printed = false
    let lastErr = 'DYMO rejected label'
    if (fw.printLabel) {
      try {
        fw.printLabel(target, PRINT_PARAMS, labelXml, '')
        printed = true
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    if (!printed) {
      const label = fw.openLabelXml(labelXml)
      if (label.isValidLabel && !label.isValidLabel()) {
        throw new Error('Label XML failed validation — check roll size in DYMO Connect.')
      }
      try {
        label.print(target)
        printed = true
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    if (!printed) throw new Error(lastErr)
  }
  return xmlList.length
}

export async function printStudioLabels(
  template: LabelStudioTemplate,
  items: LabelStudioItem[],
  printerName?: string
): Promise<{ printed: number; method: 'dymo-web' | 'dymo-framework' }> {
  if (items.length === 0) throw new Error('No items selected to print.')

  const xmlPerItem: string[] = []
  for (const item of items) {
    xmlPerItem.push(await buildLabelXmlFromStudioForPrint(template, item))
  }

  const errors: string[] = []
  try {
    const printed = await printXmlViaWebService(xmlPerItem, printerName)
    return { printed, method: 'dymo-web' }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  try {
    const printed = await printXmlViaFramework(xmlPerItem, printerName)
    return { printed, method: 'dymo-framework' }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  if (isRemoteAppOrigin()) {
    throw new Error(
      `Cannot print from this device.\n${errors.map((x) => `• ${x}`).join('\n')}\n\nOpen Label Studio on the laptop with DYMO Connect, or use Print Station for PO labels.`
    )
  }
  throw new Error(errors.join('\n'))
}
