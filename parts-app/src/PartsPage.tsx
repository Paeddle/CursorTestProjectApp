import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from './lib/supabase'
import {
  checkInMatchesQuery,
  displayPartMeta,
  displayPartTitle,
  formatDate,
  formatDateTime,
  isHttpUrl,
  partMatchesQuery,
} from './partsHelpers'
import {
  deleteCheckIn,
  deletePart,
  fetchCheckIns,
  fetchParts,
} from './services/partsService'
import { PART_FIELD_LABELS, type PartCheckIn, type PartFields, type TrackedPart } from './types'
import './PartsPage.css'

type WorkspaceTab = 'checkin' | 'parts'

function partsScannerHref(): string {
  const configured = import.meta.env.VITE_PARTS_SCANNER_URL?.trim()
  if (configured) return configured.replace(/\/?$/, '/')
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/parts-scanner/`
  }
  return '/parts-scanner/'
}

function FieldRows({ row }: { row: Partial<PartFields> }) {
  return (
    <dl className="parts-dl">
      {PART_FIELD_LABELS.map(({ key, label }) => {
        const value = (row[key] ?? '').trim()
        return (
          <div key={key} className="parts-dl-row">
            <dt>{label}</dt>
            <dd>
              {key === 'link' && value && isHttpUrl(value) ? (
                <a href={value} target="_blank" rel="noopener noreferrer">
                  {value}
                </a>
              ) : (
                value || '—'
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export function PartsPage() {
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('checkin')
  const [checkIns, setCheckIns] = useState<PartCheckIn[]>([])
  const [parts, setParts] = useState<TrackedPart[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedCheckIns, setExpandedCheckIns] = useState<Set<string>>(new Set())
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    setError(null)
    try {
      const [checkInRows, partRows] = await Promise.all([fetchCheckIns(), fetchParts()])
      setCheckIns(checkInRows)
      setParts(partRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load parts data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredCheckIns = useMemo(
    () => checkIns.filter((row) => checkInMatchesQuery(row, search)),
    [checkIns, search],
  )
  const filteredParts = useMemo(
    () => parts.filter((row) => partMatchesQuery(row, search)),
    [parts, search],
  )

  const toggleCheckIn = (id: string) => {
    setExpandedCheckIns((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePart = (id: string) => {
    setExpandedParts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAllCheckIns = () => {
    if (filteredCheckIns.length > 0 && filteredCheckIns.every((r) => expandedCheckIns.has(r.id))) {
      setExpandedCheckIns(new Set())
    } else {
      setExpandedCheckIns(new Set(filteredCheckIns.map((r) => r.id)))
    }
  }

  const expandAllParts = () => {
    if (filteredParts.length > 0 && filteredParts.every((r) => expandedParts.has(r.id))) {
      setExpandedParts(new Set())
    } else {
      setExpandedParts(new Set(filteredParts.map((r) => r.id)))
    }
  }

  const handleDeleteCheckIn = async (id: string) => {
    if (!window.confirm('Delete this check-in?')) return
    setDeletingId(id)
    try {
      await deleteCheckIn(id)
      setCheckIns((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete check-in.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeletePart = async (id: string) => {
    if (!window.confirm('Delete this part from the catalog? Check-in history is kept.')) return
    setDeletingId(id)
    try {
      await deletePart(id)
      setParts((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete part.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="parts-page">
        <header className="parts-header">
          <h1>
            <a href="/" className="home-title-link">
              Parts Tracker
            </a>
          </h1>
        </header>
        <div className="parts-setup">
          <p>
            Configure Supabase in your <code>.env</code> and run{' '}
            <code>supabase/add-parts-tracker.sql</code>.
          </p>
        </div>
      </div>
    )
  }

  const allCheckInsExpanded =
    filteredCheckIns.length > 0 && filteredCheckIns.every((r) => expandedCheckIns.has(r.id))
  const allPartsExpanded =
    filteredParts.length > 0 && filteredParts.every((r) => expandedParts.has(r.id))

  return (
    <div className="parts-page">
      <header className="parts-header">
        <div className="parts-header-row">
          <h1>
            <a href="/" className="home-title-link">
              Parts Tracker
            </a>
          </h1>
          <a
            className="parts-scanner-link"
            href={partsScannerHref()}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open parts scanner
          </a>
        </div>
      </header>

      <section className="parts-workspace" aria-label="Tracker workspace">
        <div className="parts-sheet-tabbar">
          <div className="parts-sheet-tabs" role="tablist" aria-label="Workspace sheets">
            <button
              type="button"
              role="tab"
              id="parts-tab-checkin"
              aria-controls="parts-panel-checkin"
              aria-selected={workspaceTab === 'checkin'}
              className={`parts-sheet-tab${workspaceTab === 'checkin' ? ' active' : ''}`}
              onClick={() => setWorkspaceTab('checkin')}
            >
              Check-In
            </button>
            <button
              type="button"
              role="tab"
              id="parts-tab-parts"
              aria-controls="parts-panel-parts"
              aria-selected={workspaceTab === 'parts'}
              className={`parts-sheet-tab${workspaceTab === 'parts' ? ' active' : ''}`}
              onClick={() => setWorkspaceTab('parts')}
            >
              Parts
            </button>
          </div>
        </div>

        <div className="parts-sheet-body">
          {error && <div className="parts-error">{error}</div>}

          <div className="parts-controls">
            <input
              type="text"
              className="parts-search"
              placeholder={
                workspaceTab === 'checkin'
                  ? 'Filter check-ins by name, UPC, IPN, PO…'
                  : 'Filter parts by name, UPC, IPN, vendor…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="parts-toolbar-btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
            {workspaceTab === 'checkin' && filteredCheckIns.length > 0 && (
              <button type="button" className="parts-toolbar-btn" onClick={expandAllCheckIns}>
                {allCheckInsExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            {workspaceTab === 'parts' && filteredParts.length > 0 && (
              <button type="button" className="parts-toolbar-btn" onClick={expandAllParts}>
                {allPartsExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          <div
            role="tabpanel"
            id="parts-panel-checkin"
            aria-labelledby="parts-tab-checkin"
            hidden={workspaceTab !== 'checkin'}
            className="parts-sheet-panel"
          >
            {loading ? (
              <div className="parts-loading">Loading check-ins…</div>
            ) : filteredCheckIns.length === 0 ? (
              <div className="parts-empty">
                {search.trim()
                  ? 'No check-ins match your filter.'
                  : 'No check-ins yet. Use Parts Scanner to scan an item.'}
              </div>
            ) : (
              <div className="parts-list-scroll">
                <div className="parts-list">
                  {filteredCheckIns.map((row) => {
                    const isExpanded = expandedCheckIns.has(row.id)
                    return (
                      <div key={row.id} className="parts-card">
                        <button
                          type="button"
                          className="parts-card-header"
                          onClick={() => toggleCheckIn(row.id)}
                          aria-expanded={isExpanded}
                        >
                          <span className="parts-card-title-block">
                            <span className="parts-card-title">{displayPartTitle(row)}</span>
                            <span className="parts-card-meta-sep" aria-hidden>
                              ·
                            </span>
                            <span className="parts-card-meta">
                              {formatDate(row.check_in_date)}
                              {displayPartMeta(row) !== 'No details' ? ` · ${displayPartMeta(row)}` : ''}
                            </span>
                          </span>
                          <span className="parts-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                        </button>
                        {isExpanded && (
                          <div className="parts-card-body">
                            <FieldRows row={row} />
                            <div className="parts-card-footer">
                              <span className="parts-muted">Scanned {formatDateTime(row.scanned_at)}</span>
                              <button
                                type="button"
                                className="parts-delete"
                                disabled={deletingId === row.id}
                                onClick={() => void handleDeleteCheckIn(row.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div
            role="tabpanel"
            id="parts-panel-parts"
            aria-labelledby="parts-tab-parts"
            hidden={workspaceTab !== 'parts'}
            className="parts-sheet-panel"
          >
            {loading ? (
              <div className="parts-loading">Loading parts…</div>
            ) : filteredParts.length === 0 ? (
              <div className="parts-empty">
                {search.trim()
                  ? 'No parts match your filter.'
                  : 'No parts in the catalog yet. New scans are added when the UPC or IPN is not already stored.'}
              </div>
            ) : (
              <div className="parts-list-scroll">
                <div className="parts-list">
                  {filteredParts.map((row) => {
                    const isExpanded = expandedParts.has(row.id)
                    const checkInCount = checkIns.filter((c) => c.part_id === row.id).length
                    return (
                      <div key={row.id} className="parts-card">
                        <button
                          type="button"
                          className="parts-card-header"
                          onClick={() => togglePart(row.id)}
                          aria-expanded={isExpanded}
                        >
                          <span className="parts-card-title-block">
                            <span className="parts-card-title">{displayPartTitle(row)}</span>
                            <span className="parts-card-meta-sep" aria-hidden>
                              ·
                            </span>
                            <span className="parts-card-meta">
                              {displayPartMeta(row)}
                              {checkInCount > 0
                                ? ` · ${checkInCount} check-in${checkInCount === 1 ? '' : 's'}`
                                : ''}
                            </span>
                          </span>
                          <span className="parts-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                        </button>
                        {isExpanded && (
                          <div className="parts-card-body">
                            <FieldRows row={row} />
                            <div className="parts-card-footer">
                              <span className="parts-muted">Added {formatDateTime(row.created_at)}</span>
                              <button
                                type="button"
                                className="parts-delete"
                                disabled={deletingId === row.id}
                                onClick={() => void handleDeletePart(row.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
