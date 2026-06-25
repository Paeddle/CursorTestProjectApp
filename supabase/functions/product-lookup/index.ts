/**
 * Server-side product lookup proxy — avoids browser CORS blocks on UPCitemdb, Serper, and Jina.
 * Invoke: supabase.functions.invoke('product-lookup', { body: { action, ... } })
 *
 * Optional Supabase secrets (Dashboard → Edge Functions → Secrets):
 *   SERPER_API_KEY, UPCITEMDB_USER_KEY
 * Client may also pass serperApiKey / upcUserKey in the request body as fallback.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body = {
  action?: string
  query?: string
  barcode?: string
  url?: string
  partHint?: string | null
  num?: number
  serperApiKey?: string
  upcUserKey?: string
}

function jinaFetchUrl(targetUrl: string): string {
  const trimmed = targetUrl.trim()
  if (trimmed.startsWith('http://')) return `https://r.jina.ai/http://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('https://')) return `https://r.jina.ai/http://${trimmed.slice('https://'.length)}`
  return `https://r.jina.ai/http://${trimmed}`
}

function extractMetaContent(htmlText: string, key: string): string | null {
  const re = new RegExp(
    `<meta\\s+[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  )
  const m = htmlText.match(re)
  return m?.[1]?.trim() || null
}

function extractTitle(htmlText: string): string | null {
  const m = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m?.[1]?.trim() || null
}

async function upcFetch(path: string, upcUserKey: string | undefined): Promise<unknown | null> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (upcUserKey) headers.user_key = upcUserKey
  const res = await fetch(`https://api.upcitemdb.com${path}`, { headers })
  if (!res.ok) return null
  return res.json()
}

async function serperPost(
  endpoint: 'search' | 'images',
  query: string,
  num: number,
  apiKey: string
): Promise<unknown | null> {
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num }),
  })
  if (!res.ok) return null
  return res.json()
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
    const body = (await req.json()) as Body
    const action = (body.action ?? '').trim()
    const serperKey = (Deno.env.get('SERPER_API_KEY') ?? body.serperApiKey ?? '').trim()
    const upcKey = (Deno.env.get('UPCITEMDB_USER_KEY') ?? body.upcUserKey ?? '').trim() || undefined

    if (action === 'upc_lookup') {
      const code = (body.barcode ?? '').replace(/\D/g, '')
      if (!code) {
        return new Response(JSON.stringify({ error: 'barcode required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const tier = upcKey ? 'prod' : 'trial'
      const data = await upcFetch(`/${tier}/v1/lookup?upc=${encodeURIComponent(code)}`, upcKey)
      return new Response(JSON.stringify(data ?? { items: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'upc_search') {
      const q = (body.query ?? '').trim()
      if (!q) {
        return new Response(JSON.stringify({ error: 'query required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const tier = upcKey ? 'prod' : 'trial'
      const data = await upcFetch(`/${tier}/v1/search?s=${encodeURIComponent(q)}`, upcKey)
      return new Response(JSON.stringify(data ?? { items: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'serper_search') {
      const q = (body.query ?? '').trim()
      if (!q) {
        return new Response(JSON.stringify({ error: 'query required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!serperKey) {
        return new Response(JSON.stringify({ error: 'Serper API key not configured' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const data = await serperPost('search', q, body.num ?? 8, serperKey)
      return new Response(JSON.stringify(data ?? { organic: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'serper_images') {
      const q = (body.query ?? '').trim()
      if (!q) {
        return new Response(JSON.stringify({ error: 'query required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!serperKey) {
        return new Response(JSON.stringify({ error: 'Serper API key not configured' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const data = await serperPost('images', q, body.num ?? 6, serperKey)
      return new Response(JSON.stringify(data ?? { images: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'page_meta') {
      const pageUrl = (body.url ?? '').trim()
      if (!pageUrl) {
        return new Response(JSON.stringify({ error: 'url required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const res = await fetch(jinaFetchUrl(pageUrl), { headers: { Accept: 'text/plain' } })
      if (!res.ok) {
        return new Response(
          JSON.stringify({
            title: null,
            cleanTitle: null,
            imageUrl: null,
            partNumber: null,
            manufacturer: null,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const text = await res.text()
      const { parseProductPageFromHtml } = await import('../_shared/productPageExtract.ts')
      const details = parseProductPageFromHtml(text, pageUrl, body.partHint ?? null)
      return new Response(JSON.stringify(details), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
