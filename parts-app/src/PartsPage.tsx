import { useCallback, useEffect, useMemo, useState } from 'react'
import DocumentScanner from './components/DocumentScanner'
import { isSupabaseConfigured } from './lib/supabase'
import { cropDocumentToBlob } from './lib/documentScanner'
import {
  checkInMatchesQuery,
  checkInQuantity,
  displayPartTitle,
  fieldsFromRecord,
  formatCheckInWhen,
  formatDateTime,
  isHttpUrl,
  normalizeLookupKey,
  parseCheckInDocuments,
  partMatchesQuery,
  trimField,
} from './partsHelpers'
import {
  addCheckInDocuments,
  deleteCheckIn,
  deletePart,
  fetchCheckIns,
  fetchParts,
  updateCheckIn,
} from './services/partsService'
import {
  CATALOG_FIELD_LABELS,
  EMPTY_PART_FIELDS,
  PART_FIELD_LABELS,
  type PartCheckIn,
  type PartFields,
  type TrackedPart,
} from './types'
import './PartsPage.css'

type WorkspaceTab = 'checkin' | 'parts'
type CheckInSort = 'date-desc' | 'po-asc' | 'po-desc'

function comparePo(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function sortCheckIns(rows: PartCheckIn[], sort: CheckInSort): PartCheckIn[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (sort === 'date-desc') {
      return new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
    }
    const aPo = (a.po ?? '').trim()
    const bPo = (b.po ?? '').trim()
    if (!aPo && !bPo) return 0
    if (!aPo) return 1
    if (!bPo) return -1
    const byPo = comparePo(aPo, bPo)
    return sort === 'po-asc' ? byPo : -byPo
  })
  return copy
}

type ScannerMode = 'checkin' | 'parts'

function partsScannerHref(mode: ScannerMode): string {
  const configured = import.meta.env.VITE_PARTS_SCANNER_URL?.trim()
  const base = configured
    ? configured.replace(/\/?$/, '/')
    : typeof window !== 'undefined'
      ? `${window.location.origin}/parts-scanner/`
      : '/parts-scanner/'
  return mode === 'parts' ? `${base}parts/` : base
}

