import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import BarcodeScanner from './components/BarcodeScanner'
import DocumentScanner from './components/DocumentScanner'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { cropDocumentToBlob } from './lib/documentScanner'
import {
  displayPartTitle,
  fieldsFromRecord,
  formatDateTime,
  todayLocalDate,
} from './partsHelpers'
import { fetchDtoolsProducts, fetchParts, fillDtoolsUpcFromCheckIn, findDtoolsInList, findExistingPart, insertCheckIn, insertPartIfMissing, mergeCatalog } from './services/partsService'
import {
  CATALOG_FIELD_LABELS,
  EMPTY_PART_FIELDS,
  PART_FIELD_LABELS,
  type PartFields,
  type TrackedPart,
} from './types'
import './App.css'

type ScannerMode = 'checkin' | 'parts'

type PendingDocument = {
  id: string
  name: string
  blob: Blob
  previewUrl: string
}

function newPendingId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

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

function readScannerMode(): ScannerMode {
  if (typeof window === 'undefined') return 'checkin'
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase()
  if (path.endsWith('/parts') || path.endsWith('/catalog')) return 'parts'
  const mode = new URLSearchParams(window.location.search).get('mode')
  if (mode === 'parts' || mode === 'catalog') return 'parts'
  return 'checkin'
}

function catalogScannerHref(fields?: {
  upc?: string
  po?: string
  partName?: string
  description?: string
}): string {
  if (typeof window === 'undefined') return '?mode=parts'
  const url = new URL(window.location.href)
  url.searchParams.set('mode', 'parts')
  const upc = fields?.upc?.trim()
  const po = fields?.po?.trim()
  const partName = fields?.partName?.trim()
  const description = fields?.description?.trim()
  if (upc) url.searchParams.set('upc', upc)
  else url.searchParams.delete('upc')
  url.searchParams.delete('code')
  url.searchParams.delete('barcode')
  if (po) url.searchParams.set('po', po)
  else url.searchParams.delete('po')
  if (partName) url.searchParams.set('name', partName)
  else url.searchParams.delete('name')
  if (description) url.searchParams.set('description', description)
  else url.searchParams.delete('description')
  return url.toString()
}

function partsTrackerHref(): string {
  const configured = import.meta.env.VITE_PARTS_TRACKER_URL?.trim()
  if (configured) return configured.replace(/\/?$/, '/')
  if (typeof window === 'undefined') return '/parts/'
  return new URL('/parts/', window.location.origin).toString()
}

function partSearchHaystack(part: TrackedPart): string {
  return [part.part_name, part.upc_code, part.ipn, part.manufacturer, part.vendor, part.description]
    .map((v) => (v ?? '').toLowerCase())
    .join(' ')
}

const SUGGEST_FIELDS: (keyof PartFields)[] = ['upc_code', 'ipn', 'part_name', 'manufacturer', 'vendor']

