import type { PoLabelPrintRow } from '../types/poIpoint'
import {
  assertDymoPrintSucceeded,
  buildLabelXmlCandidatesForRow,
} from './dymoLabelXml'
import {
  buildLabelWriterPrintParamsXml,
  type DymoPrintQuality,
  type DymoTwinTurboRoll,
} from './dymoPrintParams'

export type DymoServiceEndpoint = { host: string; port: number }

const SERVICE_PATH = 'DYMO/DLS/Printing'
const HOSTS = ['127.0.0.1', 'localhost'] as const

const PORT_START = 41951
const PORT_END = 41960

let cachedService: DymoServiceEndpoint | null = null
let cachedPrinter: string | null = null

async function dymoRequest(
  host: string,
  port: number,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  form?: Record<string, string>
): Promise<unknown> {
  const url = `https://${host}:${port}/${SERVICE_PATH}/${endpoint}`
  const init: RequestInit = { method }
  if (form) {
    init.body = new URLSearchParams(form)
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await fetch(url, init)
  const ct = res.headers.get('content-type') ?? ''
  const body = ct.includes('json') ? await res.json() : await res.text()
  if (!res.ok) {
    throw new Error(`${endpoint} HTTP ${res.status}: ${String(body).slice(0, 300)}`)
  }
  return body
}

async function tryDymoPort(host: string, port: number): Promise<DymoServiceEndpoint | null> {
  try {
    await dymoRequest(host, port, 'StatusConnected')
    return { host, port }
  } catch {
    return null
  }
}

export async function findDymoWebService(): Promise<DymoServiceEndpoint | null> {
  if (cachedService) return cachedService

  const primary = await tryDymoPort('127.0.0.1', PORT_START)
  if (primary) {
    cachedService = primary
    return primary
  }

  for (const host of HOSTS) {
    for (let port = PORT_START + 1; port <= PORT_END; port++) {
      const hit = await tryDymoPort(host, port)
      if (hit) {
        cachedService = hit
        return hit
      }
    }
  }
  return null
}

function parsePrinterNames(xml: string): string[] {
  const names: string[] = []
  const re =
    /<LabelWriterPrinter[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<IsConnected>([^<]+)<\/IsConnected>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[2].trim().toLowerCase() === 'true') names.push(m[1].trim())
  }
  if (names.length === 0) {
    const nameRe = /<Name>([^<]+)<\/Name>/gi
    while ((m = nameRe.exec(xml))) {
      const n = m[1].trim()
      if (/labelwriter|dymo/i.test(n)) names.push(n)
    }
  }
  return [...new Set(names)]
}

export async function getDymoWebServicePrinterNames(
  service: DymoServiceEndpoint = cachedService!
): Promise<string[]> {
  const xml = String(await dymoRequest(service.host, service.port, 'GetPrinters'))
  const names = parsePrinterNames(xml)
  if (names.length === 0) throw new Error('No LabelWriter found in DYMO Connect.')
  return names
}

export async function resolveDymoWebPrinter(
  service: DymoServiceEndpoint,
  preferred?: string
): Promise<string> {
  const names = await getDymoWebServicePrinterNames(service)
  if (preferred && names.includes(preferred)) return preferred
  if (cachedPrinter && names.includes(cachedPrinter)) return cachedPrinter
  const pick = names.find((n) => /labelwriter|dymo/i.test(n)) ?? names[0]
  cachedPrinter = pick
  return pick
}

function isDymoLabelRejected(result: unknown): boolean {
  const s = String(result ?? '').trim()
  if (!s || s.toLowerCase() === 'true') return false
  if (s.toLowerCase() === 'false') return true
  return /error|exception|invalid|not declared|not found|failed/i.test(s)
}

async function renderLabelOk(
  service: DymoServiceEndpoint,
  printerName: string,
  labelXml: string
): Promise<boolean> {
  try {
    const result = await dymoRequest(service.host, service.port, 'RenderLabel', 'POST', {
      printerName,
      labelXml,
      renderParamsXml: '',
    })
    if (isDymoLabelRejected(result)) return false
    const s = String(result ?? '').trim()
    return s.length > 100
  } catch {
    return false
  }
}

