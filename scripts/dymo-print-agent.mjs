/**
 * Warehouse print agent — runs on the laptop with DYMO Connect (no browser CORS).
 * Polls Supabase label_print_queue and prints via https://127.0.0.1:41951+.
 *
 * Usage (from repo root): npm run print-agent
 * Requires .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

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

const DYMO_MAX_CHARS = 21
const POLL_MS = 3000

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function wrapText(text, maxChars) {
  const t = String(text || '').trim()
  if (!t) return []
  const lines = []
  let current = ''
  const flush = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }
  for (const word of t.split(/\s+/)) {
    let rest = word
    while (rest.length) {
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
  flush()
  return lines
}

function labelXmlForRow(row) {
  const text = [
    ...wrapText(row.job_name || row.item_name || '', DYMO_MAX_CHARS),
    ...wrapText(row.location_name || '—', DYMO_MAX_CHARS),
  ].join('\n')
  return LABEL_XML.replace(
    '<String>LINE1</String>',
    `<String>${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</String>`
  )
}

async function dymoRequest(host, port, endpoint, method = 'GET', form = null) {
  const url = `https://${host}:${port}/DYMO/DLS/Printing/${endpoint}`
  const init = { method }
  if (form) {
    init.body = new URLSearchParams(form)
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('json')) return res.json()
  return res.text()
}

async function findDymoService() {
  for (const host of ['127.0.0.1', 'localhost']) {
    for (let port = 41951; port <= 41960; port++) {
      try {
        await dymoRequest(host, port, 'StatusConnected')
        return { host, port }
      } catch {
        /* try next port */
      }
    }
  }
  return null
}

function parsePrinterNames(xml) {
  const names = []
  const re = /<LabelWriterPrinter[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<IsConnected>([^<]+)<\/IsConnected>/gi
  let m
  while ((m = re.exec(xml))) {
    const name = m[1].trim()
    const connected = m[2].trim().toLowerCase() === 'true'
    if (connected) names.push(name)
  }
  if (names.length === 0) {
    const nameRe = /<Name>([^<]+)<\/Name>/gi
    while ((m = nameRe.exec(xml))) {
      if (/labelwriter|dymo/i.test(m[1])) names.push(m[1].trim())
    }
  }
  return [...new Set(names)]
}

async function getPrinterName(service) {
  const xml = await dymoRequest(service.host, service.port, 'GetPrinters')
  const names = parsePrinterNames(String(xml))
  if (names.length === 0) throw new Error('No LabelWriter printers from DYMO Connect')
  return names.find((n) => /labelwriter|dymo/i.test(n)) ?? names[0]
}

async function printLabel(service, printerName, labelXml) {
  const result = await dymoRequest(service.host, service.port, 'PrintLabel', 'POST', {
    printerName,
    labelXml,
    printParamsXml: '',
    labelSetXml: '',
  })
  if (result !== true && result !== 'true' && result !== '') {
    throw new Error(`PrintLabel returned: ${String(result)}`)
  }
}

function log(msg) {
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] ${msg}`)
}

async function main() {
  const env = { ...loadEnvFile(path.join(root, '.env')), ...process.env }
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  let service = null
  let printerName = null

  log('DYMO print agent starting. Leave this window open on the laptop with the LabelWriter.')
  log('Queue labels from PO Info on your tablet; this script prints them automatically.')

  const refreshDymo = async () => {
    service = await findDymoService()
    if (!service) {
      printerName = null
      return false
    }
    printerName = await getPrinterName(service)
    log(`DYMO ready on ${service.host}:${service.port} — printer: ${printerName}`)
    return true
  }

  if (!(await refreshDymo())) {
    log('DYMO Connect not found. Open DYMO Connect and connect the LabelWriter, then waiting…')
  }

  const processBatch = async () => {
    if (!service || !printerName) {
      if (await refreshDymo()) return processBatch()
      return
    }

    const { data: first, error: e1 } = await supabase
      .from('label_print_queue')
      .select('batch_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (e1) {
      log(`Supabase error: ${e1.message}`)
      return
    }
    if (!first?.batch_id) return

    const batchId = first.batch_id
    const { data: rows, error: e2 } = await supabase
      .from('label_print_queue')
      .select('*')
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (e2 || !rows?.length) return

    const po = rows[0].po_number
    log(`Printing ${rows.length} label(s) for ${po}…`)

    await supabase
      .from('label_print_queue')
      .update({ status: 'printing' })
      .eq('batch_id', batchId)
      .eq('status', 'pending')

    try {
      for (const row of rows) {
        await printLabel(service, printerName, labelXmlForRow(row))
      }
      await supabase
        .from('label_print_queue')
        .update({ status: 'done', processed_at: new Date().toISOString(), error_message: null })
        .eq('batch_id', batchId)
        .eq('status', 'printing')
      log(`Done — ${rows.length} label(s) for ${po}.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`Print failed: ${msg}`)
      await supabase
        .from('label_print_queue')
        .update({
          status: 'failed',
          processed_at: new Date().toISOString(),
          error_message: msg,
        })
        .eq('batch_id', batchId)
        .in('status', ['pending', 'printing'])
      service = null
      printerName = null
    }
  }

  await processBatch()
  setInterval(processBatch, POLL_MS)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
