import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { requireShsUnlock } from './lib/shsAuth'
import './index.css'

if (requireShsUnlock()) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
