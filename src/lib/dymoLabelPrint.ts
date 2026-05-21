import type { PoLabelPrintRow } from '../types/poIpoint'
import {
  buildLabelXmlCandidatesForRow,
  labelLayoutForRow,
  labelTextLinesForRow,
  LABEL_XML_TEMPLATE,
} from './dymoLabelXml'
import { printRowsViaWebService } from './dymoWebService'

export {
  labelLayoutForRow,
  labelTextLinesForRow,
  LABEL_XML_TEMPLATE,
  wrapTextToLines,
} from './dymoLabelXml'

/** @deprecated Use LABEL_XML_TEMPLATE — empty template; prefer buildLabelXmlForRow(). */
export const LABEL_XML = LABEL_XML_TEMPLATE

export type DymoPrinterInfo = {
  name: string
  printerType: string
  isConnected: boolean
}

export type DymoEnvironmentInfo = {
  isBrowserSupported?: boolean
  isFrameworkInstalled?: boolean
  isWebServicePresent?: boolean
  errorDetails?: string
}

export type DymoDiagnostics = {
  sdkLoaded: boolean
  initComplete: boolean
  environment: DymoEnvironmentInfo | null
  printers: DymoPrinterInfo[]
  localServiceProbe: { ok: boolean; port?: number; detail?: string } | null
  isRemoteOrigin: boolean
  summary: string
  recommendedAction: string
}

type DymoFramework = {
  init: (callback: () => void) => void
  checkEnvironment: () => DymoEnvironmentInfo
  getPrinters: () => DymoPrinterInfo[]
  openLabelXml: (xml: string) => {
    isValidLabel?: () => boolean
    setObjectText: (name: string, text: string) => void
    print: (printerName: string) => void
  }
  printLabel?: (
    printerName: string,
    printParamsXml: string,
    labelXml: string,
    labelSetXml: string
  ) => void
}

declare global {
  interface Window {
    dymo?: { label: { framework: DymoFramework } }
  }
}

/** DYMO Connect Framework (not legacy labelwriter.com SDK). */
const DYMO_SDK_PATHS = ['/vendor/dymo.connect.framework.js'] as const

let sdkLoadPromise: Promise<boolean> | null = null
let initPromise: Promise<void> | null = null

export function isRemoteAppOrigin(): boolean {
  const host = window.location.hostname
  return host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local')
}

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing && window.dymo?.label?.framework) {
      resolve(true)
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve(Boolean(window.dymo?.label?.framework))
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })
}

export function loadDymoSdk(): Promise<boolean> {
  if (window.dymo?.label?.framework) return Promise.resolve(true)
  if (sdkLoadPromise) return sdkLoadPromise

  sdkLoadPromise = (async () => {
    for (const src of DYMO_SDK_PATHS) {
      if (await loadScript(src)) return true
    }
    return false
  })()

  return sdkLoadPromise
}

export function initDymoFramework(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = new Promise((resolve) => {
    const fw = window.dymo?.label?.framework
    if (!fw?.init) {
      resolve()
      return
    }
    try {
      fw.init(() => resolve())
    } catch {
      resolve()
    }
  })
  return initPromise
}