function FieldRows({
  row,
  labels,
}: {
  row: Partial<PartFields>
  labels: { key: keyof PartFields; label: string }[]
}) {
  return (
    <dl className="parts-dl">
      {labels.map(({ key, label }) => {
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
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set())
  const [focusedPartId, setFocusedPartId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [docBusyId, setDocBusyId] = useState<string | null>(null)
  const [scanForId, setScanForId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<PartFields>(EMPTY_PART_FIELDS)
  const [editQty, setEditQty] = useState('1')
  const [editSaving, setEditSaving] = useState(false)
  const [checkInSort, setCheckInSort] = useState<CheckInSort>('date-desc')

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
    () => sortCheckIns(
      checkIns.filter((row) => checkInMatchesQuery(row, search)),
      checkInSort,
    ),
    [checkInSort, checkIns, search],
  )
  const filteredParts = useMemo(
    () => parts.filter((row) => partMatchesQuery(row, search)),
    [parts, search],
  )

  const togglePart = (id: string) => {
    setExpandedParts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openPartFromCheckIn = (row: PartCheckIn) => {
    const byId = row.part_id ? parts.find((p) => p.id === row.part_id) : undefined
    const upc = normalizeLookupKey(row.upc_code)
    const ipn = normalizeLookupKey(row.ipn)
    const name = trimField(row.part_name).toLowerCase()
    const match =
      byId ??
      parts.find((p) => upc && normalizeLookupKey(p.upc_code) === upc) ??
      parts.find((p) => ipn && normalizeLookupKey(p.ipn) === ipn) ??
      parts.find((p) => name && trimField(p.part_name).toLowerCase() === name)

    if (!match) {
      setError('That check-in is not linked to a part in the catalog yet.')
      return
    }

    setError(null)
    setSearch('')
    setWorkspaceTab('parts')
    setExpandedParts(new Set([match.id]))
    setFocusedPartId(match.id)
  }

  useEffect(() => {
    if (workspaceTab !== 'parts' || !focusedPartId) return
    const el = document.getElementById(`part-card-${focusedPartId}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [workspaceTab, focusedPartId, parts])

  const expandAllParts = () => {
    if (filteredParts.length > 0 && filteredParts.every((r) => expandedParts.has(r.id))) {
      setExpandedParts(new Set())
    } else {
      setExpandedParts(new Set(filteredParts.map((r) => r.id)))
    }
  }

  const attachDocuments = async (checkInId: string, files: { blob: Blob; name: string }[]) => {
    if (files.length === 0) return
    setDocBusyId(checkInId)
    setError(null)
    try {
      const updated = await addCheckInDocuments(checkInId, files)
      setCheckIns((prev) => prev.map((row) => (row.id === checkInId ? updated : row)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add document.')
    } finally {
      setDocBusyId(null)
    }
  }

  const handleCheckInFiles = async (checkInId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const prepared: { blob: Blob; name: string }[] = []
    for (const file of files) {
      let blob: Blob = file
      let name = file.name || `document_${Date.now()}.jpg`
      if (file.type.startsWith('image/')) {
        try {
          const cropped = await cropDocumentToBlob(file)
          if (cropped) {
            blob = cropped
            name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
          }
        } catch {
          blob = file
        }
      }
      prepared.push({ blob, name })
    }
    await attachDocuments(checkInId, prepared)
  }

  const handleCheckInScan = (blob: Blob) => {
    const checkInId = scanForId
    setScanForId(null)
    if (!checkInId) return
    void attachDocuments(checkInId, [{ blob, name: `scan_${Date.now()}.jpg` }])
  }

  const startEdit = (row: PartCheckIn) => {
    setEditingId(row.id)
    setEditFields(fieldsFromRecord(row))
    setEditQty(String(checkInQuantity(row)))
    setError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditFields(EMPTY_PART_FIELDS)
    setEditQty('1')
  }

  const saveEdit = async () => {
    if (!editingId) return
    const qty = Number.parseInt(editQty, 10)
    if (!Number.isFinite(qty) || qty < 1) {
      setError('Quantity must be at least 1.')
      return
    }
    setEditSaving(true)
    setError(null)
    try {
      const updated = await updateCheckIn(editingId, editFields, qty)
      setCheckIns((prev) => prev.map((row) => (row.id === editingId ? updated : row)))
      cancelEdit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save check-in.')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeleteCheckIn = async (id: string) => {
    if (!window.confirm('Delete this check-in? This cannot be undone.')) return
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
            {workspaceTab === 'checkin' ? (
              <label className="parts-sort">
                <span>Sort</span>
                <select
                  value={checkInSort}
                  onChange={(e) => setCheckInSort(e.target.value as CheckInSort)}
                  aria-label="Sort check-ins"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="po-asc">PO (A–Z)</option>
                  <option value="po-desc">PO (Z–A)</option>
                </select>
              </label>
            ) : null}
            {workspaceTab === 'parts' && filteredParts.length > 0 && (
              <button type="button" className="parts-toolbar-btn" onClick={expandAllParts}>
                {allPartsExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            {workspaceTab === 'checkin' ? (
              <a
                className="parts-scanner-link"
                href={partsScannerHref('checkin')}
                target="_blank"
                rel="noopener noreferrer"
              >
                Check-in scanner
              </a>
            ) : (
              <a
                className="parts-scanner-link"
                href={partsScannerHref('parts')}
                target="_blank"
                rel="noopener noreferrer"
              >
                Parts scanner
              </a>
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
                  : 'No check-ins yet. Use Check-in scanner to scan an item.'}
              </div>
            ) : (
              <div className="parts-list-scroll">
                <div className="parts-list">
                  {filteredCheckIns.map((row) => {
                    const isEditing = editingId === row.id
                    const docs = parseCheckInDocuments(row.documents)
                    return (
                    <div key={row.id} className={`parts-card parts-checkin-row${isEditing ? ' parts-checkin-row-editing' : ''}`}>
                      <div className="parts-checkin-main">
                        <button
                          type="button"
                          className="parts-checkin-name"
                          onClick={() => openPartFromCheckIn(row)}
                        >
                          {displayPartTitle(row)}
                        </button>
                        {!isEditing ? (
                          <>
                            <div className="parts-checkin-po">
                              <span className="parts-checkin-po-label">PO</span>
                              <span>{row.po?.trim() || '—'}</span>
                            </div>
                            {row.description?.trim() ? (
                              <div className="parts-checkin-po">
                                <span className="parts-checkin-po-label">Description</span>
                                <span>{row.description.trim()}</span>
                              </div>
                            ) : null}
                            <div className="parts-checkin-po">
                              <span className="parts-checkin-po-label">Qty</span>
                              <span>{checkInQuantity(row)}</span>
                            </div>
                            {docs.length > 0 ? (
                              <div className="parts-checkin-docs">
                                {docs.map((doc, index) => (
                                  <a
                                    key={`${doc.url}-${index}`}
                                    className="parts-checkin-doc-link"
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {doc.name || `Document ${index + 1}`}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <form
                            className="parts-checkin-edit"
                            onSubmit={(e) => {
                              e.preventDefault()
                              void saveEdit()
                            }}
                          >
                            {PART_FIELD_LABELS.map(({ key, label }) => (
                              <div className="parts-edit-field" key={key}>
                                <label className="parts-checkin-po-label" htmlFor={`edit-${row.id}-${key}`}>
                                  {label}
                                </label>
                                {key === 'description' ? (
                                  <textarea
                                    id={`edit-${row.id}-${key}`}
                                    className="parts-edit-input"
                                    rows={3}
                                    value={editFields[key]}
                                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                                  />
                                ) : (
                                  <input
                                    id={`edit-${row.id}-${key}`}
                                    type="text"
                                    className="parts-edit-input"
                                    value={editFields[key]}
                                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                                    autoComplete="off"
                                  />
                                )}
                              </div>
                            ))}
                            <div className="parts-edit-field parts-edit-qty">
                              <label className="parts-checkin-po-label" htmlFor={`edit-${row.id}-qty`}>
                                Qty
                              </label>
                              <input
                                id={`edit-${row.id}-qty`}
                                type="number"
                                min={1}
                                step={1}
                                className="parts-edit-input"
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                              />
                            </div>
                            <div className="parts-edit-field">
                              <span className="parts-checkin-po-label">Documents</span>
                              <div className="parts-checkin-docs">
                                {docs.map((doc, index) => (
                                  <a
                                    key={`${doc.url}-${index}`}
                                    className="parts-checkin-doc-link"
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {doc.name || `Document ${index + 1}`}
                                  </a>
                                ))}
                                <div className="parts-checkin-doc-actions">
                                  <label className="parts-doc-btn">
                                    Add file
                                    <input
                                      type="file"
                                      hidden
                                      multiple
                                      accept="image/*,application/pdf"
                                      disabled={docBusyId === row.id}
                                      onChange={(e) => void handleCheckInFiles(row.id, e)}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="parts-doc-btn"
                                    disabled={docBusyId === row.id}
                                    onClick={() => setScanForId(row.id)}
                                  >
                                    Scan
                                  </button>
                                  {docBusyId === row.id ? <span className="parts-muted">Saving…</span> : null}
                                </div>
                              </div>
                            </div>
                            <div className="parts-edit-actions">
                              <button type="submit" className="parts-toolbar-btn" disabled={editSaving}>
                                {editSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" className="parts-doc-btn" onClick={cancelEdit} disabled={editSaving}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                      <div className="parts-checkin-side">
                        <span className="parts-checkin-when">
                          {formatCheckInWhen(row.check_in_date, row.scanned_at)}
                        </span>
                        {!isEditing ? (
                          <button
                            type="button"
                            className="parts-edit-btn"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="parts-delete"
                          disabled={deletingId === row.id || isEditing}
                          onClick={() => void handleDeleteCheckIn(row.id)}
                        >
                          Delete
                        </button>
                      </div>
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
                  : 'No parts in the catalog yet. Use Parts scanner to add an item.'}
              </div>
            ) : (
              <div className="parts-list-scroll">
                <div className="parts-list">
                  {filteredParts.map((row) => {
                    const isExpanded = expandedParts.has(row.id)
                    return (
                      <div
                        key={row.id}
                        id={`part-card-${row.id}`}
                        className={`parts-card${focusedPartId === row.id ? ' parts-card--focus' : ''}`}
                      >
                        <button
                          type="button"
                          className="parts-card-header"
                          onClick={() => togglePart(row.id)}
                          aria-expanded={isExpanded}
                        >
                          <span className="parts-card-title-block">
                            <span className="parts-card-title">{displayPartTitle(row)}</span>
                          </span>
                          <span className="parts-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                        </button>
                        {isExpanded && (
                          <div className="parts-card-body">
                            <FieldRows row={row} labels={CATALOG_FIELD_LABELS} />
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
      {scanForId ? (
        <DocumentScanner onCapture={handleCheckInScan} onClose={() => setScanForId(null)} />
      ) : null}
    </div>
  )
}
