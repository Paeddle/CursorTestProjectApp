import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { fetchPartByIpn, ipnFromLocation } from '../services/itemLookup'
import { submitReorderRequest } from '../services/reorderService'
import type { InventreePartRecord } from '../types'
import '../App.css'

type Status = { type: 'success' | 'error' | 'info'; message: string } | null

function quantityFromPart(part: InventreePartRecord | null): string {
  if (part?.maximum_stock != null && part.maximum_stock > 0) {
    return String(Math.max(1, Math.round(part.maximum_stock)))
  }
  return '1'
}

export default function RequestFormPage() {
  const [ipnInput, setIpnInput] = useState('')
  const [part, setPart] = useState<InventreePartRecord | null>(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [loadingPart, setLoadingPart] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const [quantity, setQuantity] = useState('1')
  const [job, setJob] = useState('')
  const [requestedBy, setRequestedBy] = useState('')
  const [notes, setNotes] = useState('')

  const lookupIpn = useCallback(async (ipn: string) => {
    const trimmed = ipn.trim()
    if (!trimmed) {
      setPart(null)
      setLookupDone(false)
      setQuantity('1')
      return
    }
    if (!supabase) {
      setStatus({
        type: 'error',
        message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      })
      return
    }

    setLoadingPart(true)
    setStatus(null)
    setLookupDone(false)
    try {
      const found = await fetchPartByIpn(trimmed)
      setPart(found)
      setQuantity(quantityFromPart(found))
      setLookupDone(true)
      if (!found) {
        setStatus({
          type: 'info',
          message: `No part found for IPN "${trimmed}". You can still submit this request for manual review.`,
        })
      }
    } catch (err) {
      setPart(null)
      setQuantity('1')
      setLookupDone(true)
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not look up part.',
      })
    } finally {
      setLoadingPart(false)
    }
  }, [])

  useEffect(() => {
    const fromUrl = ipnFromLocation()
    if (fromUrl) {
      setIpnInput(fromUrl)
      void lookupIpn(fromUrl)
    }
  }, [lookupIpn])

  const handleLookup = () => {
    void lookupIpn(ipnInput)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      setStatus({ type: 'error', message: 'Supabase is not configured.' })
      return
    }

    const name = requestedBy.trim()
    if (!name) {
      setStatus({ type: 'error', message: 'Enter your name.' })
      return
    }

    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty < 1) {
      setStatus({ type: 'error', message: 'Enter a quantity of at least 1.' })
      return
    }

    const ipn = ipnInput.trim()
    if (!ipn && !part) {
      setStatus({ type: 'error', message: 'Enter an IPN or scan a tag QR code.' })
      return
    }

    setSubmitting(true)
    setStatus(null)
    try {
      const result = await submitReorderRequest({
        item_id: null,
        ipn: part?.ipn ?? (ipn || null),
        name: part?.name ?? null,
        category_name: part?.category_name ?? null,
        vendor_name: null,
        barcode_hash: part?.barcode_hash ?? null,
        link: part?.link ?? null,
        quantity: qty,
        job: job.trim() || null,
        requested_by: name,
        notes: notes.trim() || null,
      })
      setSubmittedId(result.id)
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not submit re-order request.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setSubmittedId(null)
    setIpnInput('')
    setPart(null)
    setLookupDone(false)
    setQuantity('1')
    setJob('')
    setRequestedBy('')
    setNotes('')
    setStatus(null)
    window.history.replaceState({}, '', import.meta.env.BASE_URL || '/')
  }

  if (submittedId) {
    return (
      <div className="app">
        <div className="section success-panel">
          <h2>Request submitted</h2>
          <p>Your re-order request was saved. Someone will review it soon.</p>
          <button type="button" className="btn btn-primary" onClick={resetForm}>
            Submit another request
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Re-order Request</h1>
        <p className="app-subtitle">Scan a tag or enter an IPN to re-order stock</p>
        <Link to="/portal" className="nav-link">
          Open request portal →
        </Link>
      </header>

      <main className="app-main">
        {!isSupabaseConfigured || !supabase ? (
          <section className="section">
            <div className="status status-error">
              Add <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> in
              your host environment and redeploy. Also run{' '}
              <code>supabase/add-reorder-requests.sql</code> and{' '}
              <code>supabase/add-inventree-parts.sql</code> in Supabase SQL Editor.
            </div>
          </section>
        ) : null}

        {status && <div className={`status status-${status.type}`}>{status.message}</div>}

        <form className="app-form" onSubmit={(e) => void handleSubmit(e)}>
          <section className="section">
            <h2 className="section-title">IPN</h2>
            <div className="sku-row">
              <input
                type="text"
                className="input"
                placeholder="Scan tag or type IPN"
                value={ipnInput}
                onChange={(e) => {
                  setIpnInput(e.target.value)
                  setLookupDone(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleLookup()
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleLookup}
                disabled={!ipnInput.trim() || loadingPart}
              >
                {loadingPart ? '…' : 'Look up'}
              </button>
            </div>
            <p className="hint">Tag QR codes open this form with the IPN pre-filled from InvenTree.</p>
          </section>

          {part ? (
            <section className="section">
              <h2 className="section-title">Part details</h2>
              <div className="item-preview-body">
                <p className="item-name">{part.name}</p>
                <p className="item-meta">IPN: {part.ipn ?? '—'}</p>
                {part.category_name ? (
                  <p className="item-meta">Category: {part.category_name}</p>
                ) : null}
                {part.maximum_stock != null ? (
                  <p className="item-meta">Maximum stock: {part.maximum_stock}</p>
                ) : null}
                {part.link ? (
                  <p className="item-meta">
                    <a href={part.link} target="_blank" rel="noreferrer">
                      Product link
                    </a>
                  </p>
                ) : null}
                {!part.active ? (
                  <p className="not-found">This part is marked inactive in InvenTree.</p>
                ) : null}
              </div>
            </section>
          ) : lookupDone && ipnInput.trim() ? (
            <section className="section">
              <p className="not-found">
                Part not in InvenTree catalog — you can still submit this request for manual review.
              </p>
            </section>
          ) : null}

          <section className="section">
            <h2 className="section-title">Request details</h2>

            <div className="field">
              <label className="label" htmlFor="requestedBy">
                Your name *
              </label>
              <input
                id="requestedBy"
                type="text"
                className="input"
                placeholder="Required"
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                required
                autoComplete="name"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="quantity">
                Quantity needed *
              </label>
              <input
                id="quantity"
                type="number"
                min={1}
                step={1}
                className="input"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </section>

          <section className="section">
            <div className="field">
              <label className="label" htmlFor="job">
                Job / project
              </label>
              <input
                id="job"
                type="text"
                className="input"
                placeholder="Optional"
                value={job}
                onChange={(e) => setJob(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="notes">
                Notes
              </label>
              <textarea
                id="notes"
                className="textarea"
                placeholder="Urgency, alternate part, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </section>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit re-order request'}
          </button>
        </form>
      </main>
    </div>
  )
}
