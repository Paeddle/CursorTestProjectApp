import { invokeProductLookup, safeFetchJson } from './lookupProxy'

export type SerperOrganicResult = {
  title?: string
  snippet?: string
  link?: string
}

export type SerperImageResult = {
  title?: string
  imageUrl?: string
  link?: string
}

export async function serperWebSearch(
  query: string,
  apiKey: string,
  num = 8
): Promise<SerperOrganicResult[]> {
  const q = query.trim()
  if (!q || !apiKey) return []

  const proxied = await invokeProductLookup<{ organic?: SerperOrganicResult[] }>('serper_search', {
    query: q,
    num,
  })
  if (proxied?.organic) return proxied.organic

  const data = await safeFetchJson<{ organic?: SerperOrganicResult[] }>(
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q, num }),
    }
  )
  return data?.organic ?? []
}

export async function serperImageSearch(
  query: string,
  apiKey: string,
  num = 6
): Promise<SerperImageResult[]> {
  const q = query.trim()
  if (!q || !apiKey) return []

  const proxied = await invokeProductLookup<{ images?: SerperImageResult[] }>('serper_images', {
    query: q,
    num,
  })
  if (proxied?.images) return proxied.images

  const data = await safeFetchJson<{ images?: SerperImageResult[] }>(
    'https://google.serper.dev/images',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q, num }),
    }
  )
  return data?.images ?? []
}
