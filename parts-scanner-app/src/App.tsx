import { useCallback, useEffect, useState, type FormEvent } from 'react'
import BarcodeScanner from './components/BarcodeScanner'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { displayPartTitle, fieldsFromRecord, todayLocalDate } from './partsHelpers'
import { findExistingPart, insertCheckIn, insertPartIfMissing } from './services/partsService'
import { EMPTY_PART_FIELDS, PART_FIELD_LABELS, type PartFields } from './types'
import './App.css'

function stripScanPrefixes(raw: string): string {
  return raw.trim().replace(/^(URL|URI)\s*:\s*/i, '').trim()
}

function extractBarcode(value: string): string {
  const raw = stripScanPrefixes(value || '')
  if (!raw) return ''
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw)
      const fromQuery = url.searchParams.get('upc') || url.searchParams.get('code') || url.searchParams.get('barcode')
      if (fromQuery) return fromQuery.trim()
    }
  } catch {
    /* ignore */
  }
  return raw
}

export default function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [fields, setFields] = useState<PartFields>(EMPTY_PART_FIELDS)
  const [checkInDate, setCheckInDate] = useState(todayLocalDate)
  const [existingTitle, setExistingTitle] = useState<string | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [manualBarcode, setManualBarcode] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const applyBarcode = useCallback(async (raw: string) => {
    const barcode = extractBarcode(raw)
    if (!barcode) return
    setShowScanner(false)
    setFormOpen(true)
    setStatus(null)
    setCheckInDate(todayLocalDate())
    setLookupLoading(true)
    const next: PartFields = { ...EMPTY_PART_FIELDS, upc_code: barcode }
    setFields(next)
    try {
      if (!supabase) {
        setExistingTitle(null)
        return
      }
      const existing = await findExistingPart(next)
      if (existing) {
        setFields({ ...fieldsFromRecord(existing), upc_code: existing.upc_code || barcode })
        setExistingTitle(displayPartTitle(existing))
      } else {
        setExistingTitle(null)
      }
    } catch (err) {
      setExistingTitle(null)
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not look up this barcode.',
      })
    } finally {
      setLookupLoading(false)
    }
  }, [])

  const handleScan = useCallback(
    (value: string) => {
      void applyBarcode(value)
    },
    [applyBarcode],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const upc = params.get('upc') || params.get('code') || params.get('barcode')
    if (upc) void applyBarcode(upc)
  }, [applyBarcode])

  const setField = (key: keyof PartFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }))
    if (key === 'upc_code' || key === 'ipn') setExistingTitle(null)
  }

  const resetForm = () => {
    setFields(EMPTY_PART_FIELDS)
    setCheckInDate(todayLocalDate())
    setExistingTitle(null)
    setFormOpen(false)
    setManualBarcode('')
  }

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (manualBarcode.trim()) void applyBarcode(manualBarcode)
    else {
      setFormOpen(true)
      setCheckInDate(todayLocalDate())
      setFields(EMPTY_PART_FIELDS)
      setExistingTitle(null)
    }
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setStatus(null)
    try {
      let partId: string | null = null
      const hasCatalogData = Object.values(fields).some((v) => v.trim().length > 0)
      if (hasCatalogData) {
        const part = await insertPartIfMissing(fields)
        partId = part.id
      }
      await insertCheckIn(fields, checkInDate || todayLocalDate(), partId)
      const label = displayPartTitle(fields)
      setStatus({
        type: 'success',
        message: existingTitle
          ? `Checked in existing part: ${label}`
          : hasCatalogData
            ? `Checked in and added to catalog: ${label}`
            : 'Checked in.',
      })
      resetForm()
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not save check-in.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const lookupOnBlur = async () => {
    if (!supabase || lookupLoading) return
    setLookupLoading(true)
    try {
      const existing = await findExistingPart(fields)
      if (existing) {
        setFields(fieldsFromRecord(existing))
        setExistingTitle(displayPartTitle(existing))
      }
    } catch {
      /* ignore */
    } finally {
      setLookupLoading(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>
            <a href="/" className="home-title-link">
              Parts Scanner
            </a>
          </h1>
        </header>
        <div className="section section-error">
          <p>
            Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> and redeploy.
          </p>
          <p className="hint">
            Run <code>supabase/add-parts-tracker.sql</code> in the Supabase SQL Editor.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <a href="/" className="home-title-link">
            Parts Scanner
          </a>
        </h1>
        <p className="app-subtitle">Scan with the camera or a Bluetooth scanner, then save the check-in.</p>
      </header>

      {status && <div className={`status status-${status.type}`}>{status.message}</div>}

      <main className="app-main">
        {!formOpen ? (
          <section className="section">
            <button type="button" className="btn btn-primary btn-full" onClick={() => setShowScanner(true)}>
              Scan barcode
            </button>
            <form className="manual-scan" onSubmit={handleManualSubmit}>
              <label className="label" htmlFor="bluetooth-barcode">
                Or type / Bluetooth scan
              </label>
              <input
                id="bluetooth-barcode"
                className="input"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="Focus here and scan, then press Enter"
                autoComplete="off"
                autoFocus
              />
              <button type="submit" className="btn btn-secondary btn-full">
                {manualBarcode.trim() ? 'Continue' : 'Enter without barcode'}
              </button>
            </form>
          </section>
        ) : (
          <form onSubmit={handleSave} className="section form-section">
            {lookupLoading && <p className="box-meta-loading">Looking up this part…</p>}
            {existingTitle && !lookupLoading && (
              <div className="last-scan-panel" role="status">
                <strong>Existing part</strong>
                <p className="last-scan-panel-main">{existingTitle}</p>
                <p className="last-scan-panel-meta">Catalog fields were filled in. You can still edit this check-in.</p>
              </div>
            )}

            <div className="form-field">
              <label className="label" htmlFor="check-in-date">
                Check-in date
              </label>
              <input
                id="check-in-date"
                type="date"
                className="input"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
              />
            </div>

            {PART_FIELD_LABELS.map(({ key, label }) => (
              <div className="form-field" key={key}>
                <label className="label" htmlFor={`field-${key}`}>
                  {label}
                </label>
                {key === 'description' ? (
                  <textarea
                    id={`field-${key}`}
                    className="input textarea"
                    rows={3}
                    value={fields[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    autoComplete="off"
                  />
                ) : (
                  <input
                    id={`field-${key}`}
                    type="text"
                    className="input"
                    value={fields[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    onBlur={key === 'upc_code' || key === 'ipn' ? () => void lookupOnBlur() : undefined}
                    placeholder={key === 'upc_code' ? 'Scan or type UPC' : undefined}
                    autoComplete="off"
                  />
                )}
              </div>
            ))}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  resetForm()
                  setShowScanner(true)
                }}
                disabled={submitting}
              >
                Scan another
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting || lookupLoading}>
                {submitting ? 'Saving…' : 'Save check-in'}
              </button>
            </div>
          </form>
        )}
      </main>

      {showScanner && <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  )
}
