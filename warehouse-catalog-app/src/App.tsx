import { useCallback, useEffect, useRef, useState } from 'react'
import FieldHistoryInput from './components/FieldHistoryInput'
import FieldHistoryTextarea from './components/FieldHistoryTextarea'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import {
  fetchFieldSuggestions,
  findItemByBarcode,
  findItemByPartNumber,
  hasMinimumData,
  insertCatalogItem,
  searchItems,
  updateCatalogItem,
} from './services/catalogService'
import {
  STICKY_FIELD_KEYS,
  emptyForm,
  emptySuggestions,
  formFromItem,
  type FieldSuggestions,
  type WarehouseCatalogForm,
  type WarehouseCatalogItem,
} from './types'
import './App.css'

type Status = { type: 'success' | 'error' | 'info'; message: string } | null

const STICKY_PREF_KEY = 'warehouse-catalog-sticky-fields'

const FIELD_FOCUS_ORDER: (keyof WarehouseCatalogForm)[] = [
  'upc_code',
  'part_number',
  'name',
  'alt_upc_code',
  'vendor',
  'manufacturer',
  'category',
  'maximum_stock',
  'notes',
]

function displayTitle(item: WarehouseCatalogItem): string {
  return item.name?.trim() || item.part_number?.trim() || item.upc_code?.trim() || 'Untitled item'
}

function displayMeta(item: WarehouseCatalogItem): string {
  const parts: string[] = []
  if (item.part_number) parts.push(`PN: ${item.part_number}`)
  if (item.upc_code) parts.push(`UPC: ${item.upc_code}`)
  if (item.vendor) parts.push(item.vendor)
  return parts.join(' · ') || 'No details'
}

function focusField(key: keyof WarehouseCatalogForm) {
  const el = document.getElementById(`field-${key}`)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    el.select?.()
  }
}

function nextFieldKey(key: keyof WarehouseCatalogForm): keyof WarehouseCatalogForm | null {
  const i = FIELD_FOCUS_ORDER.indexOf(key)
  return i >= 0 && i < FIELD_FOCUS_ORDER.length - 1 ? FIELD_FOCUS_ORDER[i + 1] : null
}

function readStickyPref(): boolean {
  try {
    return localStorage.getItem(STICKY_PREF_KEY) !== 'false'
  } catch {
    return true
  }
}

function formAfterSave(
  saved: WarehouseCatalogForm,
  sticky: boolean
): WarehouseCatalogForm {
  const next = emptyForm()
  if (sticky) {
    for (const key of STICKY_FIELD_KEYS) {
      next[key] = saved[key]
    }
  }
  return next
}

