import { poLineItemKey } from './poLineCustomerOverride'

const LEGACY_STORAGE_KEY = 'po_line_checked_v1'

/** Read checks stored only in this browser (pre-Supabase). */
export function readLegacyLocalPoLineChecked(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
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

export function clearLegacyLocalPoLineChecked(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
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
  return next
}

export type PoLineCheckSummary = {
  checkedCount: number
  total: number
  allChecked: boolean
  someChecked: boolean
}

export function poLineCheckSummary(
  checked: Record<string, boolean>,
  poNumber: string,
  lines: { item_name: string }[]
): PoLineCheckSummary {
  const total = lines.length
  if (total === 0) {
    return { checkedCount: 0, total: 0, allChecked: false, someChecked: false }
  }
  let checkedCount = 0
  for (const line of lines) {
    if (isPoLineChecked(checked, poNumber, line.item_name)) checkedCount++
  }
  return {
    checkedCount,
    total,
    allChecked: checkedCount === total,
    someChecked: checkedCount > 0 && checkedCount < total,
  }
}

/** Check or uncheck every iPoint line on a PO (in-memory; persist via poLineCheckedService). */
export function setAllPoLinesChecked(
  checked: Record<string, boolean>,
  poNumber: string,
  lines: { item_name: string }[],
  value: boolean
): Record<string, boolean> {
  const next = { ...checked }
  for (const line of lines) {
    const key = poLineItemKey(poNumber, line.item_name)
    if (value) next[key] = true
    else delete next[key]
  }
  return next
}
