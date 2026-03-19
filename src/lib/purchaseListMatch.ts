import type { PullSuggestion } from '../types/purchaseList'

export function normalizeMatchKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\-_. ]/g, '')
}

type InvRow = {
  part_number: string | null
  item: string | null
  stock_available: number | null
}

type Hit = { label: string; stock_available: number; via: 'part_number' | 'item' }

/**
 * Build lookups for part_number and item (normalized keys).
 */
export function inventoryLookups(rows: InvRow[]): {
  byPart: Map<string, Hit>
  byItem: Map<string, Hit>
} {
  const byPart = new Map<string, Hit>()
  const byItem = new Map<string, Hit>()

  const put = (map: Map<string, Hit>, rawKey: string | null | undefined, hit: Hit) => {
    const raw = (rawKey || '').trim()
    if (!raw) return
    const key = normalizeMatchKey(raw)
    const prev = map.get(key)
    if (!prev || hit.stock_available > prev.stock_available) map.set(key, hit)
  }

  for (const r of rows) {
    const label = (r.part_number || r.item || '').trim()
    const avail = r.stock_available
    const n = avail != null && Number.isFinite(avail) ? avail : 0
    if ((r.part_number || '').trim()) {
      put(byPart, r.part_number, { label: (r.part_number || '').trim(), stock_available: n, via: 'part_number' })
    }
    if ((r.item || '').trim()) {
      put(byItem, r.item, { label, stock_available: n, via: 'item' })
    }
  }
  return { byPart, byItem }
}

export function comparePurchaseToInventory(
  purchaseParts: { part: string; required: number; job: string | null }[],
  inventoryRows: InvRow[]
): PullSuggestion[] {
  const { byPart, byItem } = inventoryLookups(inventoryRows)
  return purchaseParts.map((p) => {
    const key = normalizeMatchKey(p.part)
    const hit = byPart.get(key) ?? byItem.get(key)
    const stock = hit?.stock_available ?? null
    const can =
      stock == null ? 0 : Math.max(0, Math.min(p.required, stock))
    return {
      part: p.part,
      required: p.required,
      job: p.job,
      stock_available: stock,
      can_pull: can,
      match_type: hit ? hit.via : 'none',
      inventory_part_number: hit?.label ?? null,
    }
  })
}
