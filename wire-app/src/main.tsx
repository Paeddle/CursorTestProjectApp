import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WirePage } from './WirePage'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WirePage />
  </StrictMode>
)
