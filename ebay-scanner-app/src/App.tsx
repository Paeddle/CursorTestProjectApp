import { useState, useCallback } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import BarcodeScanner from './components/BarcodeScanner'
import './App.css'

function App() {
  const [manualBarcode, setManualBarcode] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const clearStatus = useCallback(() => {
    setStatus(null)
  }, [])

  const showSuccess = (msg: string) => {
    setStatus({ type: 'success', message: msg })
    setTimeout(clearStatus, 3000)
  }

  const showError = (msg: string) => {
    setStatus({ type: 'error', message: msg })
  }

  const submitBarcode = useCallback(async (value: string) => {
    if (!supabase) {
      showError(
        'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and redeploy.'
      )
      return
    }
    const barcode = (value || '').trim()
    if (!barcode) return

    const { error } = await supabase.from('ebay_scans').insert({
      barcode_value: barcode,
      scanned_at: new Date().toISOString(),
    })

    if (error) {
      showError(error.message)
      return
    }
    showSuccess(`Saved for eBay: ${barcode}`)
    setManualBarcode('')
    setShowCamera(false)
  }, [])

  const openCamera = async () => {
    if (!isSupabaseConfigured || !supabase) {
      showError('Configure Supabase first, then redeploy.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showError('Camera requires HTTPS (or localhost). Open this app via https:// on your phone.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      stream.getTracks().forEach((t) => t.stop())
      setShowCamera(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        showError('Camera permission denied. Allow camera access in browser settings.')
      } else {
        showError(msg || 'Could not access camera.')
      }
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>eBay Item Scanner</h1>
        <p className="app-subtitle">Scan barcodes for items to sell on eBay</p>
      </header>

      <main className="app-main">
        {!isSupabaseConfigured || !supabase ? (
          <section className="section">
            <h2 className="section-title">Setup required</h2>
            <div className="status status-error">
              Add <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> in
              your host environment variables and redeploy. Also run{' '}
              <code>supabase/add-ebay-scans.sql</code> in Supabase SQL Editor.
            </div>
          </section>
        ) : null}

        {status && <div className={`status status-${status.type}`}>{status.message}</div>}

        <section className="section">
          <h2 className="section-title">Barcode</h2>
          <p className="hint">Each scan is logged to the eBay tab in the main app. Scan the same barcode multiple times to increase quantity.</p>
          <div className="barcode-actions">
            <input
              type="text"
              className="input barcode-input"
              placeholder="Enter barcode or scan below"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitBarcode(manualBarcode)}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submitBarcode(manualBarcode)}
              disabled={!manualBarcode.trim()}
            >
              Add barcode
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void openCamera()}>
              📷 Scan with camera
            </button>
          </div>
        </section>
      </main>

      {showCamera && <BarcodeScanner onScan={submitBarcode} onClose={() => setShowCamera(false)} />}
    </div>
  )
}

export default App