export default function App() {
  const mode = useMemo(readScannerMode, [])
  const isCatalog = mode === 'parts'
  const title = isCatalog ? 'Parts Scanner' : 'Check-In Scanner'
  const subtitle = isCatalog
    ? 'Add a warehouse-only part. This does not go into the D-Tools library.'
    : 'Scan a barcode or search the D-Tools library to check it in.'

  const [showScanner, setShowScanner] = useState(false)
  const [showDocScanner, setShowDocScanner] = useState(false)
  const [formOpen, setFormOpen] = useState(() => readScannerMode() !== 'parts')
  const [fields, setFields] = useState<PartFields>(EMPTY_PART_FIELDS)
  const [quantity, setQuantity] = useState('1')
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([])
  const [checkInAt, setCheckInAt] = useState(() => new Date())
  const [selectedPart, setSelectedPart] = useState<TrackedPart | null>(null)
  const [catalog, setCatalog] = useState<TrackedPart[]>([])
  const [suggestField, setSuggestField] = useState<keyof PartFields | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [manualBarcode, setManualBarcode] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const openingCatalogRef = useRef(false)

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    Promise.all([fetchParts(), fetchDtoolsProducts()])
      .then(([tracked, library]) => {
        if (!cancelled) setCatalog(mergeCatalog(tracked, library))
      })
      .catch(() => {
        if (!cancelled) setCatalog([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.parts-suggest-wrap')) setSuggestField(null)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  const applyMatchedPart = (part: TrackedPart, upcFallback?: string) => {
    setSelectedPart(part)
    setFields((prev) => ({
      ...fieldsFromRecord(part),
      upc_code: part.upc_code || upcFallback || prev.upc_code,
      po: prev.po,
      description: prev.description.trim() || fieldsFromRecord(part).description,
    }))
  }

  const applyBarcode = useCallback(async (raw: string, extras?: Partial<Pick<PartFields, 'po' | 'part_name' | 'description'>>) => {
    const barcode = extractBarcode(raw)
    if (!barcode) return
    setShowScanner(false)
    setFormOpen(true)
    setStatus(null)
    setCheckInAt(new Date())
    setLookupLoading(true)
    const next: PartFields = {
      ...EMPTY_PART_FIELDS,
      upc_code: barcode,
      po: extras?.po?.trim() ?? '',
      part_name: extras?.part_name?.trim() ?? '',
      description: extras?.description?.trim() ?? '',
    }
    setFields(next)
    setSelectedPart(null)
    try {
      if (!supabase) return
      const existing = await findExistingPart(next)
      if (existing) {
        applyMatchedPart(existing, barcode)
        return
      }
      const library = await fetchDtoolsProducts()
      const dtools = findDtoolsInList(library, barcode)
      if (dtools) applyMatchedPart(mergeCatalog([], [dtools])[0], barcode)
    } catch (err) {
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
    const extras = {
      po: params.get('po') || '',
      part_name: params.get('name') || params.get('part_name') || '',
      description: params.get('description') || params.get('desc') || '',
    }
    if (upc) {
      void applyBarcode(upc, extras)
      return
    }
    if (extras.po || extras.part_name || extras.description) {
      setFormOpen(true)
      setFields((prev) => ({ ...prev, ...extras }))
    }
  }, [applyBarcode])

  const setField = (key: keyof PartFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }))
    if (key === 'upc_code' || key === 'ipn' || key === 'part_name') setSelectedPart(null)
  }

  const resetForm = () => {
    setPendingDocs((prev) => {
      prev.forEach((doc) => URL.revokeObjectURL(doc.previewUrl))
      return []
    })
    setQuantity('1')
    setFields(EMPTY_PART_FIELDS)
    setCheckInAt(new Date())
    setSelectedPart(null)
    setFormOpen(isCatalog ? false : true)
    setManualBarcode('')
    setSuggestField(null)
  }

  const addPendingDocument = useCallback((blob: Blob, name: string) => {
    const previewUrl = URL.createObjectURL(blob)
    setPendingDocs((prev) => [...prev, { id: newPendingId(), name, blob, previewUrl }])
  }, [])

  const removePendingDocument = (id: string) => {
    setPendingDocs((prev) => {
      const next = prev.filter((doc) => doc.id !== id)
      prev.filter((doc) => doc.id === id).forEach((doc) => URL.revokeObjectURL(doc.previewUrl))
      return next
    })
  }

  const handleDocumentCapture = (blob: Blob) => {
    addPendingDocument(blob, `scan_${Date.now()}.jpg`)
    setShowDocScanner(false)
  }

  const handleDocumentFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
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
      addPendingDocument(blob, name)
    }
  }

  const checkInExtras = () => ({
    quantity: Number.parseInt(quantity, 10),
    files: pendingDocs.map((doc) => ({ blob: doc.blob, name: doc.name })),
  })

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (manualBarcode.trim()) void applyBarcode(manualBarcode)
    else {
      setFormOpen(true)
      setCheckInAt(new Date())
      setFields(EMPTY_PART_FIELDS)
      setSelectedPart(null)
    }
  }

  const lookupFromCatalog = async () => {
    if (!supabase || lookupLoading) return
    if (!fields.upc_code.trim() && !fields.ipn.trim()) return
    setLookupLoading(true)
    try {
      const existing = await findExistingPart(fields)
      if (existing) applyMatchedPart(existing, fields.upc_code.trim() || undefined)
      else {
        const q = (fields.upc_code || fields.ipn).trim()
        const hit = catalog.find((part) => {
          const upc = (part.upc_code ?? '').replace(/\s+/g, '').toLowerCase()
          const ipn = (part.ipn ?? '').replace(/\s+/g, '').toLowerCase()
          const key = q.replace(/\s+/g, '').toLowerCase()
          return Boolean(key) && (upc === key || ipn === key)
        })
        if (hit) applyMatchedPart(hit, fields.upc_code.trim() || undefined)
      }
    } catch {
      /* keep typed values */
    } finally {
      setLookupLoading(false)
    }
  }

  const catalogSuggestions = useMemo(() => {
    if (!suggestField) return []
    const q = fields[suggestField].trim().toLowerCase()
    if (q.length < 1) return []
    return catalog.filter((part) => partSearchHaystack(part).includes(q)).slice(0, 20)
  }, [catalog, fields, suggestField])

  const nameQuery = fields.part_name.trim()
  const showAddPartCta =
    !isCatalog &&
    formOpen &&
    !selectedPart &&
    (fields.upc_code.trim().length > 0 || fields.ipn.trim().length > 0 || nameQuery.length > 0) &&
    catalog
      .filter((part) =>
        partSearchHaystack(part).includes(
          (fields.upc_code || fields.ipn || fields.part_name).trim().toLowerCase(),
        ),
      ).length === 0

  const pickSuggestion = (part: TrackedPart) => {
    applyMatchedPart(part)
    setSuggestField(null)
  }

  const suggestList = (field: keyof PartFields) =>
    suggestField === field && catalogSuggestions.length > 0 ? (
      <ul id={`${field}-suggestions`} className="suggest-list" role="listbox">
        {catalogSuggestions.map((part) => (
          <li key={part.id}>
            <button
              type="button"
              className="suggest-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSuggestion(part)}
            >
              <span className="suggest-item-title">{displayPartTitle(part)}</span>
              <span className="suggest-item-meta">
                {[part.ipn ? `IPN ${part.ipn}` : '', part.upc_code ? `UPC ${part.upc_code}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : null

  const openCatalogScanner = () => {
    if (openingCatalogRef.current) return
    openingCatalogRef.current = true
    window.location.assign(
      catalogScannerHref({
        upc: fields.upc_code,
        po: fields.po,
        partName: fields.part_name,
        description: fields.description,
      }),
    )
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setStatus(null)
    try {
      if (isCatalog) {
        const existing = await findExistingPart(fields)
        if (existing) {
          const snapshot = {
            ...fieldsFromRecord(existing),
            upc_code: fields.upc_code.trim() || existing.upc_code,
            part_name: fields.part_name.trim() || existing.part_name,
            po: fields.po.trim(),
            description: fields.description.trim() || existing.description,
          }
          await insertCheckIn(snapshot, todayLocalDate(), existing.id, checkInExtras())
          window.location.assign(partsTrackerHref())
          return
        }
        const hasCatalogData = CATALOG_FIELD_LABELS.some(({ key }) => fields[key].trim().length > 0)
        if (!hasCatalogData) {
          setStatus({ type: 'error', message: 'Enter at least one field to add a part.' })
          return
        }
        const part = await insertPartIfMissing({ ...fields, po: '' })
        const snapshot = {
          ...fieldsFromRecord(part),
          po: fields.po.trim(),
          description: fields.description.trim() || part.description,
        }
        await insertCheckIn(snapshot, todayLocalDate(), part.id, checkInExtras())
        window.location.assign(partsTrackerHref())
        return
      }

      if (!selectedPart) {
        setStatus({
          type: 'error',
          message: 'Choose a part from the catalog, or add it in Parts Scanner first.',
        })
        return
      }

      const snapshot = {
        ...fieldsFromRecord(selectedPart),
        upc_code: fields.upc_code.trim() || selectedPart.upc_code,
        part_name: fields.part_name.trim() || selectedPart.part_name,
        po: fields.po.trim(),
        description: fields.description.trim() || selectedPart.description,
      }
      const stored = await insertPartIfMissing({ ...snapshot, po: '' })
      await insertCheckIn(snapshot, todayLocalDate(), stored.id, checkInExtras())
      await fillDtoolsUpcFromCheckIn(snapshot, selectedPart.id)
      setStatus({
        type: 'success',
        message: `Checked in: ${displayPartTitle(snapshot)}`,
      })
      resetForm()
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not save.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>
            <a href="/" className="home-title-link">
              {title}
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
            {title}
          </a>
        </h1>
        <p className="app-subtitle">{subtitle}</p>
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
                {manualBarcode.trim() ? 'Continue' : isCatalog ? 'Enter without barcode' : 'Search by part name'}
              </button>
            </form>
          </section>
        ) : isCatalog ? (
          <form onSubmit={handleSave} className="section form-section">
            {lookupLoading && <p className="box-meta-loading">Looking up this part…</p>}
            {selectedPart && !lookupLoading && (
              <div className="last-scan-panel" role="status">
                <strong>Existing part</strong>
                <p className="last-scan-panel-main">{displayPartTitle(selectedPart)}</p>
                <p className="last-scan-panel-meta">This part is already in the catalog. Saving will check it in without creating a duplicate.</p>
              </div>
            )}

            {PART_FIELD_LABELS.map(({ key, label }) => (
              <div className={`form-field${SUGGEST_FIELDS.includes(key) ? ' parts-suggest-wrap' : ''}`} key={key}>
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
                    onFocus={() => {
                      if (SUGGEST_FIELDS.includes(key)) setSuggestField(key)
                    }}
                    onBlur={key === 'upc_code' || key === 'ipn' ? () => void lookupFromCatalog() : undefined}
                    placeholder={
                      key === 'upc_code'
                        ? 'Scan or type UPC'
                        : key === 'ipn'
                          ? 'Type IPN to search catalog'
                          : key === 'po'
                            ? 'Purchase order number'
                            : SUGGEST_FIELDS.includes(key)
                              ? 'Start typing to search the catalog'
                              : undefined
                    }
                    autoComplete="off"
                    role={SUGGEST_FIELDS.includes(key) ? 'combobox' : undefined}
                    aria-expanded={suggestField === key && catalogSuggestions.length > 0}
                    aria-controls={SUGGEST_FIELDS.includes(key) ? `${key}-suggestions` : undefined}
                  />
                )}
                {SUGGEST_FIELDS.includes(key) ? suggestList(key) : null}
              </div>
            ))}

            <div className="po-qty-row">
              <div className="form-field form-field-qty">
                <label className="label" htmlFor="field-quantity-catalog">
                  Qty
                </label>
                <input
                  id="field-quantity-catalog"
                  type="number"
                  min={1}
                  step={1}
                  className="input input-qty"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <span className="label">Documents</span>
              <div className="docs-row">
                <label className="btn btn-secondary docs-file-btn">
                  Add file
                  <input type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => void handleDocumentFiles(e)} />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => setShowDocScanner(true)}>
                  Scan
                </button>
              </div>
              {pendingDocs.length > 0 ? (
                <ul className="docs-list">
                  {pendingDocs.map((doc) => (
                    <li key={doc.id} className="docs-item">
                      {doc.blob.type.startsWith('image/') ? (
                        <img src={doc.previewUrl} alt="" className="docs-thumb" />
                      ) : null}
                      <span className="docs-name">{doc.name}</span>
                      <button type="button" className="docs-remove" onClick={() => removePendingDocument(doc.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Optional packing slip or paperwork for this check-in.</p>
              )}
            </div>

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
                {submitting ? 'Saving…' : 'Save part and Check-In'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSave} className="section form-section">
            <button
              type="button"
              className="btn btn-primary btn-full scan-now-btn"
              onClick={() => setShowScanner(true)}
            >
              Scan barcode
            </button>
            {lookupLoading && <p className="box-meta-loading">Looking up this part…</p>}

            <div className="form-field">
              <span className="label">Check-in date and time</span>
              <div className="readonly-display">{formatDateTime(checkInAt.toISOString())}</div>
            </div>

            <div className="po-qty-row">
              <div className="form-field">
                <label className="label" htmlFor="field-po">
                  PO
                </label>
                <input
                  id="field-po"
                  type="text"
                  className="input"
                  value={fields.po}
                  onChange={(e) => setField('po', e.target.value)}
                  placeholder="Purchase order number"
                  autoComplete="off"
                />
              </div>
              <div className="form-field form-field-qty">
                <label className="label" htmlFor="field-quantity">
                  Qty
                </label>
                <input
                  id="field-quantity"
                  type="number"
                  min={1}
                  step={1}
                  className="input input-qty"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="form-field parts-suggest-wrap">
              <label className="label" htmlFor="field-upc_code">
                UPC code
              </label>
              <input
                id="field-upc_code"
                type="text"
                className="input"
                value={fields.upc_code}
                onChange={(e) => setField('upc_code', e.target.value)}
                onFocus={() => setSuggestField('upc_code')}
                onBlur={() => void lookupFromCatalog()}
                placeholder="Scan or type UPC"
                autoComplete="off"
                autoFocus
                role="combobox"
                aria-expanded={suggestField === 'upc_code' && catalogSuggestions.length > 0}
                aria-controls="upc_code-suggestions"
              />
              {suggestList('upc_code')}
            </div>

            <div className="form-field parts-suggest-wrap">
              <label className="label" htmlFor="field-ipn">
                IPN
              </label>
              <input
                id="field-ipn"
                type="text"
                className="input"
                value={fields.ipn}
                onChange={(e) => setField('ipn', e.target.value)}
                onFocus={() => setSuggestField('ipn')}
                onBlur={() => void lookupFromCatalog()}
                placeholder="Type IPN to search catalog"
                autoComplete="off"
                role="combobox"
                aria-expanded={suggestField === 'ipn' && catalogSuggestions.length > 0}
                aria-controls="ipn-suggestions"
              />
              {suggestList('ipn')}
            </div>

            <div className="form-field parts-suggest-wrap">
              <label className="label" htmlFor="field-part_name">
                Part name
              </label>
              <input
                id="field-part_name"
                type="text"
                className="input"
                value={fields.part_name}
                onChange={(e) => setField('part_name', e.target.value)}
                onFocus={() => setSuggestField('part_name')}
                placeholder="Start typing to search the catalog"
                autoComplete="off"
                role="combobox"
                aria-expanded={suggestField === 'part_name' && catalogSuggestions.length > 0}
                aria-controls="part_name-suggestions"
              />
              {suggestList('part_name')}
            </div>

            <div className="form-field">
              <label className="label" htmlFor="field-description">
                Description
              </label>
              <textarea
                id="field-description"
                className="input textarea"
                rows={3}
                value={fields.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Optional notes for this check-in"
                autoComplete="off"
              />
            </div>

            <div className="form-field">
              <span className="label">Documents</span>
              <div className="docs-row">
                <label className="btn btn-secondary docs-file-btn">
                  Add file
                  <input type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => void handleDocumentFiles(e)} />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => setShowDocScanner(true)}>
                  Scan
                </button>
              </div>
              {pendingDocs.length > 0 ? (
                <ul className="docs-list">
                  {pendingDocs.map((doc) => (
                    <li key={doc.id} className="docs-item">
                      {doc.blob.type.startsWith('image/') ? (
                        <img src={doc.previewUrl} alt="" className="docs-thumb" />
                      ) : null}
                      <span className="docs-name">{doc.name}</span>
                      <button type="button" className="docs-remove" onClick={() => removePendingDocument(doc.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Optional packing slip or paperwork for this check-in.</p>
              )}
            </div>

            {showAddPartCta && (
              <div className="missing-part-panel" role="status">
                <p>
                  {fields.upc_code.trim() || fields.ipn.trim() || fields.part_name.trim()
                    ? 'This UPC, IPN, or part name is not in the catalog yet.'
                    : 'Choose a catalog part to check in.'}
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-full"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openCatalogScanner}
                >
                Add warehouse part
                </button>
              </div>
            )}

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
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || lookupLoading || !selectedPart}
              >
                {submitting ? 'Saving…' : 'Save check-in'}
              </button>
            </div>
          </form>
        )}
      </main>

      {showScanner && <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      {showDocScanner && (
        <DocumentScanner onCapture={handleDocumentCapture} onClose={() => setShowDocScanner(false)} />
      )}
    </div>
  )
}
