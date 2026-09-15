/** Same-origin unlock shared with home-app (client-side only). */
export const SHS_AUTH_KEY = 'shs_web_apps_unlocked'

/** QR / prefilled tag URLs stay public; the blank form and portal stay locked. */
export function isPublicReorderPath(pathname: string, search = ''): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)
  if (params.get('ipn') || params.get('sku') || params.get('s')) return true

  const segments = path.split('/').filter(Boolean).map((s) => s.toLowerCase())
  if (segments.length >= 2 && segments[segments.length - 2] === 'r') return true

  const last = segments[segments.length - 1]
  if (!last || last === 'reorder' || last === 'portal' || last === 'index.html') return false
  return segments.length >= 2
}

export function requireShsUnlock(): boolean {
  if (typeof window === 'undefined') return true
  if (isPublicReorderPath(window.location.pathname, window.location.search)) return true
  if (localStorage.getItem(SHS_AUTH_KEY) === '1') return true
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
  window.location.replace(`/?next=${next}`)
  return false
}
