import { useCallback, useEffect, useRef, useState } from 'react'
import type { BarcodeCatalogItem } from '../types/poCheckin'
import type { ItemBarcodeFilter, ItemRecord } from '../types/items'
import {
  applyBarcodeLookupToItem,
  fetchItemsAsCatalog,
  fetchItemsList,
  fetchItemsStats,
  isItemsConfigured,
  updateItemRow,
} from '../services/itemsService'
import {
  findBarcodeForItem,
  getBarcodeProviderStatus,
  sleep,
} from '../services/barcodeLookup/findBarcodeForItem'
import type { ProviderAttempt } from '../services/barcodeLookup/types'
import {
  formatExternalUrl,
  getItemPicturePublicUrl,
  importItemPictureFromUrl,
  removeItemStoredPicture,
  uploadItemPictureFile,
} from '../lib/itemsImageStorage'
import './ItemsPage.css'

const PAGE_SIZE = 50

export default function ItemsPage() {
  const [stats, setStats] = useState({ total: 0, missingBarcode: 0, hasBarcode: 0 })
  const [rows, setRows] = useState<ItemRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ItemBarcodeFilter>('missing')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [catalog, setCatalog] = useState<BarcodeCatalogItem[]>([])
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, found: 0 })
  const [lookupRow, setLookupRow] = useState<ItemRecord | null>(null)
  const [lookupAttempts, setLookupAttempts] = useState<ProviderAttempt[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [editRow, setEditRow] = useState<ItemRecord | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<ItemRecord>>({})
  const [saving, setSaving] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const bulkCancelRef = useRef(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const providers = getBarcodeProviderStatus()

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await fetchItemsAsCatalog())
    } catch {
      setCatalog([])
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!isItemsConfigured()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [s, list] = await Promise.all([
        fetchItemsStats(),
        fetchItemsList({
          search,
          filter,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      ])
      setStats(s)
      setRows(list.rows)
      setTotal(list.total)
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load items' })
    } finally {
      setLoading(false)
    }
  }, [search, filter, page])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runLookupForRow = async (row: ItemRecord, applyIfFound: boolean) => {
    setLookupRow(row)
    setLookupLoading(true)
    setLookupAttempts([])
    try {
      const { best, attempts } = await findBarcodeForItem(
        {
          part_number: row.part_number,
          manufacturer: row.manufacturer,
          item: row.item,
          description: row.description_customer,
        },
        { catalog }
      )
      setLookupAttempts(attempts)
      if (best && applyIfFound) {
        const updated = await applyBarcodeLookupToItem(row.id, best.barcode, best.source, {
          purchaseUrl:
            best.productUrl && !row.purchase_url?.trim() ? best.productUrl : undefined,
        })
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
        setStats((s) => ({
          ...s,
          missingBarcode: Math.max(0, s.missingBarcode - 1),
          hasBarcode: s.hasBarcode + 1,
        }))
        setStatus({
          kind: 'ok',
          text: `Found ${best.barcode} via ${best.source} (${best.confidence} confidence).`,
        })
        setLookupRow(null)
      } else if (!best) {
        setStatus({ kind: 'info', text: `No barcode found for ${row.part_number || row.item || 'this row'}.` })
      }
      return best
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Lookup failed' })
      return null
    } finally {
      setLookupLoading(false)
    }
  }

  const runBulkLookup = async () => {
    if (!isItemsConfigured()) return
    bulkCancelRef.current = false
    setBulkRunning(true)
    setStatus({ kind: 'info', text: 'Loading rows missing barcodes…' })
    try {
      const { rows: missing } = await fetchItemsList({
        filter: 'missing',
        limit: 500,
        offset: 0,
      })
      if (missing.length === 0) {
        setStatus({ kind: 'ok', text: 'No rows missing barcodes in the first 500 items.' })
        return
      }
      setBulkProgress({ done: 0, total: missing.length, found: 0 })
      let found = 0
      for (let i = 0; i < missing.length; i++) {
        if (bulkCancelRef.current) break
        const row = missing[i]
        const { best } = await findBarcodeForItem(
          {
            part_number: row.part_number,
            manufacturer: row.manufacturer,
            item: row.item,
            description: row.description_customer,
          },
          { catalog }
        )
        if (best) {
          await applyBarcodeLookupToItem(row.id, best.barcode, best.source)
          found++
        }
        setBulkProgress({ done: i + 1, total: missing.length, found })
        await sleep(350)
      }
      setStatus({
        kind: 'ok',
        text: `Bulk lookup finished: ${found} of ${missing.length} rows got a barcode.`,
      })
      await refresh()
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Bulk lookup failed' })
    } finally {
      setBulkRunning(false)
    }
  }

  const stopBulk = () => {
    bulkCancelRef.current = true
    setBulkRunning(false)
  }

  const saveEdit = async () => {
    if (!editRow) return
    setSaving(true)
    try {
      const updated = await updateItemRow(editRow.id, {
        manufacturer: editDraft.manufacturer ?? editRow.manufacturer,
        part_number: editDraft.part_number ?? editRow.part_number,
        item: editDraft.item ?? editRow.item,
        description_customer: editDraft.description_customer ?? editRow.description_customer,
        barcode: editDraft.barcode ?? editRow.barcode,
        vendor_name: editDraft.vendor_name ?? editRow.vendor_name,
        category: editDraft.category ?? editRow.category,
        picture_url: editDraft.picture_url ?? editRow.picture_url,
        purchase_url: editDraft.purchase_url ?? editRow.purchase_url,
      })
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setEditRow(null)
      setStatus({ kind: 'ok', text: 'Row saved.' })
      await fetchItemsStats().then(setStats)
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const persistStoredPicture = async (row: ItemRecord, picture_path: string) => {
    const updated = await updateItemRow(row.id, { picture_path })
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    if (editRow?.id === row.id) {
      setEditRow(updated)
      setEditDraft((d) => ({ ...d, picture_path: updated.picture_path }))
    }
  }

  const handleUploadPicture = async (row: ItemRecord, file: File) => {
    setImageBusy(true)
    try {
      const { picture_path } = await uploadItemPictureFile(row.id, file)
      await persistStoredPicture(row, picture_path)
      setStatus({ kind: 'ok', text: 'Image saved to Supabase for label printing.' })
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Image upload failed' })
    } finally {
      setImageBusy(false)
    }
  }

  const handleImportPictureFromUrl = async (row: ItemRecord) => {
    const source = (editDraft.picture_url ?? row.picture_url ?? '').trim()
    if (!source) {
      setStatus({ kind: 'info', text: 'Enter a picture URL first, or paste a vendor link.' })
      return
    }
    setImageBusy(true)
    try {
      const updated = await importItemPictureFromUrl(row.id, source)
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setEditRow(updated)
      setEditDraft((d) => ({
        ...d,
        picture_url: updated.picture_url ?? '',
        picture_path: updated.picture_path ?? '',
      }))
      setStatus({ kind: 'ok', text: 'Image copied to Supabase — it will stay available for labels.' })
    } catch (e) {
      setStatus({
        kind: 'err',
        text:
          (e instanceof Error ? e.message : 'Import failed') +
          ' Try uploading the file instead, or deploy the inventory-image-import Edge Function.',
      })
    } finally {
      setImageBusy(false)
    }
  }

  const handleRemoveStoredPicture = async (row: ItemRecord) => {
    const path = row.picture_path?.trim()
    if (!path) return
    setImageBusy(true)
    try {
      await removeItemStoredPicture(row.id, path)
      const updated = await updateItemRow(row.id, { picture_path: null })
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      if (editRow?.id === row.id) {
        setEditRow(updated)
        setEditDraft((d) => ({ ...d, picture_path: '' }))
      }
      setStatus({ kind: 'ok', text: 'Removed stored image.' })
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Remove failed' })
    } finally {
      setImageBusy(false)
    }
  }

  const openEdit = (row: ItemRecord) => {
    setEditRow(row)
    setEditDraft({
      manufacturer: row.manufacturer ?? '',
      part_number: row.part_number ?? '',
      item: row.item ?? '',
      description_customer: row.description_customer ?? '',
      barcode: row.barcode ?? '',
      vendor_name: row.vendor_name ?? '',
      category: row.category ?? '',
      picture_url: row.picture_url ?? '',
      picture_path: row.picture_path ?? '',
      purchase_url: row.purchase_url ?? '',
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!isItemsConfigured()) {
    return (
      <div className="items-page">
        <header className="inv-header">
          <h1>Items</h1>
          <p>
            Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your{' '}
            <code>.env</code> file, then redeploy.
          </p>
        </header>
      </div>
    )
  }

  return (
    <div className="items-page">
      <header className="inv-header">
        <h1>Items</h1>
        <p>
          View and edit your items database, fill in missing barcodes using multiple lookup sources, and
          keep data in sync with Purchase List uploads (sidebar). Run{' '}
          <code>supabase/rename-inventory-to-items-merge-catalog.sql</code> and picture migrations in Supabase. Deploy the{' '}
          <code>inventory-image-import</code> Edge Function to copy vendor image URLs into storage.
        </p>
      </header>

      <div className="inv-stats">
        <div className="inv-stat-card">
          <strong>{stats.total.toLocaleString()}</strong>
          <span>Total items</span>
        </div>
        <div className="inv-stat-card">
          <strong>{stats.missingBarcode.toLocaleString()}</strong>
          <span>Missing barcode</span>
        </div>
        <div className="inv-stat-card">
          <strong>{stats.hasBarcode.toLocaleString()}</strong>
          <span>Has barcode</span>
        </div>
      </div>

      <section className="inv-providers" aria-label="Barcode lookup sources">
        <strong>Lookup sources checked (in order, best match wins)</strong>
        <ul>
          {providers.map((p) => (
            <li key={p.id} className={p.enabled ? '' : 'disabled'}>
              <strong>{p.label}</strong> — {p.note}
            </li>
          ))}
        </ul>
      </section>

      {status && <div className={`inv-status ${status.kind}`}>{status.text}</div>}

      {bulkRunning && (
        <div className="inv-bulk-progress">
          Looking up barcodes… {bulkProgress.done} / {bulkProgress.total} ({bulkProgress.found} found)
          <progress value={bulkProgress.done} max={bulkProgress.total || 1} />
          <button type="button" className="inv-btn" onClick={stopBulk} style={{ marginTop: '0.35rem' }}>
            Stop
          </button>
        </div>
      )}

      <div className="inv-toolbar">
        <input
          className="inv-search"
          type="search"
          placeholder="Search part #, item, manufacturer, barcode…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as ItemBarcodeFilter)
            setPage(0)
          }}
          aria-label="Filter"
        >
          <option value="all">All items</option>
          <option value="missing">Missing barcode only</option>
          <option value="has_barcode">Has barcode</option>
        </select>
        <button type="button" className="inv-btn" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
        <button
          type="button"
          className="inv-btn inv-btn-primary"
          onClick={() => void runBulkLookup()}
          disabled={bulkRunning || stats.missingBarcode === 0}
        >
          Auto-fill missing barcodes
        </button>
      </div>

      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>Picture</th>
              <th>Manufacturer</th>
              <th>Part #</th>
              <th>Item</th>
              <th>Barcode</th>
              <th>Buy</th>
              <th>Lookup source</th>
              <th>Stock avail.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9}>No rows match. Upload items on Purchase List first.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const missing = !row.barcode?.trim()
                return (
                  <tr key={row.id} className={missing ? 'missing-barcode' : ''}>
                    <td className="inv-picture-cell">
                      {(() => {
                        const src = getItemPicturePublicUrl(row)
                        return src ? (
                          <a href={src} target="_blank" rel="noopener noreferrer" title={row.picture_path ? 'Stored in Supabase' : 'External URL'}>
                            <img className="inv-picture-thumb" src={src} alt="" loading="lazy" />
                            {row.picture_path ? <span className="inv-picture-badge" title="Stored for labels">✓</span> : null}
                          </a>
                        ) : (
                          '—'
                        )
                      })()}
                    </td>
                    <td>{row.manufacturer || '—'}</td>
                    <td>
                      <code>{row.part_number || '—'}</code>
                    </td>
                    <td>{row.item || '—'}</td>
                    <td className="barcode-cell">
                      {row.barcode ? <code>{row.barcode}</code> : <em>Missing</em>}
                    </td>
                    <td className="inv-purchase-cell">
                      {row.purchase_url?.trim() ? (
                        <a href={formatExternalUrl(row.purchase_url)} target="_blank" rel="noopener noreferrer">
                          Buy
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{row.barcode_lookup_source || '—'}</td>
                    <td>{row.stock_available ?? '—'}</td>
                    <td className="inv-actions">
                      <button type="button" className="inv-btn" onClick={() => openEdit(row)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inv-btn"
                        onClick={() => void runLookupForRow(row, true)}
                        disabled={lookupLoading}
                      >
                        Find barcode
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="inv-pagination">
        <span>
          Page {page + 1} of {totalPages} ({total.toLocaleString()} rows)
        </span>
        <div>
          <button
            type="button"
            className="inv-btn"
            disabled={page <= 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="inv-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            style={{ marginLeft: '0.35rem' }}
          >
            Next
          </button>
        </div>
      </div>

      {lookupRow && (
        <div className="inv-lookup-panel">
          <h3>
            Lookup: {lookupRow.part_number || lookupRow.item || lookupRow.id}
            {lookupLoading && ' — searching…'}
          </h3>
          <ul className="inv-attempts">
            {lookupAttempts.map((a) => (
              <li key={a.providerId} className={a.hit ? 'hit' : 'miss'}>
                <strong>{a.label}</strong> ({a.durationMs}ms)
                {a.hit ? `: ${a.hit.barcode} — ${a.hit.source}` : a.error ? `: ${a.error}` : ': no match'}
              </li>
            ))}
          </ul>
          <button type="button" className="inv-btn" onClick={() => setLookupRow(null)} style={{ marginTop: '0.5rem' }}>
            Close
          </button>
        </div>
      )}

      {editRow && (
        <div className="inv-modal-overlay" onClick={() => setEditRow(null)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit item</h2>
            <label>
              Manufacturer
              <input
                value={editDraft.manufacturer ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, manufacturer: e.target.value }))}
              />
            </label>
            <label>
              Part number
              <input
                value={editDraft.part_number ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, part_number: e.target.value }))}
              />
            </label>
            <label>
              Item name
              <input
                value={editDraft.item ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, item: e.target.value }))}
              />
            </label>
            <label>
              Description
              <textarea
                value={editDraft.description_customer ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, description_customer: e.target.value }))}
                rows={2}
              />
            </label>
            <label>
              Barcode (UPC/EAN)
              <input
                value={editDraft.barcode ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, barcode: e.target.value }))}
              />
            </label>
            <label>
              Vendor
              <input
                value={editDraft.vendor_name ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, vendor_name: e.target.value }))}
              />
            </label>
            <label>
              Category
              <input
                value={editDraft.category ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
              />
            </label>
            <fieldset className="inv-picture-fieldset">
              <legend>Product image (for labels)</legend>
              <p className="inv-picture-hint">
                Upload or import into Supabase so printed labels always use the same image. External URLs alone
                may break when vendors change links.
              </p>
              {editRow && getItemPicturePublicUrl(editRow) ? (
                <div className="inv-edit-preview">
                  <img
                    className="inv-picture-preview"
                    src={getItemPicturePublicUrl(editRow) ?? ''}
                    alt="Preview"
                  />
                  {editRow.picture_path ? (
                    <span className="inv-picture-stored">Stored in Supabase</span>
                  ) : (
                    <span className="inv-picture-stored warn">External link only — import to store</span>
                  )}
                </div>
              ) : null}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="inv-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file && editRow) void handleUploadPicture(editRow, file)
                  e.target.value = ''
                }}
              />
              <div className="inv-picture-actions">
                <button
                  type="button"
                  className="inv-btn"
                  disabled={imageBusy || !editRow}
                  onClick={() => imageInputRef.current?.click()}
                >
                  Upload image file
                </button>
                <button
                  type="button"
                  className="inv-btn"
                  disabled={imageBusy || !editRow}
                  onClick={() => editRow && void handleImportPictureFromUrl(editRow)}
                >
                  Save URL to Supabase
                </button>
                {editRow?.picture_path ? (
                  <button
                    type="button"
                    className="inv-btn"
                    disabled={imageBusy}
                    onClick={() => editRow && void handleRemoveStoredPicture(editRow)}
                  >
                    Remove stored image
                  </button>
                ) : null}
              </div>
              <label>
                Source / vendor picture URL
                <input
                  type="url"
                  placeholder="https://…"
                  value={editDraft.picture_url ?? ''}
                  onChange={(e) => setEditDraft((d) => ({ ...d, picture_url: e.target.value }))}
                />
              </label>
            </fieldset>
            <label>
              Purchase URL
              <input
                type="url"
                placeholder="https://…"
                value={editDraft.purchase_url ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, purchase_url: e.target.value }))}
              />
            </label>
            <div className="inv-modal-actions">
              <button type="button" className="inv-btn" onClick={() => setEditRow(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="inv-btn inv-btn-primary" onClick={() => void saveEdit()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="inv-btn"
                onClick={() => void runLookupForRow(editRow, false)}
                disabled={lookupLoading}
              >
                Preview lookup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
