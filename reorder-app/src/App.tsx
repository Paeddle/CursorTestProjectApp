import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import RequestFormPage from './pages/RequestFormPage'
import PortalPage from './pages/PortalPage'
import { SHS_AUTH_KEY, isPublicReorderPath } from './lib/shsAuth'

function RequireShsUnlock({ children }: { children: ReactNode }) {
  const location = useLocation()
  const allowed =
    typeof window !== 'undefined' &&
    (isPublicReorderPath(window.location.pathname, window.location.search) ||
      localStorage.getItem(SHS_AUTH_KEY) === '1')

  useEffect(() => {
    if (allowed) return
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const next = encodeURIComponent(`${base}${location.pathname}${location.search}${location.hash}`)
    window.location.replace(`/?next=${next}`)
  }, [allowed, location.hash, location.pathname, location.search])

  if (!allowed) return null
  return children
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <Routes>
        <Route
          path="/"
          element={
            <RequireShsUnlock>
              <RequestFormPage />
            </RequireShsUnlock>
          }
        />
        <Route
          path="/portal"
          element={
            <RequireShsUnlock>
              <PortalPage />
            </RequireShsUnlock>
          }
        />
        <Route path="/scan" element={<RequestFormPage />} />
        <Route path="/r/:ipn" element={<RequestFormPage />} />
        <Route path="/:ipn" element={<RequestFormPage />} />
      </Routes>
    </BrowserRouter>
  )
}
