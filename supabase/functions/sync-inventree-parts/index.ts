import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function emptyToNull(value: unknown): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function partToRecord(part: Record<string, unknown>) {
  const inventreeId = Number(part.pk ?? part.id)
  if (!Number.isFinite(inventreeId)) return null
  const name = emptyToNull(part.name)
  if (!name) return null
  const categoryDetail = (part.category_detail ?? {}) as Record<string, unknown>
  const category =
    emptyToNull(categoryDetail.name) ||
    emptyToNull(categoryDetail.pathstring) ||
    emptyToNull(part.category_name)

  return {
    inventree_id: inventreeId,
    name,
    creation_date: emptyToNull(part.creation_date)?.slice(0, 10) ?? null,
    active: part.active !== false,
    barcode_hash: emptyToNull(part.barcode_hash),
    category_name: category,
    ipn: emptyToNull(part.IPN ?? part.ipn),
    link: emptyToNull(part.link),
    maximum_stock: parseNumber(part.maximum_stock ?? part.ordering),
    synced_at: new Date().toISOString(),
  }
}

async function fetchAllParts(baseUrl: string, token: string) {
  const headers = {
    Authorization: `Token ${token}`,
    Accept: 'application/json',
  }
  const records: ReturnType<typeof partToRecord>[] = []
  let next: string | null = `${baseUrl.replace(/\/$/, '')}/api/part/?limit=100&category_detail=true`

  while (next) {
    const res = await fetch(next, { headers })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`InvenTree ${res.status}: ${body.slice(0, 400)}`)
    }
    const json = await res.json()
    const rows = Array.isArray(json) ? json : json.results ?? []
    for (const row of rows) {
      const rec = partToRecord(row as Record<string, unknown>)
      if (rec) records.push(rec)
    }
    next = Array.isArray(json) ? null : json.next ?? null
  }

  return records.filter(Boolean)
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
    const inventreeUrl = Deno.env.get('INVENTREE_BASE_URL')
    const inventreeToken = Deno.env.get('INVENTREE_API_TOKEN')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!inventreeUrl || !inventreeToken) {
      throw new Error('Missing INVENTREE_BASE_URL or INVENTREE_API_TOKEN on the function.')
    }
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    }

    const records = await fetchAllParts(inventreeUrl, inventreeToken)
    const supabase = createClient(supabaseUrl, serviceKey)
    const batchSize = 100
    let upserted = 0
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { error } = await supabase.from('inventree_parts').upsert(batch, {
        onConflict: 'inventree_id',
      })
      if (error) throw new Error(error.message)
      upserted += batch.length
    }

    return new Response(JSON.stringify({ ok: true, count: upserted }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
