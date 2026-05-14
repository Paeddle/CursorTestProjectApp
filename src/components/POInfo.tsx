import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import Barcode from 'react-barcode'
import { supabase } from '../lib/supabase'
import {
  aggregatePOBarcodeScans,
  buildCatalogLookupMap,
  lookupCatalogItem,
  type AggregatedPOBarcodeRow,
} from '../lib/barcodeCatalogLookup'
import type { POBarcode, PODocument, POCheckinSummary, BarcodeCatalogItem } from '../types/poCheckin'
import BarcodeLookupModal from './BarcodeLookupModal'
import './POInfo.css'

const STORAGE_BUCKET = 'po-documents'

function isConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.length > 0 && typeof key === 'string' && key.length > 0
}

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function documentTypeLabel(type: string) {
  const t = (type || '').toLowerCase()
  if (t === 'packing_slip') return 'Packing slip'
  if (t === 'paperwork') return 'Paperwork'
  return type || 'Document'
}

async function loadSummaries(): Promise<POCheckinSummary[]> {
  const [barcodesRes, docsRes] = await Promise.all([
    supabase.from('po_barcodes').select('*').order('scanned_at', { ascending: false }),
    supabase.from('po_documents').select('*').order('scanned_at', { ascending: false }),
  ])
  if (barcodesRes.error) throw new Error(barcodesRes.error.message)
  if (docsRes.error) throw new Error(docsRes.error.message)
  const barcodes = (barcodesRes.data ?? []) as POBarcode[]
  const documents = (docsRes.data ?? []) as PODocument[]
  const byPo = new Map<string, POCheckinSummary>()
  for (const b of barcodes) {
    const po = (b.po_number || '').trim()
    if (!po) continue
    const key = po.toLowerCase()
    if (!byPo.has(key)) byPo.set(key, { po_number: po, barcodes: [], documents: [] })
    byPo.get(key)!.barcodes.push(b)
  }
  for (const d of documents) {
    const po = (d.po_number || '').trim()
    if (!po) continue
    const key = po.toLowerCase()
    if (!byPo.has(key)) byPo.set(key, { po_number: po, barcodes: [], documents: [] })
    byPo.get(key)!.documents.push(d)
  }
  return Array.from(byPo.values()).sort((a, b) =>
    a.po_number.localeCompare(b.po_number, undefined, { numeric: true })
  )
}

function pathFromStorageUrl(fileUrl: string, bucketId: string): string | null {
  const marker = `/object/public/${bucketId}/`
  const i = fileUrl.indexOf(marker)
  if (i === -1) return null
  return fileUrl.slice(i + marker.length)
}

function makeQtyEditKey(poNumber: string, barcodeValue: string): string {
  return `${poNumber}\u0000${barcodeValue}`
}

type PoScanSortColumn = 'item' | 'qty' | 'lastScan'
type PoScanSortState = { column: PoScanSortColumn; asc: boolean }
type CatalogSortColumn = 'item' | 'manufacturer'

function sortKeyItemName(catalogMap: Map<string, BarcodeCatalogItem>, barcode: string): string {
  const cat = lookupCatalogItem(catalogMap, barcode)
  const name = (cat?.item_name || '').trim().toLowerCase()
  return name || '\uFFFF'
}

function sortAggregatedRows(
  rows: AggregatedPOBarcodeRow[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  column: PoScanSortColumn,
  asc: boolean
): AggregatedPOBarcodeRow[] {
  const mult = asc ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    if (column === 'item') {
      const ka = sortKeyItemName(catalogMap, a.barcode_value)
      const kb = sortKeyItemName(catalogMap, b.barcode_value)
      return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    }
    if (column === 'qty') {
      return mult * (a.quantity - b.quantity)
    }
    const ta = new Date(a.last_scanned_at).getTime()
    const tb = new Date(b.last_scanned_at).getTime()
    return mult * (ta - tb)
  })
  return copy
}

function sortCatalogRows(
  items: BarcodeCatalogItem[],
  column: CatalogSortColumn,
  asc: boolean
): BarcodeCatalogItem[] {
  const mult = asc ? 1 : -1
  const copy = [...items]
  copy.sort((a, b) => {
    if (column === 'item') {
      const ka = ((a.item_name || '').trim() || '\uFFFF').toLowerCase()
      const kb = ((b.item_name || '').trim() || '\uFFFF').toLowerCase()
      return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    }
    const ka = ((a.manufacturer || '').trim() || '\uFFFF').toLowerCase()
    const kb = ((b.manufacturer || '').trim() || '\uFFFF').toLowerCase()
    return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
  })
  return copy
}

