/**
 * Warehouse print agent — runs on the laptop with DYMO Connect (no browser CORS).
 * Polls Supabase label_print_queue and prints via https://127.0.0.1:41951+.
 *
 * Usage (from repo root): npm run print-agent
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { assertDymoPrintSucceeded, buildLabelXmlForRow } from './dymo-label-xml.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
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

async function dymoRequest(host, port, endpoint, method = 'GET', form = null) {
  const url = `https://${host}:${port}/DYMO/DLS/Printing/${endpoint}`
  const init = { method }
  if (form) {
    init.body = new URLSearchParams(form)
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await fetch(url, init)
  const ct = res.headers.get('content-type') || ''
  const body = ct.includes('json') ? await res.json() : await res.text()
  if (!res.ok) {
    throw new Error(`${endpoint} HTTP ${res.status}: ${String(body).slice(0, 300)}`)
  }
  return body
}

async function findDymoService() {
  for (const host of ['127.0.0.1', 'localhost']) {
    for (let port = 41951; port <= 41960; port++) {
      try {
        await dymoRequest(host, port, 'StatusConnected')
        return { host, port }
      } catch {
        /* try next */
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
    if (m[2].trim().toLowerCase() === 'true') names.push(name)
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

async function getPrinterName(service) {
  const xml = await dymoRequest(service.host, service.port, 'GetPrinters')
  const names = parsePrinterNames(String(xml))
  if (names.length === 0) {
    throw new Error('No LabelWriter in DYMO Connect — open DYMO Connect and check USB.')
  }
  return names.find((n) => /labelwriter|dymo/i.test(n)) ?? names[0]
}

async function printLabel(service, printerName, labelXml) {
  const form = {
    printerName,
    labelXml,
    printParamsXml: '',
    labelSetXml: '',
  }
  let lastErr = null
  for (const endpoint of ['PrintLabel2', 'PrintLabel']) {
    try {
      const result = await dymoRequest(service.host, service.port, endpoint, 'POST', form)
      assertDymoPrintSucceeded(result, endpoint)
      return
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('Print failed')
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
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

  log('DYMO print agent — leave this running on the laptop with the LabelWriter.')
  log('Queue labels from PO Info on your tablet.')

  const refreshDymo = async () => {
    service = await findDymoService()
    if (!service) {
      printerName = null
      return false
    }
    printerName = await getPrinterName(service)
    log(`Ready: ${printerName} @ ${service.host}:${service.port}`)
    return true
  }

  if (!(await refreshDymo())) {
    log('Waiting for DYMO Connect…')
  }

  const processBatch = async () => {
    if (!service || !printerName) {
      if (await refreshDymo()) return processBatch()
      return
    }

    const { data: first, error: e1 } = await supabase
      .from('label_print_queue')
      .select('batch_id')
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (e1) {
      log(`Supabase: ${e1.message}`)
      return
    }
    if (!first?.batch_id) return

    const batchId = first.batch_id
    const { data: rows, error: e2 } = await supabase
      .from('label_print_queue')
      .select('*')
      .eq('batch_id', batchId)
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })

    if (e2 || !rows?.length) return

    const po = rows[0].po_number
    log(`Printing ${rows.length} label(s) for ${po}…`)

    await supabase
      .from('label_print_queue')
      .update({ status: 'printing', error_message: null })
      .eq('batch_id', batchId)
      .in('status', ['pending', 'failed'])

    try {
      for (const row of rows) {
        await printLabel(service, printerName, buildLabelXmlForRow(row))
      }
      await supabase
        .from('label_print_queue')
        .update({ status: 'done', processed_at: new Date().toISOString(), error_message: null })
        .eq('batch_id', batchId)
        .eq('status', 'printing')
      log(`Done — ${rows.length} label(s) for ${po}.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`FAILED: ${msg}`)
      await supabase
        .from('label_print_queue')
        .update({
          status: 'failed',
          processed_at: new Date().toISOString(),
          error_message: msg.slice(0, 500),
        })
        .eq('batch_id', batchId)
        .in('status', ['pending', 'printing', 'failed'])
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
