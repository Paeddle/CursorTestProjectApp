import { poLineItemKey } from './poLineCustomerOverride'

const STORAGE_KEY = 'po_line_checked_v1'

export function readPoLineChecked(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v) out[k] = true
    }
    return out
  } catch {
    return {}
  }
}

export function isPoLineChecked(
  checked: Record<string, boolean>,
  poNumber: string,
  itemName: string
): boolean {
  return !!checked[poLineItemKey(poNumber, itemName)]
}

export function togglePoLineChecked(
  checked: Record<string, boolean>,
  poNumber: string,
  itemName: string
): Record<string, boolean> {
  const key = poLineItemKey(poNumber, itemName)
  const next = { ...checked }
  if (next[key]) delete next[key]
  else next[key] = true
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return next
}
