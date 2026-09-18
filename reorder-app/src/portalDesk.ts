export type PortalDesk = 'warehouse' | 'purchasing'

function normalizeCategory(category: string | null | undefined): string {
  return (category ?? '')
    .toLowerCase()
    .replace(/[_/\\|]+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNonInventory(normalized: string): boolean {
  return normalized.includes('non inventory') || normalized.includes('noninventory')
}

export function isPurchasingCategory(category: string | null | undefined): boolean {
  const normalized = normalizeCategory(category)
  if (!normalized) return false
  const stock = /\bstock\b/.test(normalized)
  const security = normalized.includes('security')
  if (isNonInventory(normalized)) {
    return stock && !security
  }
  if (!/\binventory\b/.test(normalized)) return false
  return security || stock
}

export function portalDeskForCategory(category: string | null | undefined): PortalDesk {
  return isPurchasingCategory(category) ? 'purchasing' : 'warehouse'
}

export function portalDeskLabel(desk: PortalDesk): string {
  return desk === 'purchasing' ? 'Purchasing' : 'Warehouse'
}
