/**
 * Rebuilds a CSV of all wire boxes (box_id + wire_type + spool size + metadata) and
 * uploads it to Microsoft OneDrive / SharePoint via Microsoft Graph.
 *
 * Trigger: Supabase Database Webhook on public.wire_box_scans INSERT (see setup below).
 *
 * SETUP (summary):
 * 1. Azure: App registration → Certificates & secrets → client secret.
 *    API permissions (Application): Files.ReadWrite.All or Sites.Selected as your admin allows.
 *    Grant admin consent.
 * 2. OneDrive: create folder (e.g. WireInventory) under the target user's Files; note path.
 * 3. Supabase Dashboard → Project Settings → Edge Functions → Secrets:
 *      SUPABASE_SERVICE_ROLE_KEY, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET,
 *      GRAPH_ONEDRIVE_USER_UPN, ONEDRIVE_INVENTORY_PATH, WIRE_INVENTORY_WEBHOOK_SECRET
 *    (SUPABASE_URL is provided automatically.)
 * 4. Deploy: supabase functions deploy sync-wire-inventory --project-ref YOUR_REF
 * 5. Database → Webhooks → New: table wire_box_scans, event INSERT,
 *    URL: https://YOUR_REF.supabase.co/functions/v1/sync-wire-inventory
 *    HTTP Header: x-wire-inventory-secret: <same as WIRE_INVENTORY_WEBHOOK_SECRET>
 *
 * Only rows with non-null wire_type are included in the export. Latest scan per box wins.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-wire-inventory-secret',
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

  const expected = Deno.env.get('WIRE_INVENTORY_WEBHOOK_SECRET')
  const provided = req.headers.get('x-wire-inventory-secret')
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const record = body?.record ?? body
    if (body?.type === 'INSERT' && record && (!record.wire_type || String(record.wire_type).trim() === '')) {
      return new Response(JSON.stringify({ ok: true, skipped: 'insert has no wire_type' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const csv = await buildInventoryCsv()
    await uploadCsvToOneDrive(csv)

    return new Response(JSON.stringify({ ok: true, bytes: csv.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('sync-wire-inventory failed:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function buildInventoryCsv(): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(url, key)
  const { data: rows, error } = await supabase
    .from('wire_box_scans')
    .select(
      'id, box_id, wire_type, wire_type_label, wire_type_default_ft, spool_capacity_ft, job_name, check_type, scanned_at',
    )
    .not('wire_type', 'is', null)
    .order('scanned_at', { ascending: false })

  if (error) throw new Error(error.message)

  const byBox = new Map<
    string,
    {
      id: string
      box_id: string
      wire_type: string
      wire_type_label: string | null
      wire_type_default_ft: string | null
      spool_capacity_ft: string | null
      job_name: string
      check_type: string | null
      scanned_at: string
    }
  >()

  for (const row of rows ?? []) {
    const bid = String(row.box_id ?? '').trim().toLowerCase()
    const wt = String(row.wire_type ?? '').trim()
    if (!bid || !wt) continue
    if (!byBox.has(bid)) {
      byBox.set(bid, {
        id: String(row.id),
        box_id: String(row.box_id).trim(),
        wire_type: wt,
        wire_type_label: row.wire_type_label != null ? String(row.wire_type_label) : null,
        wire_type_default_ft:
          row.wire_type_default_ft != null ? String(row.wire_type_default_ft) : null,
        spool_capacity_ft: row.spool_capacity_ft != null ? String(row.spool_capacity_ft) : null,
        job_name: String(row.job_name ?? ''),
        check_type: row.check_type != null ? String(row.check_type) : null,
        scanned_at: String(row.scanned_at ?? ''),
      })
    }
  }

  const header = [
    'box_id',
    'wire_type',
    'wire_type_label',
    'wire_type_default_ft',
    'spool_capacity_ft',
    'job_name',
    'last_scanned_at',
    'check_type',
    'scan_id',
  ].join(',')

  const sorted = [...byBox.values()].sort((a, b) =>
    a.box_id.localeCompare(b.box_id, undefined, { numeric: true, sensitivity: 'base' }),
  )

  const lines = sorted.map((r) =>
    [
      escapeCsvField(r.box_id),
      escapeCsvField(r.wire_type),
      escapeCsvField(r.wire_type_label),
      escapeCsvField(r.wire_type_default_ft),
      escapeCsvField(r.spool_capacity_ft),
      escapeCsvField(r.job_name),
      escapeCsvField(r.scanned_at),
      escapeCsvField(r.check_type),
      escapeCsvField(r.id),
    ].join(','),
  )

  return '\uFEFF' + [header, ...lines].join('\n') + '\n'
}

async function getGraphAppToken(): Promise<string> {
  const tenant = Deno.env.get('GRAPH_TENANT_ID')
  const clientId = Deno.env.get('GRAPH_CLIENT_ID')
  const secret = Deno.env.get('GRAPH_CLIENT_SECRET')
  if (!tenant || !clientId || !secret) {
    throw new Error('Missing GRAPH_TENANT_ID, GRAPH_CLIENT_ID, or GRAPH_CLIENT_SECRET')
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph token failed ${res.status}: ${t.slice(0, 500)}`)
  }

  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('No access_token from Graph')
  return json.access_token
}

function encodeGraphDrivePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

async function uploadCsvToOneDrive(csv: string): Promise<void> {
  const upn = Deno.env.get('GRAPH_ONEDRIVE_USER_UPN')
  const relativePath = Deno.env.get('ONEDRIVE_INVENTORY_PATH')
  if (!upn || !relativePath) {
    throw new Error('Missing GRAPH_ONEDRIVE_USER_UPN or ONEDRIVE_INVENTORY_PATH')
  }

  const pathEnc = encodeGraphDrivePath(relativePath.trim().replace(/^\/+/, ''))
  const userSeg = encodeURIComponent(upn.trim())
  const putUrl =
    `https://graph.microsoft.com/v1.0/users/${userSeg}/drive/root:/${pathEnc}:/content`

  const token = await getGraphAppToken()
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/csv; charset=utf-8',
    },
    body: csv,
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph upload failed ${res.status}: ${t.slice(0, 800)}`)
  }
}
