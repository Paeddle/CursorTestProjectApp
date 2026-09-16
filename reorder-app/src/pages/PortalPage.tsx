import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  deleteReorderRequest,
  fetchOpenReorderRequests,
  fetchOrderHistory,
  setReorderOrdered,
  setReorderReceived,
} from '../services/portalService'
import type { ReorderRequestRecord } from '../types'
import '../App.css'
import './PortalPage.css'
import '../trackerTheme.css'

type PortalTab = 'open' | 'history'
type PortalSort = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'

function requestTitle(request: ReorderRequestRecord): string {
  return request.name ?? request.ipn ?? 'Unknown part'
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function sortRequests(rows: ReorderRequestRecord[], sort: PortalSort): ReorderRequestRecord[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (sort === 'date-desc' || sort === 'date-asc') {
      const aTime = new Date(a.created_at).getTime()
      const bTime = new Date(b.created_at).getTime()
      return sort === 'date-desc' ? bTime - aTime : aTime - bTime
    }
    const byName = compareNames(requestTitle(a), requestTitle(b))
    return sort === 'name-asc' ? byName : -byName
  })
  return copy
}

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function RequestCard({
  request,
  showActions,
  canDelete,
  onOrderedChange,
  onReceived,
  onDelete,
  busy,
}: {
  request: ReorderRequestRecord
  showActions: boolean
  canDelete: boolean
  onOrderedChange: (id: string, ordered: boolean) => void
  onReceived: (id: string) => void
  onDelete: (id: string) => void
  busy: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const isOrdered = request.status === 'ordered' || request.status === 'received'
  const isReceived = request.status === 'received'
  const rowBusy = busy === request.id
  const title = requestTitle(request)

  return (
    <article className={`portal-row${expanded ? ' portal-row-open' : ''}`}>
      <button
        type="button"
        className="portal-row-header"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <span className="portal-row-title">{title}</span>
        <span className="portal-row-qty">Qty {request.quantity}</span>
        <span className={`portal-badge portal-badge-${request.status}`}>{request.status}</span>
        <span className="portal-row-when">{formatWhen(request.created_at)}</span>
        <span className="portal-row-chevron">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded ? (
        <div className="portal-row-body">
          <dl className="portal-details">
            <div className="portal-detail">
              <dt>IPN</dt>
              <dd>{request.ipn ?? '—'}</dd>
            </div>
            <div className="portal-detail">
              <dt>Requested by</dt>
              <dd>{request.requested_by ?? '—'}</dd>
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
              <label className="portal-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isOrdered}
                  disabled={rowBusy || isReceived}
                  onChange={(e) => onOrderedChange(request.id, e.target.checked)}
                />
                <span>Part ordered</span>
              </label>
              <label
                className={`portal-check ${!isOrdered ? 'portal-check-disabled' : ''}`}
                onClick={(e) => e.stopPropagation()}
              >
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

          {canDelete ? (
            <div className="portal-actions">
              <button
                type="button"
                className="portal-delete"
                disabled={rowBusy}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(request.id)
                }}
              >
                Delete
              </button>
              {rowBusy ? <span className="portal-saving">Deleting…</span> : null}
            </div>
          ) : null}
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
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [sort, setSort] = useState<PortalSort>('date-desc')

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

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this order history row? This cannot be undone.')) return
    setBusyId(id)
    setError(null)
    try {
      await deleteReorderRequest(id)
      setHistory((prev) => prev.filter((row) => row.id !== id))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not delete. Run supabase/alter-reorder-requests-inventree-columns.sql in Supabase if delete is blocked.',
      )
    } finally {
      setBusyId(null)
    }
  }

  const handleSyncInventree = async () => {
    if (!supabase) return
    setSyncing(true)
    setError(null)
    setSyncMessage(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('sync-inventree-parts', {
        body: {},
      })
      if (invokeError) throw invokeError
      const payload = data as { error?: string; count?: number } | null
      if (payload?.error) throw new Error(payload.error)
      setSyncMessage(`Synced ${payload?.count ?? 0} parts from InvenTree.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not sync InvenTree parts.'
      setError(
        /not found|404|Failed to send/i.test(message)
          ? 'Sync function is not deployed yet. The local sync already loaded 329 parts; deploy supabase/functions/sync-inventree-parts to enable this button.'
          : message,
      )
    } finally {
      setSyncing(false)
    }
  }

  const list = useMemo(
    () => sortRequests(tab === 'open' ? openRequests : history, sort),
    [history, openRequests, sort, tab],
  )

  return (
    <div className="app portal app-wide">
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

      {syncMessage ? <div className="status status-success">{syncMessage}</div> : null}

      <div className="portal-toolbar">
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
        <label className="portal-sort">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as PortalSort)}
            aria-label="Sort requests"
          >
            <option value="date-desc">Date (newest)</option>
            <option value="date-asc">Date (oldest)</option>
            <option value="name-asc">Name (A–Z, numeric)</option>
            <option value="name-desc">Name (Z–A, numeric)</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary portal-sync-btn"
          onClick={() => void handleSyncInventree()}
          disabled={syncing || !isSupabaseConfigured}
        >
          {syncing ? 'Syncing…' : 'Sync InvenTree parts'}
        </button>
      </div>

      <main className="portal-main">
        <div className="portal-list">
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
                  canDelete={tab === 'history'}
                  onOrderedChange={(id, ordered) => void handleOrderedChange(id, ordered)}
                  onReceived={(id) => void handleReceived(id)}
                  onDelete={(id) => void handleDelete(id)}
                  busy={busyId}
                />
              ))
            : null}
        </div>
      </main>
    </div>
  )
}
