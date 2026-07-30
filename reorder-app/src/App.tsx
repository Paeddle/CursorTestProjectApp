import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { fetchItemBySku, skuFromLocation } from './services/itemLookup'
import { submitReorderRequest } from './services/reorderService'
import type { ItemRecord } from './types'
import './App.css'

type Status = { type: 'success' | 'error' | 'info'; message: string } | null

function App() {
  const [skuInput, setSkuInput] = useState('')
  const [item, setItem] = useState<ItemRecord | null>(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [loadingItem, setLoadingItem] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const [quantity, setQuantity] = useState('1')
  const [job, setJob] = useState('')
  const [requestedBy, setRequestedBy] = useState('')
  const [notes, setNotes] = useState('')

  const lookupSku = useCallback(async (sku: string) => {
    const trimmed = sku.trim()
    if (!trimmed) {
      setItem(null)
      setLookupDone(false)
      return
    }
    if (!supabase) {
      setStatus({
        type: 'error',
        message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      })
      return
    }

    setLoadingItem(true)
    setStatus(null)
    setLookupDone(false)
    try {
      const found = await fetchItemBySku(trimmed)
      setItem(found)
      setLookupDone(true)
      if (!found) {
        setStatus({
          type: 'info',
          message: `No item found for SKU "${trimmed}". You can still submit a manual re-order below.`,
        })
      }
    } catch (err) {
      setItem(null)
      setLookupDone(true)
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not look up item.',
      })
    } finally {
      setLoadingItem(false)
    }
  }, [])

  useEffect(() => {
    const fromUrl = skuFromLocation()
    if (fromUrl) {
      setSkuInput(fromUrl)
      void lookupSku(fromUrl)
    }
  }, [lookupSku])

  const handleLookup = () => {
    void lookupSku(skuInput)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      setStatus({ type: 'error', message: 'Supabase is not configured.' })
      return
    }

    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty < 1) {
      setStatus({ type: 'error', message: 'Enter a quantity of at least 1.' })
      return
    }

    const sku = skuInput.trim()
    if (!sku && !item) {
      setStatus({ type: 'error', message: 'Enter a SKU or scan a pink tag QR code.' })
      return
    }

    setSubmitting(true)
    setStatus(null)
    try {
      const result = await submitReorderRequest({
        item_id: item?.id ?? null,
        part_number: item?.part_number ?? (sku || null),
        item_name: item?.item ?? null,
        manufacturer: item?.manufacturer ?? null,
        vendor_name: item?.vendor_name ?? null,
        barcode: item?.barcode ?? null,
        description: item?.description_customer ?? null,
        stock_available: item?.stock_available ?? null,
        quantity: qty,
        job: job.trim() || null,
        requested_by: requestedBy.trim() || null,
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
    setSkuInput('')
    setItem(null)
    setLookupDone(false)
    setQuantity('1')
    setJob('')
    setRequestedBy('')
    setNotes('')
    setStatus(null)
    window.history.replaceState({}, '', window.location.pathname.split('/r/')[0] || '/')
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
        <p className="app-subtitle">Scan a pink tag or enter a SKU to re-order stock</p>
      </header>

      <main className="app-main">
        {!isSupabaseConfigured || !supabase ? (
          <section className="section">
            <div className="status status-error">
              Add <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> in
              your host environment and redeploy. Also run{' '}
              <code>supabase/add-reorder-requests.sql</code> in Supabase SQL Editor.
            </div>
          </section>
        ) : null}

        {status && <div className={`status status-${status.type}`}>{status.message}</div>}

        <section className="section">
          <h2 className="section-title">SKU / Part number</h2>
          <div className="sku-row">
            <input
              type="text"
              className="input"
              placeholder="Scan tag or type SKU"
              value={skuInput}
              onChange={(e) => {
                setSkuInput(e.target.value)
                setLookupDone(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleLookup}
              disabled={!skuInput.trim() || loadingItem}
            >
              {loadingItem ? '…' : 'Look up'}
            </button>
          </div>
          <p className="hint">Pink tag QR codes open this form with the SKU already filled in.</p>
        </section>

        {item ? (
          <section className="section">
            <h2 className="section-title">Item details</h2>
            <div className="item-preview">
              {item.picture_url ? (
                <img src={item.picture_url} alt="" />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 8,
                    background: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                  }}
                />
              )}
              <div className="item-preview-body">
                <p className="item-name">{item.item ?? item.part_number ?? 'Unknown item'}</p>
                <p className="item-meta">
                  {item.manufacturer ? `${item.manufacturer} · ` : ''}
                  SKU: {item.part_number ?? '—'}
                </p>
                {item.vendor_name ? <p className="item-meta">Vendor: {item.vendor_name}</p> : null}
                {item.stock_available != null ? (
                  <p className="item-meta">In stock: {item.stock_available}</p>
                ) : null}
              </div>
            </div>
          </section>
        ) : lookupDone && skuInput.trim() ? (
          <section className="section">
            <p className="not-found">
              Item not in catalog — fill in the request anyway and it will be reviewed manually.
            </p>
          </section>
        ) : null}

        <form className="section" onSubmit={(e) => void handleSubmit(e)}>
          <h2 className="section-title">Request details</h2>

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
            <label className="label" htmlFor="requestedBy">
              Your name
            </label>
            <input
              id="requestedBy"
              type="text"
              className="input"
              placeholder="Optional"
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
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

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit re-order request'}
          </button>
        </form>
      </main>
    </div>
  )
}

export default App
