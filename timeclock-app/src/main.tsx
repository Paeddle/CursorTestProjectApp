import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { stabilizeShell } from './lib/shell'
import './index.css'

stabilizeShell()

function Root() {
  const [boot, setBoot] = useState(0)

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBoot((value) => value + 1)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  return <App key={boot} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
