import { useCallback, useEffect, useState } from 'react'
import BarcodeScanner from './components/BarcodeScanner'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import {
  fetchRecentItems,
  findItemByBarcode,
  findItemByPartNumber,
  hasMinimumData,
  insertCatalogItem,
  updateCatalogItem,
} from './services/catalogService'
import { emptyForm, formFromItem, type WarehouseCatalogForm, type WarehouseCatalogItem } from './types'
import './App.css'

type Status = { type: 'success' | 'error' | 'info'; message: string } | null
type ScanTarget = 'upc_code' | 'alt_upc_code' | null

function displayTitle(item: WarehouseCatalogItem): string {
  return item.name?.trim() || item.part_number?.trim() || item.upc_code?.trim() || 'Untitled item'
}

function displayMeta(item: WarehouseCatalogItem): string {
  const parts: string[] = []
  if (item.part_number) parts.push(`PN: ${item.part_number}`)
  if (item.upc_code) parts.push(`UPC: ${item.upc_code}`)
  if (item.alt_upc_code) parts.push(`Alt: ${item.alt_upc_code}`)
  return parts.join(' · ') || 'No barcodes yet'
}

export default function App() {
  const [form, setForm] = useState<WarehouseCatalogForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [recent, setRecent] = useState<WarehouseCatalogItem[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [scanTarget, setScanTarget] = useState<ScanTarget>(null)

  const refreshRecent = useCallback(async () => {
    if (!supabase) return
    setLoadingRecent(true)
    try {
      setRecent(await fetchRecentItems())
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not load recent items.',
      })
    } finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    void refreshRecent()
  }, [refreshRecent])

  const setField = (key: keyof WarehouseCatalogForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const resetForm = () => {
    setForm(emptyForm())
    setEditingId(null)
    setShowOptional(false)
  }

  const loadItem = (item: WarehouseCatalogItem) => {
    setForm(formFromItem(item))
    setEditingId(item.id)
    setShowOptional(
      Boolean(
        item.vendor ||
          item.manufacturer ||
          item.category ||
          item.maximum_stock != null ||
          item.notes
      )
    )
    setStatus({ type: 'info', message: `Editing "${displayTitle(item)}".` })
  }

  const lookupExisting = useCallback(async (candidate?: WarehouseCatalogForm) => {
    if (!supabase) return
    const source = candidate ?? form
    const upc = source.upc_code.trim()
    const alt = source.alt_upc_code.trim()
    const pn = source.part_number.trim()

    try {
      let found: WarehouseCatalogItem | null = null
      if (upc) found = await findItemByBarcode(upc)
      if (!found && alt) found = await findItemByBarcode(alt)
      if (!found && pn) found = await findItemByPartNumber(pn)

      if (found) {
        loadItem(found)
        setStatus({
          type: 'info',
          message: `Found existing entry for "${displayTitle(found)}". Update and save to change it.`,
        })
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lookup failed.',
      })
    }
  }, [form])

  const handleScan = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || !scanTarget) return
    const nextForm = { ...form, [scanTarget]: trimmed }
    setForm(nextForm)
    setScanTarget(null)
    void lookupExisting(nextForm)
  }

  const openScanner = async (target: ScanTarget) => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus({ type: 'error', message: 'Configure Supabase first, then redeploy.' })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({
        type: 'error',
        message: 'Camera requires HTTPS (or localhost). Open this app via https:// on your phone.',
      })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      stream.getTracks().forEach((t) => t.stop())
      setScanTarget(target)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setStatus({ type: 'error', message: 'Camera permission denied. Allow camera in browser settings.' })
      } else {
        setStatus({ type: 'error', message: msg || 'Could not access camera.' })
      }
    }
  }

  const saveItem = async () => {
    if (!supabase) {
      setStatus({ type: 'error', message: 'Supabase is not configured.' })
      return
    }
    if (!hasMinimumData(form)) {
      setStatus({ type: 'error', message: 'Enter at least a part number, name, or barcode.' })
      return
    }

    setSaving(true)
    setStatus(null)
    try {
      if (editingId) {
        const updated = await updateCatalogItem(editingId, form)
        setStatus({ type: 'success', message: `Updated "${displayTitle(updated)}".` })
        setForm(formFromItem(updated))
      } else {
        const created = await insertCatalogItem(form)
        setStatus({ type: 'success', message: `Saved "${displayTitle(created)}".` })
        setForm(emptyForm())
        setEditingId(null)
        setShowOptional(false)
      }
      await refreshRecent()
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not save item.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Warehouse Catalog</h1>
        <p className="app-subtitle">Scan and record product barcodes for the warehouse</p>
      </header>

      <main className="app-main">
        {!isSupabaseConfigured || !supabase ? (
          <section className="section">
            <h2 className="section-title">Setup required</h2>
            <div className="status status-error">
              Add <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> in
              your host environment, then redeploy. Also run{' '}
              <code>supabase/add-warehouse-catalog-items.sql</code> in the Supabase SQL Editor.
            </div>
          </section>
        ) : null}

        {status && <div className={`status status-${status.type}`}>{status.message}</div>}

        <section className="section">
          <div className="section-title-row">
            <h2 className="section-title">{editingId ? 'Edit item' : 'New item'}</h2>
            {editingId ? (
              <button type="button" className="btn-link" onClick={resetForm}>
                New instead
              </button>
            ) : null}
          </div>

          {editingId ? (
            <div className="edit-banner">
              <span>Updating an existing record</span>
              <button type="button" className="btn-link" onClick={resetForm}>
                Clear
              </button>
            </div>
          ) : null}

          <p className="hint">
            Scan or type a UPC first. Part number, name, vendor, and other fields are optional — fill
            in what you have.
          </p>

          <div className="field">
            <label className="label" htmlFor="upc">
              UPC / primary barcode
            </label>
            <div className="input-with-action">
              <input
                id="upc"
                type="text"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Scan or enter UPC"
                value={form.upc_code}
                onChange={(e) => setField('upc_code', e.target.value)}
                onBlur={() => void lookupExisting()}
              />
              <button
                type="button"
                className="btn btn-secondary btn-scan"
                onClick={() => void openScanner('upc_code')}
              >
                Scan
              </button>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="alt-upc">
              Alternate barcode (EAN, inner pack, etc.)
            </label>
            <div className="input-with-action">
              <input
                id="alt-upc"
                type="text"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Optional second barcode"
                value={form.alt_upc_code}
                onChange={(e) => setField('alt_upc_code', e.target.value)}
                onBlur={() => void lookupExisting()}
              />
              <button
                type="button"
                className="btn btn-secondary btn-scan"
                onClick={() => void openScanner('alt_upc_code')}
              >
                Scan
              </button>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="part-number">
              Part number
            </label>
            <input
              id="part-number"
              type="text"
              className="input"
              autoComplete="off"
              placeholder="SKU / IPN / internal part #"
              value={form.part_number}
              onChange={(e) => setField('part_number', e.target.value)}
              onBlur={() => void lookupExisting()}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="name">
              Product name
            </label>
            <input
              id="name"
              type="text"
              className="input"
              autoComplete="off"
              placeholder="Description or product name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>

          <button
            type="button"
            className="optional-toggle"
            onClick={() => setShowOptional((v) => !v)}
          >
            {showOptional ? 'Hide optional fields ▲' : 'Show optional fields (vendor, category, max stock…) ▼'}
          </button>

          {showOptional ? (
            <div className="optional-fields">
              <div className="field">
                <label className="label" htmlFor="vendor">
                  Vendor
                </label>
                <input
                  id="vendor"
                  type="text"
                  className="input"
                  autoComplete="off"
                  placeholder="Supplier or vendor"
                  value={form.vendor}
                  onChange={(e) => setField('vendor', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="manufacturer">
                  Manufacturer
                </label>
                <input
                  id="manufacturer"
                  type="text"
                  className="input"
                  autoComplete="off"
                  placeholder="Brand or manufacturer"
                  value={form.manufacturer}
                  onChange={(e) => setField('manufacturer', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="category">
                  Category
                </label>
                <input
                  id="category"
                  type="text"
                  className="input"
                  autoComplete="off"
                  placeholder="Product category"
                  value={form.category}
                  onChange={(e) => setField('category', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="max-stock">
                  Maximum stock
                </label>
                <input
                  id="max-stock"
                  type="number"
                  min="0"
                  step="any"
                  className="input"
                  inputMode="decimal"
                  placeholder="Reorder / max stock level"
                  value={form.maximum_stock}
                  onChange={(e) => setField('maximum_stock', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="notes">
                  Notes
                </label>
                <textarea
                  id="notes"
                  className="textarea"
                  placeholder="Shelf location, packaging notes, etc."
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void saveItem()}
              disabled={saving || !hasMinimumData(form)}
            >
              {saving ? 'Saving…' : editingId ? 'Update item' : 'Save item'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
              Clear form
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">Recently saved</h2>
          {loadingRecent ? (
            <p className="empty-recent">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="empty-recent">No items yet. Save your first product above.</p>
          ) : (
            <ul className="recent-list">
              {recent.map((item) => (
                <li key={item.id}>
                  <button type="button" className="recent-item" onClick={() => loadItem(item)}>
                    <span className="recent-item-title">{displayTitle(item)}</span>
                    <span className="recent-item-meta">{displayMeta(item)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {scanTarget ? (
        <BarcodeScanner onScan={handleScan} onClose={() => setScanTarget(null)} />
      ) : null}
    </div>
  )
}
