/** Same-origin unlock shared with home-app (client-side only). */
export const SHS_AUTH_KEY = 'shs_web_apps_unlocked'

export function requireShsUnlock(): boolean {
  if (typeof window === 'undefined') return true
  if (localStorage.getItem(SHS_AUTH_KEY) === '1') return true
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
  window.location.replace(`/?next=${next}`)
  return false
}
