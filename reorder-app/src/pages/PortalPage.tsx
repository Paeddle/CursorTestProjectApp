import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  fetchOpenReorderRequests,
  fetchOrderHistory,
  setReorderOrdered,
  setReorderReceived,
} from '../services/portalService'
import type { ReorderRequestRecord } from '../types'
import '../App.css'
import './PortalPage.css'

type PortalTab = 'open' | 'history'

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function RequestCard({
  request,
  showActions,
  onOrderedChange,
  onReceived,
  busy,
}: {
  request: ReorderRequestRecord
  showActions: boolean
  onOrderedChange: (id: string, ordered: boolean) => void
  onReceived: (id: string) => void
  busy: string | null
}) {
  const isOrdered = request.status === 'ordered' || request.status === 'received'
  const isReceived = request.status === 'received'
  const rowBusy = busy === request.id

  return (
    <article className="portal-card section">
      <div className="portal-card-head">
        <div>
          <h3 className="portal-card-title">{request.name ?? request.ipn ?? 'Unknown part'}</h3>
          <p className="portal-card-subtitle">
            Requested {formatWhen(request.created_at)} · {request.requested_by ?? 'Unknown'}
          </p>
        </div>
        <span className={`portal-badge portal-badge-${request.status}`}>{request.status}</span>
      </div>

      <dl className="portal-details">
        <div className="portal-detail">
          <dt>IPN</dt>
          <dd>{request.ipn ?? '—'}</dd>
        </div>
        <div className="portal-detail">
          <dt>Category</dt>
          <dd>{request.category_name ?? '—'}</dd>
        </div>
        <div className="portal-detail">
          <dt>Quantity</dt>
          <dd>{request.quantity}</dd>
        </div>
        <div className="portal-detail">
          <dt>Job / project</dt>
          <dd>{request.job ?? '—'}</dd>
        </div>
        <div className="portal-detail">
          <dt>Notes</dt>
          <dd>{request.notes ?? '—'}</dd>
        </div>
        <div className="portal-detail">
          <dt>Barcode hash</dt>
          <dd>{request.barcode_hash ?? '—'}</dd>
        </div>
        <div className="portal-detail">
          <dt>Vendor</dt>
          <dd>{request.vendor_name ?? '—'}</dd>
        </div>
        <div className="portal-detail portal-detail-wide">
          <dt>Link</dt>
          <dd>
            {request.link ? (
              <a href={request.link} target="_blank" rel="noreferrer">
                {request.link}
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {isReceived ? (
          <>
            <div className="portal-detail">
              <dt>Ordered</dt>
              <dd>{formatWhen(request.ordered_at)}</dd>
            </div>
            <div className="portal-detail">
              <dt>Received</dt>
              <dd>{formatWhen(request.received_at)}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {showActions ? (
        <div className="portal-actions">
          <label className="portal-check">
            <input
              type="checkbox"
              checked={isOrdered}
              disabled={rowBusy || isReceived}
              onChange={(e) => onOrderedChange(request.id, e.target.checked)}
            />
            <span>Part ordered</span>
          </label>
          <label className={`portal-check ${!isOrdered ? 'portal-check-disabled' : ''}`}>
            <input
              type="checkbox"
              checked={isReceived}
              disabled={rowBusy || !isOrdered || isReceived}
              onChange={() => {
                if (!isReceived && isOrdered) onReceived(request.id)
              }}
            />
            <span>Part received</span>
          </label>
          {rowBusy ? <span className="portal-saving">Saving…</span> : null}
        </div>
      ) : null}
    </article>
  )
}

export default function PortalPage() {
  const [tab, setTab] = useState<PortalTab>('open')
  const [openRequests, setOpenRequests] = useState<ReorderRequestRecord[]>([])
  const [history, setHistory] = useState<ReorderRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [open, done] = await Promise.all([fetchOpenReorderRequests(), fetchOrderHistory()])
      setOpenRequests(open)
      setHistory(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleOrderedChange = async (id: string, ordered: boolean) => {
    setBusyId(id)
    setError(null)
    try {
      await setReorderOrdered(id, ordered)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update request.')
    } finally {
      setBusyId(null)
    }
  }

  const handleReceived = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await setReorderReceived(id)
      await load()
      setTab('history')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark as received.')
    } finally {
      setBusyId(null)
    }
  }

  const list = tab === 'open' ? openRequests : history

  return (
    <div className="portal app-wide">
      <header className="app-header">
        <h1><a href="/" className="home-title-link">Re-order Portal</a></h1>
        <p className="app-subtitle">Track open requests and order history</p>
        <Link to="/" className="nav-link">
          ← New re-order request
        </Link>
      </header>

      {!isSupabaseConfigured ? (
        <section className="section">
          <div className="status status-error">Supabase is not configured.</div>
        </section>
      ) : null}

      {error ? <div className="status status-error">{error}</div> : null}

      <div className="portal-tabs">
        <button
          type="button"
          className={`portal-tab ${tab === 'open' ? 'portal-tab-active' : ''}`}
          onClick={() => setTab('open')}
        >
          Open requests ({openRequests.length})
        </button>
        <button
          type="button"
          className={`portal-tab ${tab === 'history' ? 'portal-tab-active' : ''}`}
          onClick={() => setTab('history')}
        >
          Order history ({history.length})
        </button>
      </div>

      <main className="portal-main">
        {loading ? <p className="portal-empty">Loading…</p> : null}
        {!loading && list.length === 0 ? (
          <p className="portal-empty">
            {tab === 'open' ? 'No open re-order requests.' : 'No completed orders yet.'}
          </p>
        ) : null}
        {!loading
          ? list.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                showActions={tab === 'open'}
                onOrderedChange={(id, ordered) => void handleOrderedChange(id, ordered)}
                onReceived={(id) => void handleReceived(id)}
                busy={busyId}
              />
            ))
          : null}
      </main>
    </div>
  )
}