function defaultAscForPoScanColumn(column: PoScanSortColumn): boolean {
  return column === 'item'
}

function POInfo() {
  const [summaries, setSummaries] = useState<POCheckinSummary[]>([])
  const [catalog, setCatalog] = useState<BarcodeCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchPo, setSearchPo] = useState('')
  const [expandedPo, setExpandedPo] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [lookupOpen, setLookupOpen] = useState<{
    barcode: string
    catalogSeed: BarcodeCatalogItem | null
    openCatalogEditor: boolean
  } | null>(null)
  const [qtyEditKey, setQtyEditKey] = useState<string | null>(null)
  const [qtyDraft, setQtyDraft] = useState('')
  const [qtySaving, setQtySaving] = useState(false)
  const qtyInputRef = useRef<HTMLInputElement>(null)
  const [poScanSortByKey, setPoScanSortByKey] = useState<Record<string, PoScanSortState>>({})
  const [catalogSort, setCatalogSort] = useState<{ column: CatalogSortColumn; asc: boolean }>({
    column: 'item',
    asc: true,
  })

  const catalogMap = useMemo(() => buildCatalogLookupMap(catalog), [catalog])

  const sortedCatalog = useMemo(
    () => sortCatalogRows(catalog, catalogSort.column, catalogSort.asc),
    [catalog, catalogSort]
  )

  const togglePoScanSort = useCallback((poKey: string, column: PoScanSortColumn) => {
    setPoScanSortByKey((prev) => {
      const cur = prev[poKey]
      if (cur?.column === column) {
        return { ...prev, [poKey]: { column, asc: !cur.asc } }
      }
      return { ...prev, [poKey]: { column, asc: defaultAscForPoScanColumn(column) } }
    })
  }, [])

  const toggleCatalogSort = useCallback((column: CatalogSortColumn) => {
    setCatalogSort((cur) =>
      cur.column === column ? { column, asc: !cur.asc } : { column, asc: true }
    )
  }, [])

  useLayoutEffect(() => {
    if (!qtyEditKey) return
    qtyInputRef.current?.focus()
    qtyInputRef.current?.select()
  }, [qtyEditKey])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, catRes] = await Promise.all([
        loadSummaries(),
        supabase.from('barcode_catalog').select('*').order('item_name', { ascending: true }),
      ])
      if (catRes.error) throw new Error(catRes.error.message)
      setSummaries(list)
      setCatalog((catRes.data ?? []) as BarcodeCatalogItem[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load PO check-in data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isConfigured()) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
      setLoading(false)
      return
    }
    load()
  }, [load])

  const filtered = searchPo.trim()
    ? summaries.filter((s) => s.po_number.toLowerCase().includes(searchPo.trim().toLowerCase()))
    : summaries

  const toggleExpanded = (poNumber: string) => {
    const key = poNumber.toLowerCase()
    setExpandedPo((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleQtyCommit = async (
    poNumber: string,
    barcodeValue: string,
    allBarcodes: POBarcode[],
    currentQty: number,
    draftStr: string
  ) => {
    const n = Math.floor(Number(draftStr))
    if (!Number.isFinite(n) || n < 1) {
      setError('Quantity must be a whole number of at least 1.')
      setQtyEditKey(null)
      return
    }
    if (n === currentQty) {
      setQtyEditKey(null)
      return
    }
    setQtySaving(true)
    setError(null)
    try {
      const po = poNumber.trim()
      const v = barcodeValue.trim()
      const rows = allBarcodes
        .filter((b) => (b.po_number || '').trim() === po && (b.barcode_value || '').trim() === v)
        .sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime())
      if (rows.length !== currentQty) {
        throw new Error('Scan list changed; refresh and try again.')
      }
      if (n < currentQty) {
        const remove = currentQty - n
        const ids = rows.slice(0, remove).map((b) => b.id)
        const { error: e } = await supabase.from('po_barcodes').delete().in('id', ids)
        if (e) throw new Error(e.message)
      } else {
        const add = n - currentQty
        const scanned_at = new Date().toISOString()
        const inserts = Array.from({ length: add }, () => ({
          po_number: po,
          barcode_value: v,
          scanned_at,
        }))
        const { error: e } = await supabase.from('po_barcodes').insert(inserts)
        if (e) throw new Error(e.message)
      }
      setQtyEditKey(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quantity')
    } finally {
      setQtySaving(false)
    }
  }

  const handleDeleteBarcodeIds = async (ids: string[]) => {
    if (deletingId || ids.length === 0) return
    setDeletingId(ids[0])
    try {
      const { error: e } = await supabase.from('po_barcodes').delete().in('id', ids)
      if (e) throw new Error(e.message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete barcode')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteDocument = async (doc: PODocument) => {
    if (deletingId) return
    setDeletingId(doc.id)
    try {
      const path = pathFromStorageUrl(doc.file_url, STORAGE_BUCKET)
      if (path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([path])
      }
      const { error: e } = await supabase.from('po_documents').delete().eq('id', doc.id)
      if (e) throw new Error(e.message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteEntirePo = async (poNumber: string) => {
    if (deletingId || !window.confirm(`Delete all barcodes and documents for PO ${poNumber}? This cannot be undone.`)) return
    const key = poNumber.toLowerCase()
    setDeletingId(key)
    try {
      const { error: eb } = await supabase.from('po_barcodes').delete().eq('po_number', poNumber)
      if (eb) throw new Error(eb.message)
      const summary = summaries.find((s) => s.po_number.toLowerCase() === key)
      if (summary) {
        for (const doc of summary.documents) {
          const path = pathFromStorageUrl(doc.file_url, STORAGE_BUCKET)
          if (path) await supabase.storage.from(STORAGE_BUCKET).remove([path])
        }
      }
      const { error: ed } = await supabase.from('po_documents').delete().eq('po_number', poNumber)
      if (ed) throw new Error(ed.message)
      await load()
      setExpandedPo((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete PO')
    } finally {
      setDeletingId(null)
    }
  }

  const openBarcodeLookup = (barcode: string, catalogSeed: BarcodeCatalogItem | null, openCatalogEditor = false) => {
    setLookupOpen({ barcode, catalogSeed, openCatalogEditor })
  }

  const closeBarcodeLookup = () => {
    setLookupOpen(null)
  }

  if (!isConfigured()) {
    return (
      <div className="po-info-page">
        <header className="po-info-header">
          <h1>PO Info</h1>
          <p className="po-info-subtitle">Check-in data from the scanning web app (Supabase)</p>
        </header>
        <div className="po-info-setup">
          <p>Configure Supabase in your <code>.env</code>:</p>
          <pre>{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}</pre>
          <p>Run <code>supabase/schema.sql</code> in the Supabase SQL Editor to create tables.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="po-info-page">
      <header className="po-info-header">
        <h1>PO Info</h1>
        <p className="po-info-subtitle">
          Barcode scans and documents per PO from the scanning web app.
        </p>
      </header>

      <div className="po-info-controls">
        <input
          type="text"
          className="po-info-search"
          placeholder="Filter by PO number..."
          value={searchPo}
          onChange={(e) => setSearchPo(e.target.value)}
        />
        <button type="button" className="po-info-refresh" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="po-info-error">{error}</div>}

      {loading ? (
        <div className="po-info-loading">Loading PO check-in data…</div>
      ) : filtered.length === 0 ? (
        <div className="po-info-empty">
          <p>
            {searchPo.trim()
              ? 'No POs match your filter.'
              : 'No PO check-in data yet. Data will appear here once the scanning web app pushes barcodes and documents to Supabase.'}
          </p>
        </div>
      ) : (
        <div className="po-info-list">
          {filtered.map((summary) => {
            const key = summary.po_number.toLowerCase()
            const isExpanded = expandedPo.has(key)
            const total = summary.barcodes.length + summary.documents.length
            const agg = aggregatePOBarcodeScans(summary.barcodes)
            const scanSort = poScanSortByKey[key] ?? { column: 'lastScan' as const, asc: false }
            const aggSorted = sortAggregatedRows(agg, catalogMap, scanSort.column, scanSort.asc)
            const scanTotal = summary.barcodes.length
            const unique = agg.length

            return (
              <div key={key} className="po-info-card">
                <div className="po-info-card-header-row">
                  <button
                    type="button"
                    className="po-info-card-header"
                    onClick={() => toggleExpanded(summary.po_number)}
                    aria-expanded={isExpanded}
                  >
                    <span className="po-info-card-title">PO {summary.po_number}</span>
                    <span className="po-info-card-badge">
                      {[
                        scanTotal > 0 &&
                          `${unique} barcode${unique !== 1 ? 's' : ''}${
                            scanTotal !== unique ? ` · ${scanTotal} scans` : ''
                          }`,
                        summary.documents.length > 0 &&
                          `${summary.documents.length} doc${summary.documents.length !== 1 ? 's' : ''}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No items'}
                    </span>
                    <span className="po-info-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                  </button>
                  <button
                    type="button"
                    className="po-info-delete-po"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteEntirePo(summary.po_number)
                    }}
                    disabled={!!deletingId}
                    title="Delete entire PO"
                  >
                    {deletingId === key ? '…' : 'Delete PO'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="po-info-card-body">
                    {agg.length > 0 && (
                      <section className="po-info-section">
                        <h4>Barcode scans</h4>
                        <p className="po-info-section-desc">
                          Quantities are stored as separate scans. Click a quantity to add or remove rows for
                          that barcode on this PO.
                        </p>
                        <div className="po-info-scan-table-wrap">
                          <table className="po-info-scan-table">
                            <thead>
                              <tr>
                                <th scope="col">Barcode</th>
                                <th
                                  scope="col"
                                  aria-sort={
                                    scanSort.column === 'item'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'item')}
                                  >
                                    Item
                                    {scanSort.column === 'item' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="po-info-scan-th-narrow"
                                  aria-sort={
                                    scanSort.column === 'qty'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'qty')}
                                  >
                                    Qty
                                    {scanSort.column === 'qty' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  aria-sort={
                                    scanSort.column === 'lastScan'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'lastScan')}
                                  >
                                    Last scan
                                    {scanSort.column === 'lastScan' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th scope="col" className="po-info-scan-th-actions" />
                              </tr>
                            </thead>
                            <tbody>
                              {aggSorted.map((row) => {
                                const cat = lookupCatalogItem(catalogMap, row.barcode_value)
                                const deletingRow = row.scan_ids.some((id) => deletingId === id)
                                const qKey = makeQtyEditKey(summary.po_number, row.barcode_value)
                                const editingQty = qtyEditKey === qKey
                                return (
                                  <tr key={row.barcode_value}>
                                    <td>
                                      <button
                                        type="button"
                                        className="po-info-scan-barcode-cell po-info-scan-item-clickable"
                                        onClick={() => openBarcodeLookup(row.barcode_value, cat ?? null, false)}
                                        title="Look up or edit catalog"
                                      >
                                        <div className="po-info-barcode-wrap po-info-barcode-wrap--compact">
                                          <Barcode
                                            value={row.barcode_value}
                                            format="CODE128"
                                            displayValue={false}
                                            width={1}
                                            height={22}
                                            margin={0}
                                            background="#fff"
                                            lineColor="#000"
                                          />
                                        </div>
                                        <code className="po-info-scan-code-text">{row.barcode_value}</code>
                                      </button>
                                    </td>
                                    <td className="po-info-scan-item-name">
                                      {cat ? (
                                        <span className="po-info-catalog-name">{cat.item_name}</span>
                                      ) : (
                                        <span className="po-info-no-catalog">—</span>
                                      )}
                                    </td>
                                    <td className="po-info-scan-qty">
                                      {editingQty ? (
                                        <input
                                          ref={qtyInputRef}
                                          type="number"
                                          min={1}
                                          className="po-info-qty-input"
                                          value={qtyDraft}
                                          disabled={qtySaving}
                                          onChange={(e) => setQtyDraft(e.target.value)}
                                          onBlur={(e) =>
                                            void handleQtyCommit(
                                              summary.po_number,
                                              row.barcode_value,
                                              summary.barcodes,
                                              row.quantity,
                                              e.currentTarget.value
                                            )
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              ;(e.target as HTMLInputElement).blur()
                                            }
                                            if (e.key === 'Escape') {
                                              e.preventDefault()
                                              setQtyEditKey(null)
                                            }
                                          }}
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          className="po-info-qty-button"
                                          disabled={!!deletingId || qtySaving}
                                          title="Edit quantity"
                                          onClick={() => {
                                            setQtyEditKey(qKey)
                                            setQtyDraft(String(row.quantity))
                                          }}
                                        >
                                          {row.quantity}
                                        </button>
                                      )}
                                    </td>
                                    <td className="po-info-meta">{formatDateTime(row.last_scanned_at)}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="po-info-delete-item"
                                        onClick={() => handleDeleteBarcodeIds(row.scan_ids)}
                                        disabled={!!deletingId}
                                        title="Remove all scans of this barcode for this PO"
                                      >
                                        {deletingRow ? '…' : '✕'}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                    {summary.documents.length > 0 && (
                      <section className="po-info-section">
                        <h4>Documents</h4>
                        <p className="po-info-section-desc">
                          Files from the scanner app. Delete removes the database row and the file from
                          storage when the link points at this project&apos;s bucket.
                        </p>
                        <ul className="po-info-doc-list">
                          {summary.documents.map((d) => (
                            <li key={d.id} className="po-info-doc-item">
                              <a
                                href={d.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="po-info-doc-link"
                              >
                                {d.name || documentTypeLabel(d.document_type)}
                              </a>
                              <span className="po-info-meta">
                                {documentTypeLabel(d.document_type)} · {formatDateTime(d.scanned_at)}
                              </span>
                              <button
                                type="button"
                                className="po-info-delete-item"
                                onClick={() => handleDeleteDocument(d)}
                                disabled={!!deletingId}
                                title="Delete document"
                              >
                                {deletingId === d.id ? '…' : '✕'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {total === 0 && (
                      <p className="po-info-no-items">No scans or documents for this PO yet.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && (
        <section className="po-info-catalog-section">
          <h2 className="po-info-catalog-section-title">Barcode catalog</h2>
          <p className="po-info-section-desc po-info-catalog-section-desc">
            Items you have saved for lookups. Edit opens the same catalog form as from a PO scan.
          </p>
          {catalog.length === 0 ? (
            <p className="po-info-catalog-empty">No catalog entries yet. Look up a barcode from a PO and use &quot;Add to your Catalog&quot;.</p>
          ) : (
            <div className="po-info-catalog-table-wrap">
              <table className="po-info-catalog-table">
                <thead>
                  <tr>
                    <th scope="col">Barcode</th>
                    <th
                      scope="col"
                      aria-sort={
                        catalogSort.column === 'item'
                          ? catalogSort.asc
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="po-info-sort-btn"
                        onClick={() => toggleCatalogSort('item')}
                      >
                        Item
                        {catalogSort.column === 'item' ? (
                          <span className="po-info-sort-indicator" aria-hidden>
                            {catalogSort.asc ? ' ▲' : ' ▼'}
                          </span>
                        ) : null}
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={
                        catalogSort.column === 'manufacturer'
                          ? catalogSort.asc
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="po-info-sort-btn"
                        onClick={() => toggleCatalogSort('manufacturer')}
                      >
                        Manufacturer
                        {catalogSort.column === 'manufacturer' ? (
                          <span className="po-info-sort-indicator" aria-hidden>
                            {catalogSort.asc ? ' ▲' : ' ▼'}
                          </span>
                        ) : null}
                      </button>
                    </th>
                    <th scope="col" className="po-info-catalog-th-actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedCatalog.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code className="po-info-catalog-code">{row.barcode_value}</code>
                      </td>
                      <td className="po-info-catalog-item-cell">{row.item_name}</td>
                      <td className="po-info-meta">{row.manufacturer || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="po-info-catalog-edit-btn"
                          onClick={() => openBarcodeLookup(row.barcode_value, row, true)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {lookupOpen && (
        <BarcodeLookupModal
          barcodeValue={lookupOpen.barcode}
          catalogSeed={lookupOpen.catalogSeed}
          openCatalogEditor={lookupOpen.openCatalogEditor}
          onClose={closeBarcodeLookup}
          onCatalogSaved={() => void load()}
        />
      )}
    </div>
  )
}

export default POInfo
