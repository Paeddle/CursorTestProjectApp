import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ShsAppNav from './ShsAppNav'
import { WirePage } from './WirePage'
import { requireShsUnlock } from './lib/shsAuth'
import './index.css'

if (requireShsUnlock()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="shs-app-shell">
        <ShsAppNav current="wire" />
        <div className="shs-app-shell-body">
          <WirePage />
        </div>
      </div>
    </StrictMode>
  )
}
