function appUrl(): string {
  const path = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : `${window.location.pathname}/`
  return `${path}${window.location.search}${window.location.hash}`
}

function isAppWindow(): boolean {
  return window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)').matches
}

/** Keep /timeclock and /timeclock/ as one page so Back does not open a blank copy. */
export function stabilizeShell(): void {
  const url = appUrl()
  window.history.replaceState({ timeclock: 1 }, '', url)

  // Direct opens (new tab, home-screen icon) have an empty page behind this one.
  if (!isAppWindow() && document.referrer) return

  window.history.pushState({ timeclock: 1 }, '', url)
  window.addEventListener('popstate', () => {
    window.history.pushState({ timeclock: 1 }, '', url)
  })
}
