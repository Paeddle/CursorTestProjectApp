import type { PoItemLocation, PoLineItem } from '../types/poIpoint'

const CACHE_VERSION = 1
const CACHE_KEY = `po_ipoint_data_v${CACHE_VERSION}`
const CACHE_TTL_MS = 5 * 60 * 1000

type CachedPayload = {
  savedAt: number
  lineItems: PoLineItem[]
  itemLocations: PoItemLocation[]
}

function readRaw(): CachedPayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedPayload
    if (!parsed?.savedAt || !Array.isArray(parsed.lineItems) || !Array.isArray(parsed.itemLocations)) {
      return null
    }
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function readIpointCache(): CachedPayload | null {
  return readRaw()
}

export function writeIpointCache(lineItems: PoLineItem[], itemLocations: PoItemLocation[]): void {
  try {
    const payload: CachedPayload = {
      savedAt: Date.now(),
      lineItems,
      itemLocations,
    }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Quota or private mode — ignore
  }
}

export function clearIpointCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
}
