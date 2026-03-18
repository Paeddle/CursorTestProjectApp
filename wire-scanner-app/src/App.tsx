import { useState, useCallback } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import QRScanner from './components/QRScanner'
import './App.css'

// Accept box IDs like bx-1234, BX-5678, wire-99, etc. (letters, numbers, hyphens)
function normalizeBoxId(raw: string): string {
  return raw.trim()
}

function isValidBoxIdFormat(id: string): boolean {
  if (!id) return false
  return /^[a-zA-Z0-9]+-[a-zA-Z0-9]+$/.test(id) || /^[a-zA-Z][a-zA-Z0-9-]*\d+$/.test(id)
}

function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [boxId, setBoxId] = useState('')
  const [jobName, setJobName] = useState('')
  const [currentFootage, setCurrentFootage] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const clearStatus = useCallback(() => setStatus(null), [])

  const showSuccess = (msg: string) => {
    setStatus({ type: 'success', message: msg })
    setTimeout(clearStatus, 4000)
  }

  const showError = (msg: string) => {
    setStatus({ type: 'error', message: msg })
  }

  const handleQRScanned = useCallback((value: string) => {
    const id = normalizeBoxId(value)
    if (!id) return
    setBoxId(id)
    setShowScanner(false)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      showError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }
    const id = normalizeBoxId(boxId)
    const job = (jobName || '').trim()
    const footage = (currentFootage || '').trim()
    if (!id) {
      showError('Scan a QR code first.')
      return
    }
    if (!job) {
      showError('Enter a job name.')
      return
    }
    if (!footage) {
      showError('Enter current footage.')
      return
    }

    setSubmitting(true)
    setStatus(null)
    try {
      const { error } = await supabase.from('wire_box_scans').insert({
        box_id: id,
        job_name: job,
        current_footage: footage,
        scanned_at: new Date().toISOString(),
      })
      if (error) {
        showError(error.message)
        return
      }
      showSuccess(`Saved: ${id} — ${job} — ${footage} ft`)
      setBoxId('')
      setJobName('')
      setCurrentFootage('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleScanAnother = () => {
    setBoxId('')
    setJobName('')
    setCurrentFootage('')
    setStatus(null)
    setShowScanner(true)
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Wire Box Scanner</h1>
          <p className="app-subtitle">Scan wire box QR codes and log job + footage</p>
        </header>
        <div className="section section-error">
          <p>Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your host&apos;s environment variables (e.g. DigitalOcean app env) and redeploy.</p>
          <p className="hint">Run <code>supabase/add-wire-box-scans.sql</code> in the Supabase SQL Editor to create the <code>wire_box_scans</code> table.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Wire Box Scanner</h1>
        <p className="app-subtitle">Scan the QR code on the wire box, then enter job name and current footage.</p>
      </header>

      {status && (
        <div className={`status status-${status.type}`}>
          {status.message}
        </div>
      )}

      <main className="app-main">
        {!boxId ? (
          <section className="section">
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={() => setShowScanner(true)}
            >
              Scan QR code
            </button>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="section form-section">
            <div className="form-field">
              <label className="label">Box ID</label>
              <div className="box-id-display">{boxId}</div>
              {!isValidBoxIdFormat(boxId) && (
                <p className="field-hint">Expected format like bx-1234</p>
              )}
            </div>
            <div className="form-field">
              <label className="label" htmlFor="job-name">Job name</label>
              <input
                id="job-name"
                type="text"
                className="input"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g. Smith Residence"
                autoComplete="off"
              />
            </div>
            <div className="form-field">
              <label className="label" htmlFor="current-footage">Current footage</label>
              <input
                id="current-footage"
                type="text"
                className="input"
                value={currentFootage}
                onChange={(e) => setCurrentFootage(e.target.value)}
                placeholder="e.g. 250 or 125.5"
                autoComplete="off"
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleScanAnother}
                disabled={submitting}
              >
                Scan another
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </main>

      {showScanner && (
        <QRScanner
          onScan={handleQRScanned}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}

export default App
