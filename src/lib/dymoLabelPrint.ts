import type { PoLabelPrintRow } from '../types/poIpoint'

/**
 * DYMO 30323 Shipping (54mm × 101mm / 2-1/8" × 4").
 * Printable area per DYMO spec: origin (18,128), size 608×2218 twips; page 638×2382.
 * Landscape feed on LabelWriter — page dimensions are swapped for print orientation.
 */
const LABEL_XML = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Shipping</Id>
  <PaperName>30323 Shipping</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="2382" Height="638" Rx="180" Ry="180"/>
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>LABEL_TEXT</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>None</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element><String>LINE1</String><Attributes><Font Family="Arial" Size="24" Bold="True"/></Attributes></Element>
      </StyledText>
    </TextObject>
    <Bounds X="128" Y="18" Width="2218" Height="608"/>
  </ObjectInfo>
</DieCutLabel>`

type DymoFramework = {
  checkEnvironment: () => { isBrowserSupported: boolean; isFrameworkInstalled: boolean }
  getPrinters: () => { name: string; printerType: string; isConnected: boolean }[]
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

const DYMO_SDK_URL =
  'https://labelwriter.com/software/dls/sdk/js/DYMO.Label.Framework.3.0.js'

let sdkLoadPromise: Promise<boolean> | null = null

export function loadDymoSdk(): Promise<boolean> {
  if (window.dymo?.label?.framework) return Promise.resolve(true)
  if (sdkLoadPromise) return sdkLoadPromise
  sdkLoadPromise = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${DYMO_SDK_URL}"]`)
    if (existing && window.dymo?.label?.framework) {
      resolve(true)
      return
    }
    const script = document.createElement('script')
    script.src = DYMO_SDK_URL
    script.async = true
    script.onload = () => resolve(Boolean(window.dymo?.label?.framework))
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })
  return sdkLoadPromise
}

export function isDymoAvailable(): boolean {
  try {
    const fw = window.dymo?.label?.framework
    if (!fw) return false
    const env = fw.checkEnvironment()
    return env.isBrowserSupported && env.isFrameworkInstalled
  } catch {
    return false
  }
}

export function getDymoPrinterNames(): string[] {
  try {
    const fw = window.dymo?.label?.framework
    if (!fw) return []
    return fw
      .getPrinters()
      .filter((p) => p.isConnected)
      .map((p) => p.name)
  } catch {
    return []
  }
}

/** ~24pt Arial bold on 30323 printable width (2218 twips). */
const DYMO_MAX_CHARS_PER_LINE = 21
const BROWSER_JOB_MAX_CHARS_PER_LINE = 22
const BROWSER_LOC_MAX_CHARS_PER_LINE = 26

/** Break text onto new lines at word boundaries; long tokens split to fit. */
export function wrapTextToLines(text: string, maxChars: number): string[] {
  const t = text.trim()
  if (!t || maxChars < 1) return []

  const lines: string[] = []
  let current = ''

  const flush = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }

  const appendToken = (token: string) => {
    let rest = token
    while (rest.length > 0) {
      if (!current) {
        if (rest.length <= maxChars) {
          current = rest
          rest = ''
        } else {
          lines.push(rest.slice(0, maxChars))
          rest = rest.slice(maxChars)
        }
        continue
      }

      const joined = `${current} ${rest}`
      if (joined.length <= maxChars) {
        current = joined
        rest = ''
      } else {
        flush()
      }
    }
  }

  for (const word of t.split(/\s+/)) {
    if (word) appendToken(word)
  }
  flush()
  return lines
}

function labelLines(row: PoLabelPrintRow): string {
  const jobLines = wrapTextToLines(row.job_name || row.item_name || '', DYMO_MAX_CHARS_PER_LINE)
  const locLines = wrapTextToLines(row.location_name || '—', DYMO_MAX_CHARS_PER_LINE)
  return [...jobLines, ...locLines].join('\n')
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

  await loadDymoSdk()
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
        label.setObjectText('LABEL_TEXT', labelLines(row))
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