async function printOneLabelXml(
  service: DymoServiceEndpoint,
  printerName: string,
  labelXml: string,
  twinTurboRoll?: DymoTwinTurboRoll,
  printQuality?: DymoPrintQuality
): Promise<void> {
  const result = await dymoRequest(service.host, service.port, 'PrintLabel2', 'POST', {
    printerName,
    labelXml,
    printParamsXml: buildLabelWriterPrintParamsXml({ twinTurboRoll, printQuality }),
    labelSetXml: '',
  })
  assertDymoPrintSucceeded(result, 'PrintLabel2')
}

function formatDymoLabelXmlPrintFailure(errors: string[]): string {
  const last = errors[errors.length - 1] ?? 'PrintLabel2 failed'
  if (/diecutlabel|not declared/i.test(last)) {
    return (
      `${last}\n\n` +
      'DYMO could not read this label XML. In DYMO Connect, add the roll size that matches ' +
      '“Label roll in printer” in Label Studio (usually 30323 Shipping), reload the printer, then try again.'
    )
  }
  return last
}

/** Try each label XML until RenderLabel + PrintLabel2 succeed (PO and Label Studio). */
export async function printLabelXmlViaWebService(
  candidates: string[],
  printerName?: string,
  twinTurboRoll?: DymoTwinTurboRoll,
  printQuality?: DymoPrintQuality
): Promise<{ printer: string; service: DymoServiceEndpoint }> {
  if (candidates.length === 0) throw new Error('No label XML to print.')

  const service = await findDymoWebService()
  if (!service) {
    throw new Error(
      'Cannot reach DYMO Connect on this PC. Open DYMO Connect, connect the LabelWriter, then try again.'
    )
  }

  const printer = await resolveDymoWebPrinter(service, printerName)
  const errors: string[] = []

  for (const labelXml of candidates) {
    if (!(await renderLabelOk(service, printer, labelXml))) {
      errors.push('RenderLabel rejected template')
      continue
    }
    try {
      await printOneLabelXml(service, printer, labelXml, twinTurboRoll, printQuality)
      return { printer, service }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  try {
    await printOneLabelXml(service, printer, candidates[0], twinTurboRoll, printQuality)
    return { printer, service }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  throw new Error(formatDymoLabelXmlPrintFailure(errors))
}

/** Direct HTTP print (print agent). Works in browser when local network access is allowed. */
export async function printRowsViaWebService(
  rows: PoLabelPrintRow[],
  printerName?: string,
  twinTurboRoll?: DymoTwinTurboRoll
): Promise<{ printed: number; printer: string; service: DymoServiceEndpoint }> {
  if (rows.length === 0) throw new Error('No labels to print.')

  let printer = ''
  let service: DymoServiceEndpoint | null = null
  for (const row of rows) {
    const result = await printLabelXmlViaWebService(
      buildLabelXmlCandidatesForRow(row),
      printerName || printer || undefined,
      twinTurboRoll
    )
    printer = result.printer
    service = result.service
  }
  if (!service) {
    throw new Error('Cannot reach DYMO Connect on this PC.')
  }
  return { printed: rows.length, printer, service }
}

export type LocalDymoConnectResult = {
  ok: boolean
  service: DymoServiceEndpoint | null
  printers: string[]
  error: string | null
}

/** Probe DYMO HTTP service and cache endpoint + printers for Print Station. */
export async function connectLocalDymo(): Promise<LocalDymoConnectResult> {
  cachedService = null
  cachedPrinter = null
  try {
    const service = await findDymoWebService()
    if (!service) {
      return {
        ok: false,
        service: null,
        printers: [],
        error:
          'DYMO Connect is not reachable. Install DYMO Connect, plug in the LabelWriter, then use “Trust DYMO certificate” below if the browser blocked access.',
      }
    }
    const printers = await getDymoWebServicePrinterNames(service)
    return { ok: true, service, printers, error: null }
  } catch (e) {
    return {
      ok: false,
      service: null,
      printers: [],
      error: e instanceof Error ? e.message : 'Connection failed',
    }
  }
}

export function openDymoCertificateCheckPage(): void {
  window.open('https://127.0.0.1:41951/DYMO/DLS/Printing/Check', '_blank', 'noopener,noreferrer')
}

export function clearDymoWebServiceCache(): void {
  cachedService = null
  cachedPrinter = null
}
