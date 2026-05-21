import { normalizePoKey } from './poIpointMatch'

const STORAGE_KEY = 'po_line_customer_override_v1'

function normItem(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Stable key for PO + item (customer assignment is per item on a PO). */
export function poLineItemKey(poNumber: string, itemName: string): string {
  return `${normalizePoKey(poNumber)}|${normItem(itemName)}`
}

/** DB columns for shared iPoint line checked state. */
export function poLineItemDbKeys(
  poNumber: string,
  itemName: string
): { po_key: string; item_key: string } {
  return {
    po_key: normalizePoKey(poNumber),
    item_key: normItem(itemName),
  }
}

export function readPoLineCustomerOverrides(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writePoLineCustomerOverride(
  poNumber: string,
  itemName: string,
  jobOrCustomer: string
): Record<string, string> {
  const key = poLineItemKey(poNumber, itemName)
  const all = readPoLineCustomerOverrides()
  all[key] = jobOrCustomer.trim()
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }
  return all
}

export function clearLegacyLocalCustomerOverrides(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function clearPoLineCustomerOverride(poNumber: string, itemName: string): Record<string, string> {
  const key = poLineItemKey(poNumber, itemName)
  const all = readPoLineCustomerOverrides()
  delete all[key]
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }
  return all
}
