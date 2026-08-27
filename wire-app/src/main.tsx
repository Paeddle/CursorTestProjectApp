import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WirePage } from './WirePage'
import { requireShsUnlock } from './lib/shsAuth'
import './index.css'

if (requireShsUnlock()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WirePage />
    </StrictMode>
  )
}
