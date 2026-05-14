import type { BarcodeCatalogItem, POBarcode } from '../types/poCheckin'

export type AggregatedPOBarcodeRow = {
  barcode_value: string
  quantity: number
  scan_ids: string[]
  last_scanned_at: string
}

export function aggregatePOBarcodeScans(barcodes: POBarcode[]): AggregatedPOBarcodeRow[] {
  const map = new Map<string, { ids: string[]; lastAt: string; value: string }>()
  for (const b of barcodes) {
    const v = normalizeBarcodeValue(b.barcode_value || '')
    if (!v) continue
    const cur = map.get(v)
    const t = b.scanned_at
    if (!cur) {
      map.set(v, { ids: [b.id], lastAt: t, value: v })
    } else {
      cur.ids.push(b.id)
      if (new Date(t).getTime() > new Date(cur.lastAt).getTime()) cur.lastAt = t
    }
  }
  return [...map.values()]
    .map(({ value, ids, lastAt }) => ({
      barcode_value: value,
      quantity: ids.length,
      scan_ids: ids,
      last_scanned_at: lastAt,
    }))
    .sort((a, b) => new Date(b.last_scanned_at).getTime() - new Date(a.last_scanned_at).getTime())
}

export function normalizeBarcodeValue(v: string): string {
  return (v || '').trim()
}

export function barcodeLookupKeys(raw: string): string[] {
  const t = normalizeBarcodeValue(raw)
  if (!t) return []
  const digits = t.replace(/[^\d]/g, '')
  const keys = new Set<string>()
  keys.add(t)
  keys.add(t.toLowerCase())
  if (digits) keys.add(digits)
  return [...keys]
}

/** Map keys (raw, lower, digits) → catalog row for fast lookup. */
export function buildCatalogLookupMap(items: BarcodeCatalogItem[]): Map<string, BarcodeCatalogItem> {
  const m = new Map<string, BarcodeCatalogItem>()
  for (const c of items) {
    const row = c.barcode_value?.trim()
    if (!row) continue
    for (const k of barcodeLookupKeys(row)) {
      if (!m.has(k)) m.set(k, c)
    }
  }
  return m
}

export function lookupCatalogItem(map: Map<string, BarcodeCatalogItem>, barcode: string): BarcodeCatalogItem | undefined {
  for (const k of barcodeLookupKeys(barcode)) {
    const hit = map.get(k)
    if (hit) return hit
  }
  return undefined
}

export function barcodesMatch(a: string, b: string): boolean {
  const sa = barcodeLookupKeys(a)
  const sb = new Set(barcodeLookupKeys(b))
  return sa.some((k) => sb.has(k))
}
