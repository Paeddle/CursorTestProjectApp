/**
 * Find which PaperName/Id DYMO Connect accepts on this PC (RenderLabel probe).
 * From project root: npm run dymo-probe
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DYMO_PAPER_TEMPLATES, buildLabelXml } from './dymo-label-xml.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
  console.error('')
  console.error('Run this from the Order Tracker project folder (where package.json lives).')
  console.error('')
  console.error('  cd C:\\Users\\orrab\\Documents\\CursorTestProject-main\\CursorTestProject-main')
  console.error('  npm run dymo-probe')
  console.error('')
  console.error('Or double-click: scripts\\run-dymo-probe.ps1')
  console.error('')
  process.exit(1)
}
process.chdir(projectRoot)

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

async function dymoRequest(port, endpoint, form = null) {
  const url = `https://127.0.0.1:${port}/DYMO/DLS/Printing/${endpoint}`
  const init = { method: form ? 'POST' : 'GET' }
  if (form) {
    init.body = new URLSearchParams(form)
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await fetch(url, init)
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}

async function main() {
  const status = await dymoRequest(41951, 'StatusConnected')
  if (!status.ok) {
    console.error('DYMO Connect not reachable on 41951. Open DYMO Connect first.')
    process.exit(1)
  }

  const printersXml = await dymoRequest(41951, 'GetPrinters')
  const nameMatch = printersXml.body.match(/<Name>([^<]+)<\/Name>/i)
  const printerName = nameMatch?.[1]?.trim()
  if (!printerName) {
    console.error('No printer name in GetPrinters response')
    process.exit(1)
  }
  console.log(`Printer: ${printerName}\n`)

  const layout = {
    fontSize: 24,
    jobLines: ['PROBE job name'],
    locationLines: ['Room A · Shelf 3'],
  }
  for (const template of DYMO_PAPER_TEMPLATES) {
    const labelXml = buildLabelXml(layout, template)
    const render = await dymoRequest(41951, 'RenderLabel', {
      printerName,
      labelXml,
      renderParamsXml: '',
    })
    const ok =
      render.ok &&
      render.body.length > 200 &&
      !/error|exception|invalid|not declared/i.test(render.body)
    console.log(`${ok ? 'OK ' : 'FAIL'} ${template.paperName} (Id=${template.id})`)
    if (!ok) console.log(`     ${render.body.slice(0, 200)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
