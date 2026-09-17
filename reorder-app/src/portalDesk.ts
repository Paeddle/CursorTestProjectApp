export type PortalDesk = 'warehouse' | 'purchasing'

function categoryTokens(category: string | null | undefined): string[] {
  return (category ?? '')
    .toLowerCase()
    .split(/[/>\\|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function isPurchasingToken(token: string): boolean {
  return (
    token === 'inventory' ||
    token === 'security' ||
    token.startsWith('inventory ') ||
    token.startsWith('security ')
  )
}

export function isPurchasingCategory(category: string | null | undefined): boolean {
  return categoryTokens(category).some(isPurchasingToken)
}

export function portalDeskForCategory(category: string | null | undefined): PortalDesk {
  return isPurchasingCategory(category) ? 'purchasing' : 'warehouse'
}

export function portalDeskLabel(desk: PortalDesk): string {
  return desk === 'purchasing' ? 'Purchasing' : 'Warehouse'
}