export default function App() {
  const [form, setForm] = useState<WarehouseCatalogForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [recent, setRecent] = useState<WarehouseCatalogItem[]>([])
  const [suggestions, setSuggestions] = useState<FieldSuggestions>(emptySuggestions())
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [stickyFields, setStickyFields] = useState(readStickyPref)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const lastSavedRef = useRef<WarehouseCatalogForm | null>(null)
  const searchTimerRef = useRef<number | null>(null)

  const refreshSuggestions = useCallback(async () => {
    if (!supabase) return
    try {
      setSuggestions(await fetchFieldSuggestions())
    } catch {
      /* non-fatal */
    }
  }, [])

  const refreshList = useCallback(async (query = searchQuery) => {
    if (!supabase) return
    setLoadingList(true)
    try {
      setRecent(await searchItems(query))
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not load items.',
      })
    } finally {
      setLoadingList(false)
    }
  }, [searchQuery])

  const refreshCount = useCallback(async () => {
    if (!supabase) return
    const { count, error } = await supabase
      .from('warehouse_catalog_items')
      .select('*', { count: 'exact', head: true })
    if (!error && count != null) setTotalCount(count)
  }, [])

  useEffect(() => {
    void refreshList('')
    void refreshSuggestions()
    void refreshCount()
  }, [refreshList, refreshSuggestions, refreshCount])

  useEffect(() => {
    try {
      localStorage.setItem(STICKY_PREF_KEY, stickyFields ? 'true' : 'false')
    } catch {
      /* ignore */
    }
  }, [stickyFields])

  const setField = (key: keyof WarehouseCatalogForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const resetForm = useCallback((keepSticky = stickyFields) => {
    setForm((prev) => {
      const next = emptyForm()
      if (keepSticky) {
        for (const key of STICKY_FIELD_KEYS) next[key] = prev[key]
      }
      return next
    })
    setEditingId(null)
    setStatus(null)
    window.setTimeout(() => focusField('upc_code'), 0)
  }, [stickyFields])

  const loadItem = useCallback((item: WarehouseCatalogItem) => {
    setForm(formFromItem(item))
    setEditingId(item.id)
    setStatus({ type: 'info', message: `Editing "${displayTitle(item)}".` })
    window.setTimeout(() => focusField('part_number'), 0)
  }, [])

  const lookupExisting = useCallback(async (candidate?: WarehouseCatalogForm) => {
    if (!supabase) return false
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
          message: `Existing record loaded: "${displayTitle(found)}". Save to update.`,
        })
        return true
      }
      return false
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lookup failed.',
      })
      return false
    }
  }, [form, loadItem])

  const handleFieldEnter = (key: keyof WarehouseCatalogForm) => {
    if (key === 'upc_code' || key === 'alt_upc_code' || key === 'part_number') {
      void lookupExisting().then((found) => {
        if (!found) focusField(nextFieldKey(key) ?? 'part_number')
      })
      return
    }
    const next = nextFieldKey(key)
    if (next) focusField(next)
  }

  const applyLastSavedDetails = () => {
    const last = lastSavedRef.current
    if (!last) {
      setStatus({ type: 'info', message: 'No previous save in this session yet.' })
      return
    }
    setForm((prev) => ({
      ...prev,
      vendor: last.vendor,
      manufacturer: last.manufacturer,
      category: last.category,
      maximum_stock: last.maximum_stock,
    }))
  }

  const saveItem = useCallback(async () => {
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
        lastSavedRef.current = formFromItem(updated)
        setStatus({ type: 'success', message: `Updated "${displayTitle(updated)}". Ready for next scan.` })
        const next = formAfterSave(formFromItem(updated), stickyFields)
        setForm(next)
        setEditingId(null)
      } else {
        const created = await insertCatalogItem(form)
        lastSavedRef.current = formFromItem(created)
        setStatus({ type: 'success', message: `Saved "${displayTitle(created)}". Ready for next scan.` })
        setForm(formAfterSave(form, stickyFields))
        setEditingId(null)
      }
      await Promise.all([refreshList(searchQuery), refreshSuggestions(), refreshCount()])
      window.setTimeout(() => focusField('upc_code'), 0)
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not save item.',
      })
    } finally {
      setSaving(false)
    }
  }, [editingId, form, refreshCount, refreshList, refreshSuggestions, searchQuery, stickyFields])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveItem()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        resetForm()
      }
      if (e.key === 'Escape') {
        const active = document.activeElement
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          active.blur()
        } else {
          resetForm()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resetForm, saveItem])

  const onSearchChange = (value: string) => {
    setSearchQuery(value)
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    searchTimerRef.current = window.setTimeout(() => {
      void refreshList(value)
    }, 250)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-main">
          <h1>Warehouse Catalog</h1>
          <p className="app-subtitle">
            Desktop entry — plug in your USB scanner, scan into the UPC field, Tab through fields,{' '}
            <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.
          </p>
        </div>
        {totalCount != null ? (
          <div className="app-stat">{totalCount.toLocaleString()} items in catalog</div>
        ) : null}
      </header>

      {!isSupabaseConfigured || !supabase ? (
        <div className="status status-error app-setup">
          Add <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong>, redeploy,
          and run <code>supabase/add-warehouse-catalog-items.sql</code> in Supabase.
        </div>
      ) : null}

      {status ? <div className={`status status-${status.type} app-status`}>{status.message}</div> : null}

      <div className="app-layout">
        <section className="panel panel-form">
          <div className="panel-head">
            <h2>{editingId ? 'Edit item' : 'New item'}</h2>
            <div className="panel-head-actions">
              {editingId ? (
                <button type="button" className="btn btn-ghost" onClick={() => resetForm()}>
                  New item
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost" onClick={applyLastSavedDetails}>
                Copy last vendor/category
              </button>
            </div>
          </div>

          {editingId ? (
            <div className="edit-banner">Editing existing record — save updates it, or start a new item.</div>
          ) : null}

          <div className="form-grid">
            <div className="form-grid-span2 scan-field">
              <FieldHistoryInput
                id="field-upc_code"
                label="UPC / primary barcode"
                value={form.upc_code}
                suggestions={suggestions.upc_code}
                placeholder="Click here, then scan with USB scanner"
                inputMode="numeric"
                autoFocus
                onChange={(v) => setField('upc_code', v)}
                onEnter={() => handleFieldEnter('upc_code')}
                onBlurExtra={() => void lookupExisting()}
              />
              <span className="field-tip">Scanner sends Enter — lookup runs automatically</span>
            </div>

            <FieldHistoryInput
              id="field-part_number"
              label="Part number"
              value={form.part_number}
              suggestions={suggestions.part_number}
              placeholder="SKU / IPN"
              onChange={(v) => setField('part_number', v)}
              onEnter={() => handleFieldEnter('part_number')}
              onBlurExtra={() => void lookupExisting()}
            />

            <FieldHistoryInput
              id="field-name"
              label="Product name"
              value={form.name}
              suggestions={suggestions.name}
              placeholder="Description"
              onChange={(v) => setField('name', v)}
              onEnter={() => handleFieldEnter('name')}
            />

            <FieldHistoryInput
              id="field-alt_upc_code"
              label="Alternate barcode (EAN, etc.)"
              value={form.alt_upc_code}
              suggestions={suggestions.alt_upc_code}
              placeholder="Optional second barcode"
              inputMode="numeric"
              onChange={(v) => setField('alt_upc_code', v)}
              onEnter={() => handleFieldEnter('alt_upc_code')}
              onBlurExtra={() => void lookupExisting()}
            />

            <FieldHistoryInput
              id="field-vendor"
              label="Vendor"
              value={form.vendor}
              suggestions={suggestions.vendor}
              placeholder="Supplier"
              onChange={(v) => setField('vendor', v)}
              onEnter={() => handleFieldEnter('vendor')}
            />

            <FieldHistoryInput
              id="field-manufacturer"
              label="Manufacturer"
              value={form.manufacturer}
              suggestions={suggestions.manufacturer}
              placeholder="Brand"
              onChange={(v) => setField('manufacturer', v)}
              onEnter={() => handleFieldEnter('manufacturer')}
            />

            <FieldHistoryInput
              id="field-category"
              label="Category"
              value={form.category}
              suggestions={suggestions.category}
              placeholder="Product category"
              onChange={(v) => setField('category', v)}
              onEnter={() => handleFieldEnter('category')}
            />

            <FieldHistoryInput
              id="field-maximum_stock"
              label="Maximum stock"
              type="number"
              inputMode="decimal"
              value={form.maximum_stock}
              suggestions={suggestions.maximum_stock}
              placeholder="Max / reorder qty"
              onChange={(v) => setField('maximum_stock', v)}
              onEnter={() => handleFieldEnter('maximum_stock')}
            />

            <div className="form-grid-span2">
              <FieldHistoryTextarea
                id="field-notes"
                label="Notes"
                value={form.notes}
                suggestions={suggestions.notes}
                placeholder="Shelf, packaging, etc."
                onChange={(v) => setField('notes', v)}
              />
            </div>
          </div>

          <div className="form-footer">
            <label className="sticky-check">
              <input
                type="checkbox"
                checked={stickyFields}
                onChange={(e) => setStickyFields(e.target.checked)}
              />
              Keep vendor, manufacturer, category &amp; max stock for next item
            </label>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveItem()}
                disabled={saving || !hasMinimumData(form)}
              >
                {saving ? 'Saving…' : editingId ? 'Update (Ctrl+S)' : 'Save & next (Ctrl+S)'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => resetForm()} disabled={saving}>
                Clear (Ctrl+N)
              </button>
            </div>

            <p className="shortcuts">
              <kbd>Tab</kbd> next field · <kbd>▾</kbd> or <kbd>Alt+↓</kbd> previous values ·{' '}
              <kbd>Ctrl+S</kbd> save · <kbd>Ctrl+N</kbd> new · <kbd>Esc</kbd> clear/blur
            </p>
          </div>
        </section>

        <aside className="panel panel-list">
          <div className="panel-head">
            <h2>Catalog</h2>
            <button type="button" className="btn btn-ghost" onClick={() => void refreshList(searchQuery)}>
              Refresh
            </button>
          </div>

          <input
            type="search"
            className="search-input"
            placeholder="Search part #, name, UPC, vendor…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />

          {loadingList ? (
            <p className="list-empty">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="list-empty">No items yet.</p>
          ) : (
            <ul className="item-list">
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`item-row${editingId === item.id ? ' item-row-active' : ''}`}
                    onClick={() => loadItem(item)}
                  >
                    <span className="item-row-title">{displayTitle(item)}</span>
                    <span className="item-row-meta">{displayMeta(item)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
