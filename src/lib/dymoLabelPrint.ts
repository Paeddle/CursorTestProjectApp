import type { PoLabelPrintRow } from '../types/poIpoint'

/** Minimal 30334-compatible label (2-1/4" x 1-1/4") with two text fields. */
const LABEL_XML = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Address</Id>
  <PaperName>30334 2-1/4 in x 1-1/4 in</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="3240" Height="1440" Rx="180" Ry="180"/>
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>JOB</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Left</HorizontalAlignment>
      <VerticalAlignment>Top</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element><String>JOB</String><Attributes><Font Family="Arial" Size="10" Bold="True"/></Attributes></Element>
      </StyledText>
    </TextObject>
    <Bounds X="120" Y="80" Width="3000" Height="520"/>
  </ObjectInfo>
  <ObjectInfo>
    <TextObject>
      <Name>LOCATION</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Left</HorizontalAlignment>
      <VerticalAlignment>Top</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element><String>LOCATION</String><Attributes><Font Family="Arial" Size="9" Bold="False"/></Attributes></Element>
      </StyledText>
    </TextObject>
    <Bounds X="120" Y="640" Width="3000" Height="680"/>
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

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
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
        label.setObjectText('JOB', truncate(row.job_name || row.item_name, 80))
        label.setObjectText(
          'LOCATION',
          truncate(row.location_name || '—', 80)
        )
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
    .map(
      (r) => `
    <div class="label" style="page-break-after:always;width:2.25in;height:1.25in;padding:0.12in;box-sizing:border-box;font-family:Arial,sans-serif;">
      <div style="font-weight:bold;font-size:11pt;line-height:1.2;margin-bottom:4px;">${escapeHtml(r.job_name || r.item_name)}</div>
      <div style="font-size:9pt;line-height:1.2;">${escapeHtml(r.location_name || '—')}</div>
    </div>`
    )
    .join('')

  const doc = `<!DOCTYPE html><html><head><title>Labels</title>
<style>
@page { size: 2.25in 1.25in; margin: 0; }
body { margin: 0; }
.label { break-after: page; }
@media print { .label { page-break-after: always; } }
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
