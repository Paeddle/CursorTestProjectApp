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
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q, num }),
  })
  if (!res.ok) return []
  const data = (await res.json()) as { organic?: SerperOrganicResult[] }
  return data.organic ?? []
}

export async function serperImageSearch(
  query: string,
  apiKey: string,
  num = 6
): Promise<SerperImageResult[]> {
  const q = query.trim()
  if (!q || !apiKey) return []
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q, num }),
  })
  if (!res.ok) return []
  const data = (await res.json()) as { images?: SerperImageResult[] }
  return data.images ?? []
}