/** Try to reach DYMO web service; may trigger browser local-network permission. */
export async function probeDymoWebService(): Promise<{
  ok: boolean
  port?: number
  detail?: string
}> {
  const hosts = ['127.0.0.1', 'localhost']
  for (const host of hosts) {
    for (let port = 41951; port <= 41955; port++) {
      try {
        const res = await fetch(`https://${host}:${port}/DYMO/DLS/Printing/StatusConnected`, {
          method: 'GET',
          mode: 'cors',
        })
        if (res.ok) {
          return { ok: true, port, detail: `Service responded on ${host}:${port}` }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (port === 41951 && host === '127.0.0.1') {
          return { ok: false, detail: msg }
        }
      }
    }
  }
  return { ok: false, detail: 'No response on ports 41951–41955' }
}

export function getDymoEnvironment(): DymoEnvironmentInfo | null {
  try {
    const fw = window.dymo?.label?.framework
    if (!fw) return null
    return fw.checkEnvironment()
  } catch {
    return null
  }
}

export function getAllDymoPrinters(): DymoPrinterInfo[] {
  try {
    const fw = window.dymo?.label?.framework
    if (!fw) return []
    return fw.getPrinters() ?? []
  } catch {
    return []
  }
}

export function getDymoPrinterNames(): string[] {
  const all = getAllDymoPrinters()
  const connected = all.filter((p) => p.isConnected)
  if (connected.length > 0) return connected.map((p) => p.name)

  const labelWriters = all.filter(
    (p) => /labelwriter/i.test(p.name) || /labelwriter/i.test(p.printerType)
  )
  if (labelWriters.length > 0) return labelWriters.map((p) => p.name)

  return all.map((p) => p.name)
}

export function isDymoAvailable(): boolean {
  const env = getDymoEnvironment()
  if (!env) return false

  const serviceOk =
    env.isWebServicePresent === true ||
    env.isFrameworkInstalled === true ||
    env.isBrowserSupported === true

  if (!env.isBrowserSupported) return false
  if (!serviceOk && env.isFrameworkInstalled !== true) return false

  return getDymoPrinterNames().length > 0
}

export async function getDymoDiagnostics(): Promise<DymoDiagnostics> {
  const isRemoteOrigin = isRemoteAppOrigin()
  const sdkLoaded = await loadDymoSdk()
  await initDymoFramework()
  const initComplete = Boolean(window.dymo?.label?.framework)
  const environment = getDymoEnvironment()
  const printers = getAllDymoPrinters()
  const names = getDymoPrinterNames()

  let localServiceProbe: DymoDiagnostics['localServiceProbe'] = null
  if (isRemoteOrigin) {
    localServiceProbe = await probeDymoWebService()
  }

  let summary = 'DYMO not detected.'
  let recommendedAction =
    'Install DYMO Connect, connect the LabelWriter by USB, then click “Check DYMO again”.'

  if (!sdkLoaded) {
    summary = 'DYMO JavaScript SDK failed to load.'
    recommendedAction = 'Hard-refresh the page (Ctrl+F5). If it persists, redeploy or run from localhost.'
  } else if (isRemoteOrigin && localServiceProbe && !localServiceProbe.ok) {
    summary = 'Browser is blocking access to DYMO Connect on this PC.'
    recommendedAction =
      'On this laptop: (1) Run `npm run print-agent` (most reliable, especially in Firefox), OR (2) Click “Trust DYMO certificate” below and accept the warning, then Connect printer again. Chrome/Edge: also allow “local network” when prompted.'
  } else if (environment && environment.isFrameworkInstalled === false) {
    summary = 'DYMO Connect web service not reachable.'
    recommendedAction =
      'Open DYMO Connect, confirm the printer shows online, restart DYMO Connect, then visit https://127.0.0.1:41951/DYMO/DLS/Printing/Check in this browser and accept the certificate warning.'
  } else if (printers.length === 0) {
    summary = 'No DYMO printers returned by the service.'
    recommendedAction =
      'In DYMO Connect, verify the LabelWriter is listed. Replug USB, restart DYMO Connect, then click Check DYMO again.'
  } else if (names.length === 0) {
    summary = 'Printers found but none marked connected.'
    recommendedAction =
      'Restart DYMO Connect and the printer. If the printer appears in DYMO Connect, try `npm run print-agent` on this PC.'
  } else {
    summary = `Ready — ${names.length} printer${names.length !== 1 ? 's' : ''}: ${names.join(', ')}`
    recommendedAction = 'Leave this page open with Auto-print enabled, or use `npm run print-agent`.'
  }

  return {
    sdkLoaded,
    initComplete,
    environment,
    printers,
    localServiceProbe,
    isRemoteOrigin,
    summary,
    recommendedAction,
  }
}

export function labelLinesForRow(row: PoLabelPrintRow): string {
  return labelTextLinesForRow(row).join('\n')
}

function browserLabelParts(row: PoLabelPrintRow): { lines: string[]; fontSize: number } {
  const { fontSize, lines } = labelLayoutForRow(row)
  return { lines, fontSize }
}

async function printRowsViaFramework(
  rows: PoLabelPrintRow[],
  printerName?: string
): Promise<{ printed: number; printer: string }> {
  await loadDymoSdk()
  await initDymoFramework()
  const fw = window.dymo?.label?.framework
  if (!fw) {
    throw new Error('DYMO Connect JavaScript SDK did not load.')
  }

  const printers = getDymoPrinterNames()
  const target =
    printerName && printers.includes(printerName)
      ? printerName
      : printers.find((n) => /labelwriter|dymo/i.test(n)) ?? printers[0]
  if (!target) throw new Error('No DYMO LabelWriter printer found.')

  const printParams =
    '<LabelWriterPrintParams><Copies>1</Copies><PrintQuality>Text</PrintQuality></LabelWriterPrintParams>'

  for (const row of rows) {
    const candidates = buildLabelXmlCandidatesForRow(row)
    let printed = false
    let lastErr = 'DYMO rejected all label templates'

    for (const labelXml of candidates) {
      try {
        const label = fw.openLabelXml(labelXml)
        if (label.isValidLabel && !label.isValidLabel()) {
          lastErr = 'Label XML failed isValidLabel() — wrong roll size in DYMO Connect?'
          continue
        }
        if (fw.printLabel) {
          fw.printLabel(target, printParams, labelXml, '')
        } else {
          label.print(target)
        }
        printed = true
        break
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    if (!printed) throw new Error(lastErr)
  }
  return { printed: rows.length, printer: target }
}

function formatDymoPrintErrors(errors: string[]): string {
  return (
    `Direct DYMO print failed.\n${errors.map((e) => `• ${e}`).join('\n')}\n\n` +
    'Firefox: click “Trust DYMO certificate”, accept the 127.0.0.1 warning, then Connect printer again. ' +
    'Chrome/Edge: also allow local network access for this site. Or run `npm run print-agent` (no browser limits). ' +
    'Labels should feed automatically — no print dialog.'
  )
}

/**
 * Print straight to the LabelWriter (no browser window / print dialog).
 * Tries DYMO Connect HTTP first (same path as print-agent), then the JS framework.
 */
export async function printLabelsDirect(
  rows: PoLabelPrintRow[],
  printerName?: string
): Promise<{ printed: number; method: 'dymo-web' | 'dymo-framework' }> {
  if (rows.length === 0) throw new Error('No labels to print.')

  const errors: string[] = []

  try {
    await printRowsViaWebService(rows, printerName)
    return { printed: rows.length, method: 'dymo-web' }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  try {
    const result = await printRowsViaFramework(rows, printerName)
    return { printed: result.printed, method: 'dymo-framework' }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  throw new Error(formatDymoPrintErrors(errors))
}

/** Local dev fallback may open a browser print dialog; Print Station uses printLabelsDirect only. */
export async function printLabelsWithDymo(
  rows: PoLabelPrintRow[],
  printerName?: string
): Promise<{ printed: number; method: 'dymo' | 'browser' }> {
  if (rows.length === 0) return { printed: 0, method: 'browser' }

  try {
    const result = await printLabelsDirect(rows, printerName)
    return { printed: result.printed, method: 'dymo' }
  } catch (directErr) {
    if (isRemoteAppOrigin()) throw directErr
  }

  printLabelsInBrowser(rows)
  return { printed: rows.length, method: 'browser' }
}

/** Fallback: open print dialog with one label-sized block per row. */
export function printLabelsInBrowser(rows: PoLabelPrintRow[]): void {
  const html = rows
    .map((r) => {
      const { lines, fontSize } = browserLabelParts(r)
      const text = lines.map((line) => escapeHtml(line)).join('<br/>')
      return `
    <div class="label">
      <div class="label-inner" style="font-size:${fontSize}pt">
        <div class="label-text">${text}</div>
      </div>
    </div>`
    })
    .join('')

  const doc = `<!DOCTYPE html><html><head><title>Labels</title>
<style>
@page { size: 102mm 59mm; margin: 0; }
body { margin: 0; }
.label {
  width: 102mm;
  height: 59mm;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Arial, sans-serif;
  page-break-after: always;
  break-after: page;
}
.label-inner {
  text-align: center;
  width: 100%;
  padding: 2mm;
  box-sizing: border-box;
}
.label-text {
  font-weight: bold;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
</style></head><body>${html}</body></html>`

  const w = window.open('', '_blank', 'width=400,height=300')
  if (!w) {
    alert('Allow pop-ups to print labels, or install DYMO Connect for direct printing.')
    return
  }
  w.document.write(doc)
  w.document.close()
  w.focus()
  w.onload = () => {
    w.print()
    w.close()
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
