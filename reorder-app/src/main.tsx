import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { requireShsUnlock } from './lib/shsAuth'
import './index.css'

if (requireShsUnlock()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
