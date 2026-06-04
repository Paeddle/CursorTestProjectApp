/**
 * Download an image from a URL and store it in inventory-images for reliable label printing.
 * Invoke from the Inventory page: supabase.functions.invoke('inventory-image-import', { body })
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'inventory-images'

function extFromContentType(ct: string | null): string {
  if (!ct) return 'jpg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  return 'jpg'
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
    const body = (await req.json()) as { itemId?: string; inventoryId?: string; sourceUrl?: string }
    const itemId = (body.itemId ?? body.inventoryId ?? '').trim()
    const sourceUrl = (body.sourceUrl ?? '').trim()
    if (!itemId || !sourceUrl) {
      return new Response(JSON.stringify({ error: 'itemId and sourceUrl are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Server not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const imgRes = await fetch(sourceUrl, {
      headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'InventoryImageImport/1.0' },
    })
    if (!imgRes.ok) {
      return new Response(
        JSON.stringify({ error: `Could not download image (HTTP ${imgRes.status})` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    if (bytes.length < 32) {
      return new Response(JSON.stringify({ error: 'Downloaded file is too small to be an image' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (bytes.length > 8 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image is larger than 8 MB' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'
    const ext = extFromContentType(contentType)
    const path = `${itemId}/picture.${ext}`

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      upsert: true,
      contentType,
      cacheControl: '31536000',
    })
    if (uploadError) {
      return new Response(JSON.stringify({ error: uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: row, error: updateError } = await supabase
      .from('items')
      .update({ picture_path: path, picture_url: sourceUrl })
      .eq('id', itemId)
      .select('*')
      .single()

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)

    return new Response(
      JSON.stringify({ ok: true, picture_path: path, publicUrl: urlData.publicUrl, row }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
