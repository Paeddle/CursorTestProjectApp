/**
 * Rebuilds a full CSV of every box that has a wire_type (latest profile row per box) and
 * **replaces** the same OneDrive file via Microsoft Graph PUT. Each qualifying DB event produces
 * a new file snapshot with all boxes (not an append-only log).
 *
 * Trigger: Supabase Database Webhooks on public.wire_box_scans — INSERT, UPDATE, DELETE.
 * See supabase/ONEDRIVE_WIRE_CSV_SETUP.txt for full steps.
 *
 * Skip (no upload): INSERT without wire_type; UPDATE where neither old nor new row has wire_type;
 * DELETE of a row that had no wire_type.
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
    const body = (await req.json().catch(() => ({}))) as {
      type?: string
      record?: Record<string, unknown> | null
      old_record?: Record<string, unknown> | null
    }

    const hasWireType = (row: Record<string, unknown> | null | undefined): boolean => {
      const wt = row?.wire_type
      return typeof wt === 'string' && wt.trim() !== ''
    }

    const evt = body?.type
    const record = body?.record
    const oldRecord = body?.old_record

    if (evt === 'INSERT') {
      if (!hasWireType(record)) {
        return new Response(JSON.stringify({ ok: true, skipped: 'insert has no wire_type' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    } else if (evt === 'UPDATE') {
      if (!hasWireType(record) && !hasWireType(oldRecord)) {
        return new Response(
          JSON.stringify({ ok: true, skipped: 'update did not involve wire_type rows' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    } else if (evt === 'DELETE') {
      if (!hasWireType(oldRecord)) {
        return new Response(JSON.stringify({ ok: true, skipped: 'deleted row had no wire_type' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
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
      'id, box_id, wire_type, wire_type_label, spool_capacity_ft, job_name, check_type, scanned_at',
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
