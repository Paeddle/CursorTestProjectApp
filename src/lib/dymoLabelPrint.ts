import type { PoLabelPrintRow } from '../types/poIpoint'
import { LABEL_XML_TEMPLATE, labelTextLinesForRow, wrapTextToLines } from './dymoLabelXml'
import { printRowsViaWebService } from './dymoWebService'

export { wrapTextToLines } from './dymoLabelXml'

/** @deprecated Use LABEL_XML_TEMPLATE — kept for SDK openLabelXml. */
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
    setObjectText: (name: string, text: string) => void
    print: (printerName: string) => void
  }
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
      'On this laptop: (1) Run `npm run print-agent` in the project folder (most reliable), OR (2) Open Print Station at http://localhost:5173/print-station after `npm run dev`, OR (3) In Chrome/Edge when prompted, allow this site to connect to devices on your local network, then click Check DYMO again.'
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

const BROWSER_JOB_MAX_CHARS_PER_LINE = 22
const BROWSER_LOC_MAX_CHARS_PER_LINE = 26

export function labelLinesForRow(row: PoLabelPrintRow): string {
  return labelTextLinesForRow(row).join('\n')
}

function browserLabelParts(row: PoLabelPrintRow): { job: string; loc: string } {
  return {
    job: wrapTextToLines(row.job_name || row.item_name || '', BROWSER_JOB_MAX_CHARS_PER_LINE).join(
      '\n'
    ),
    loc: wrapTextToLines(row.location_name || '—', BROWSER_LOC_MAX_CHARS_PER_LINE).join('\n'),
  }
}

export async function printLabelsWithDymo(
  rows: PoLabelPrintRow[],
  printerName?: string
): Promise<{ printed: number; method: 'dymo' | 'browser' }> {
  if (rows.length === 0) return { printed: 0, method: 'browser' }

  try {
    await printRowsViaWebService(rows, printerName)
    return { printed: rows.length, method: 'dymo' }
  } catch {
    /* try legacy SDK below */
  }

  await loadDymoSdk()
  await initDymoFramework()
  const fw = window.dymo?.label?.framework

  if (fw && isDymoAvailable()) {
    const printers = getDymoPrinterNames()
    const target =
      printerName && printers.includes(printerName)
        ? printerName
        : printers.find((n) => /labelwriter|dymo/i.test(n)) ?? printers[0]
    if (target) {
      for (const row of rows) {
        const label = fw.openLabelXml(LABEL_XML)
        label.setObjectText('LABEL_TEXT', labelLinesForRow(row))
        label.print(target)
      }
      return { printed: rows.length, method: 'dymo' }
    }
  }

  printLabelsInBrowser(rows)
  return { printed: rows.length, method: 'browser' }
}

/** Fallback: open print dialog with one label-sized block per row. */
export function printLabelsInBrowser(rows: PoLabelPrintRow[]): void {
  const html = rows
    .map((r) => {
      const { job, loc } = browserLabelParts(r)
      return `
    <div class="label">
      <div class="label-inner">
        <div class="label-job">${escapeHtml(job)}</div>
        <div class="label-loc">${escapeHtml(loc)}</div>
      </div>
    </div>`
    })
    .join('')

  const doc = `<!DOCTYPE html><html><head><title>Labels</title>
<style>
@page { size: 4in 2.125in; margin: 0; }
body { margin: 0; }
.label {
  width: 4in;
  height: 2.125in;
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
  padding: 0.08in;
  box-sizing: border-box;
}
.label-job,
.label-loc {
  white-space: pre-line;
  overflow-wrap: anywhere;
  line-height: 1.2;
}
.label-job {
  font-weight: bold;
  font-size: 22pt;
}
.label-loc {
  font-size: 18pt;
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
