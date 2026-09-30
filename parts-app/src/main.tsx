import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ShsAppNav from './ShsAppNav'
import { PartsPage } from './PartsPage'
import { requireShsUnlock } from './lib/shsAuth'
import './index.css'

if (requireShsUnlock()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="shs-app-shell">
        <ShsAppNav current="parts" />
        <div className="shs-app-shell-body">
          <PartsPage />
        </div>
      </div>
    </StrictMode>,
  )
}
