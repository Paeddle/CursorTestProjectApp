import { createClient } from 'npm:@supabase/supabase-js@2'
import { google } from 'npm:googleapis@140'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ActionBody =
  | { action: 'sync' }
  | { action: 'set_ordered'; orderId: string; googleRowNumber: number; ordered: boolean }
  | { action: 'set_received'; orderId: string; googleRowNumber: number; received: boolean }

type SheetOrder = {
  google_row_number: number
  sheet_timestamp: string | null
  item_name: string | null
  part_number: string | null
  quantity: number | null
  item_url: string | null
  ordered: boolean
  received: boolean
}

type SheetSnapshot = {
  headers: string[]
  rows: string[][]
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function parseBoolCell(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  return ['true', 'yes', 'y', '1', 'ordered', 'received'].includes(normalized)
}

function parseNumberOrNull(value: unknown): number | null {
  const raw = String(value ?? '')
    .replace(/,/g, '')
    .trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function getSheetsClient() {
  const clientEmail = requiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL')
  const privateKey = requiredEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n')
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  await auth.authorize()
  return google.sheets({ version: 'v4', auth })
}

function getSupabaseAdmin() {
  const url = requiredEnv('SUPABASE_URL')
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, serviceRoleKey)
}

function getSheetConfig() {
  return {
    spreadsheetId: requiredEnv('GOOGLE_SHEETS_ID'),
    tabName: Deno.env.get('GOOGLE_SHEETS_TAB') || 'Raw Data',
  }
}

async function readRawDataRows(): Promise<SheetOrder[]> {
  const sheets = await getSheetsClient()
  const { spreadsheetId, tabName } = getSheetConfig()
  const range = `${tabName}!A1:Z`
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: 'ROWS',
  })

  const snapshot: SheetSnapshot = {
    headers: (response.data.values?.[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase()),
    rows: (response.data.values ?? []).slice(1).map((r) => r.map((c) => String(c ?? ''))),
  }
  const idxTimestamp = snapshot.headers.indexOf('timestamp')
  const idxItemName = snapshot.headers.indexOf('item name')
  const idxPartNumber = snapshot.headers.indexOf('part number')
  const idxQuantity = snapshot.headers.indexOf('quantity')
  const idxUrl = snapshot.headers.indexOf('url')
  const idxOrdered = snapshot.headers.indexOf('ordered')
  const idxReceived = snapshot.headers.indexOf('received')

  if ([idxTimestamp, idxItemName, idxPartNumber, idxQuantity, idxUrl, idxOrdered, idxReceived].some((v) => v < 0)) {
    throw new Error('Raw Data tab is missing one or more expected headers: Timestamp, Item Name, Part Number, Quantity, URL, Ordered, Received')
  }

  const rows = snapshot.rows
  const out: SheetOrder[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const google_row_number = i + 2
    const sheet_timestamp = (row[idxTimestamp] ?? '').toString().trim() || null
    const item_name = (row[idxItemName] ?? '').toString().trim() || null
    const part_number = (row[idxPartNumber] ?? '').toString().trim() || null
    const quantity = parseNumberOrNull(row[idxQuantity])
    const item_url = (row[idxUrl] ?? '').toString().trim() || null
    const ordered = parseBoolCell(row[idxOrdered])
    const received = parseBoolCell(row[idxReceived])

    const hasData = Boolean(sheet_timestamp || item_name || part_number || quantity !== null || item_url)
    if (!hasData) continue

    out.push({
      google_row_number,
      sheet_timestamp,
      item_name,
      part_number,
      quantity,
      item_url,
      ordered,
      received,
    })
  }
  return out
}

async function syncSheetToSupabase() {
  const supabase = getSupabaseAdmin()
  const rows = await readRawDataRows()
  const rowNumbers = rows.map((r) => r.google_row_number)

  let inserted = 0
  let updated = 0
  if (rows.length > 0) {
    const { data: existingRows, error: existingError } = await supabase
      .from('non_inventory_orders')
      .select('google_row_number')
      .in('google_row_number', rowNumbers)
    if (existingError) throw new Error(existingError.message)
    const existingSet = new Set((existingRows ?? []).map((r) => Number(r.google_row_number)))
    inserted = rows.filter((r) => !existingSet.has(r.google_row_number)).length
    updated = rows.length - inserted

    const { error: upsertError } = await supabase
      .from('non_inventory_orders')
      .upsert(rows, { onConflict: 'google_row_number' })
    if (upsertError) throw new Error(upsertError.message)
  }

  const { data: allDbRows, error: allDbRowsError } = await supabase
    .from('non_inventory_orders')
    .select('id, google_row_number')
  if (allDbRowsError) throw new Error(allDbRowsError.message)

  const keepSet = new Set(rowNumbers)
  const staleIds = (allDbRows ?? [])
    .filter((r) => !keepSet.has(Number(r.google_row_number)))
    .map((r) => r.id as string)

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase.from('non_inventory_orders').delete().in('id', staleIds)
    if (deleteError) throw new Error(deleteError.message)
  }

  return { inserted, updated, deleted: staleIds.length }
}

async function updateSheetCheckbox(googleRowNumber: number, columnLetter: 'F' | 'G', value: boolean) {
  const sheets = await getSheetsClient()
  const { spreadsheetId, tabName } = getSheetConfig()
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A1:Z1`,
    majorDimension: 'ROWS',
  })
  const headers = (headerResponse.data.values?.[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase())
  const targetHeader = columnLetter === 'F' ? 'ordered' : 'received'
  const colIndex = headers.indexOf(targetHeader)
  if (colIndex < 0) {
    throw new Error(`Could not find "${targetHeader}" column in Raw Data tab`)
  }
  const resolvedColumn = columnIndexToLetter(colIndex)
  const range = `${tabName}!${resolvedColumn}${googleRowNumber}`
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value ? 'TRUE' : 'FALSE']] },
  })
}

function columnIndexToLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

async function deleteSheetRow(googleRowNumber: number) {
  const sheets = await getSheetsClient()
  const { spreadsheetId } = getSheetConfig()
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: Number(requiredEnv('GOOGLE_RAW_DATA_SHEET_GID')),
              dimension: 'ROWS',
              startIndex: googleRowNumber - 1,
              endIndex: googleRowNumber,
            },
          },
        },
      ],
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = (await req.json()) as ActionBody
    const action = body.action

    if (action === 'sync') {
      const result = await syncSheetToSupabase()
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'set_ordered') {
      await updateSheetCheckbox(body.googleRowNumber, 'F', body.ordered)
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('non_inventory_orders')
        .update({ ordered: body.ordered })
        .eq('id', body.orderId)
      if (error) throw new Error(error.message)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'set_received') {
      if (body.received) {
        await deleteSheetRow(body.googleRowNumber)
        const result = await syncSheetToSupabase()
        return new Response(JSON.stringify({ ok: true, removed: true, ...result }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      await updateSheetCheckbox(body.googleRowNumber, 'G', false)
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('non_inventory_orders')
        .update({ received: false })
        .eq('id', body.orderId)
      if (error) throw new Error(error.message)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unsupported action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('non-inventory-orders-sync failed:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
