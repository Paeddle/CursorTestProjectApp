import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import AppPasswordGate from './components/AppPasswordGate.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <AppPasswordGate>
          <App />
        </AppPasswordGate>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
)




