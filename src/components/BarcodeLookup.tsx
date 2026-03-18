import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { BarcodeCatalogItem, POBarcode } from '../types/poCheckin'
import './BarcodeLookup.css'

type LookupResult = {
  barcode: string
  name: string | null
  imageUrl: string | null
  sourceUrl: string | null
  sourceLabel: string
}

type LookupMeta = {
  normalized: string
  digits: string
  looksLikeUpcEan: boolean
}

function isConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.length > 0 && typeof key === 'string' && key.length > 0
}

function normalizeBarcode(v: string): string {
  return (v || '').trim()
}

function getLookupMeta(raw: string): LookupMeta {
  const normalized = normalizeBarcode(raw)
  const digits = normalized.replace(/[^\d]/g, '')
  const looksLikeUpcEan = digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14
  return { normalized, digits, looksLikeUpcEan }
}

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

async function lookupOpenFoodFacts(barcode: string): Promise<LookupResult | null> {
  // Open Food Facts works best for food/consumer goods; other categories may not be found.
  const code = encodeURIComponent(barcode)
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = (await res.json()) as any
  if (!data || data.status !== 1 || !data.product) return null

  const product = data.product
  const name =
    (product.product_name as string | undefined) ||
    (product.generic_name as string | undefined) ||
    (product.abbreviated_product_name as string | undefined) ||
    null

  const imageUrl =
    (product.image_front_url as string | undefined) ||
    (product.image_url as string | undefined) ||
    null

  const sourceUrl = `https://world.openfoodfacts.org/product/${barcode}`

  return {
    barcode,
    name,
    imageUrl,
    sourceUrl,
    sourceLabel: 'Open Food Facts',
  }
}

async function lookupGoUpc(barcode: string, apiKey: string): Promise<LookupResult | null> {
  // Optional provider (requires key). Docs: https://go-upc.com/
  const url = `https://go-upc.com/api/v1/code/${encodeURIComponent(barcode)}?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = (await res.json()) as any
  const product = data?.product
  if (!product) return null

  const name = (product.name as string | undefined) || (product.title as string | undefined) || null
  const imageUrl = (product.imageUrl as string | undefined) || (product.image as string | undefined) || null
  const sourceUrl = `https://go-upc.com/search?q=${encodeURIComponent(barcode)}`

  return {
    barcode,
    name,
    imageUrl,
    sourceUrl,
    sourceLabel: 'Go-UPC',
  }
}

export default function BarcodeLookup() {
  const [barcodes, setBarcodes] = useState<POBarcode[]>([])
  const [catalog, setCatalog] = useState<BarcodeCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filterPo, setFilterPo] = useState('')
  const [filterBarcode, setFilterBarcode] = useState('')

  const [selectedBarcode, setSelectedBarcode] = useState<string>('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupHint, setLookupHint] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [addManufacturer, setAddManufacturer] = useState('')
  const [addItemName, setAddItemName] = useState('')
  const [addImageUrl, setAddImageUrl] = useState('')
  const [addProductUrl, setAddProductUrl] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  useEffect(() => {
    if (!isConfigured()) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
      setLoading(false)
      return
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [barcodesRes, catalogRes] = await Promise.all([
          supabase.from('po_barcodes').select('*').order('scanned_at', { ascending: false }),
          supabase.from('barcode_catalog').select('*').order('updated_at', { ascending: false }),
        ])
        if (barcodesRes.error) throw new Error(barcodesRes.error.message)
        if (catalogRes.error) throw new Error(catalogRes.error.message)
        if (!cancelled) {
          setBarcodes((barcodesRes.data ?? []) as POBarcode[])
          setCatalog((catalogRes.data ?? []) as BarcodeCatalogItem[])
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load barcodes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const barcodeOptions = useMemo(() => {
    const poLower = filterPo.trim().toLowerCase()
    const bLower = filterBarcode.trim().toLowerCase()

    const filtered = barcodes.filter((b) => {
      const po = (b.po_number || '').toLowerCase()
      const val = (b.barcode_value || '').toLowerCase()
      if (poLower && !po.includes(poLower)) return false
      if (bLower && !val.includes(bLower)) return false
      return true
    })

    // Unique barcode values (keep most recent first)
    const seen = new Set<string>()
    const unique: Array<{ barcode: string; po: string; scannedAt: string }> = []
    for (const b of filtered) {
      const code = normalizeBarcode(b.barcode_value)
      if (!code) continue
      const key = code.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unique.push({ barcode: code, po: b.po_number, scannedAt: b.scanned_at })
    }
    return unique
  }, [barcodes, filterPo, filterBarcode])

  const doLookup = async (barcode: string) => {
    const meta = getLookupMeta(barcode)
    if (!meta.normalized) return
    setSelectedBarcode(meta.normalized)
    setLookupLoading(true)
    setLookupError(null)
    setLookupHint(null)
    setResult(null)
    setShowAdd(false)
    try {
      // 1) Internal catalog match first (best for Lutron/ADI/internal labels)
      const candidatesForCatalog: string[] = []
      if (meta.digits) candidatesForCatalog.push(meta.digits)
      if (meta.normalized && meta.normalized !== meta.digits) candidatesForCatalog.push(meta.normalized)

      const match = catalog.find((c) => candidatesForCatalog.includes((c.barcode_value || '').trim()))
      if (match) {
        setResult({
          barcode: match.barcode_value,
          name: match.item_name,
          imageUrl: match.image_url,
          sourceUrl: match.product_url,
          sourceLabel: match.manufacturer ? `Catalog (${match.manufacturer})` : 'Catalog',
        })
        return
      }

      if (!meta.looksLikeUpcEan) {
        setLookupHint(
          'This barcode does not look like a standard UPC/EAN (8/12/13/14 digits). It may be an internal/Code128 label, so public product databases often won’t have a match.'
        )
      }

      const candidates: string[] = []
      if (meta.looksLikeUpcEan) candidates.push(meta.digits)
      if (meta.normalized !== meta.digits && meta.normalized) candidates.push(meta.normalized)

      const goUpcKey = import.meta.env.VITE_GO_UPC_API_KEY as string | undefined

      for (const c of candidates) {
        const off = await lookupOpenFoodFacts(c)
        if (off) {
          setResult(off)
          return
        }
      }

      if (goUpcKey && candidates.length > 0) {
        for (const c of candidates) {
          const r = await lookupGoUpc(c, goUpcKey)
          if (r) {
            setResult(r)
            return
          }
        }
      }

      setLookupError('No match found in available sources.')
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLookupLoading(false)
    }
  }

  const openAdd = () => {
    const meta = getLookupMeta(selectedBarcode)
    setAddManufacturer('')
    setAddItemName('')
    setAddImageUrl('')
    setAddProductUrl('')
    setAddNotes('')
    setLookupHint((prev) => prev ?? (meta.looksLikeUpcEan ? null : 'Tip: internal labels are best handled by saving them to your catalog.'))
    setShowAdd(true)
  }

  const saveAdd = async () => {
    const meta = getLookupMeta(selectedBarcode)
    const barcodeValue = meta.looksLikeUpcEan ? meta.digits : meta.normalized
    if (!barcodeValue || !addItemName.trim()) {
      setLookupError('Please enter at least an Item name.')
      return
    }
    setAddSaving(true)
    setLookupError(null)
    try {
      const insert = {
        barcode_value: barcodeValue,
        manufacturer: addManufacturer.trim() || null,
        item_name: addItemName.trim(),
        image_url: addImageUrl.trim() || null,
        product_url: addProductUrl.trim() || null,
        notes: addNotes.trim() || null,
      }
      const res = await supabase.from('barcode_catalog').insert(insert).select('*').single()
      if (res.error) throw new Error(res.error.message)
      const row = res.data as BarcodeCatalogItem
      setCatalog((prev) => [row, ...prev.filter((c) => c.id !== row.id)])
      setResult({
        barcode: row.barcode_value,
        name: row.item_name,
        imageUrl: row.image_url,
        sourceUrl: row.product_url,
        sourceLabel: row.manufacturer ? `Catalog (${row.manufacturer})` : 'Catalog',
      })
      setShowAdd(false)
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : 'Failed to save to catalog')
    } finally {
      setAddSaving(false)
    }
  }

  if (!isConfigured()) {
    return (
      <div className="barcode-lookup-page">
        <header className="barcode-lookup-header">
          <h1>Barcode Lookup</h1>
          <p className="barcode-lookup-subtitle">Look up item info from scanned barcodes</p>
        </header>
        <div className="barcode-lookup-setup">
          <p>Configure Supabase in your <code>.env</code>:</p>
          <pre>{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="barcode-lookup-page">
      <header className="barcode-lookup-header">
        <h1>Barcode Lookup</h1>
        <p className="barcode-lookup-subtitle">
          Select a scanned barcode and fetch item details (name, image, source).
        </p>
      </header>

      <div className="barcode-lookup-controls">
        <input
          className="barcode-lookup-input"
          value={filterPo}
          onChange={(e) => setFilterPo(e.target.value)}
          placeholder="Filter by PO (optional)"
        />
        <input
          className="barcode-lookup-input"
          value={filterBarcode}
          onChange={(e) => setFilterBarcode(e.target.value)}
          placeholder="Filter by barcode (optional)"
        />
      </div>

      {error && <div className="barcode-lookup-error">{error}</div>}

      {loading ? (
        <div className="barcode-lookup-loading">Loading scanned barcodes…</div>
      ) : barcodeOptions.length === 0 ? (
        <div className="barcode-lookup-empty">No barcodes found (adjust filters or scan some in the scanner app).</div>
      ) : (
        <div className="barcode-lookup-grid">
          <div className="barcode-lookup-list">
            <div className="barcode-lookup-list-header">
              <div>Scanned barcodes</div>
              <div className="barcode-lookup-count">{barcodeOptions.length}</div>
            </div>
            <ul className="barcode-lookup-ul">
              {barcodeOptions.map((b) => (
                <li key={b.barcode}>
                  <button
                    type="button"
                    className={`barcode-lookup-item ${selectedBarcode === b.barcode ? 'active' : ''}`}
                    onClick={() => void doLookup(b.barcode)}
                    disabled={lookupLoading}
                    title={`PO ${b.po} · ${b.scannedAt}`}
                  >
                    <div className="barcode-lookup-item-code">{b.barcode}</div>
                    <div className="barcode-lookup-item-meta">PO {b.po}</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="barcode-lookup-result">
            <div className="barcode-lookup-result-header">Result</div>
            {lookupLoading ? (
              <div className="barcode-lookup-loading">Looking up {selectedBarcode}…</div>
            ) : lookupError ? (
              <div>
                {lookupHint && <div className="barcode-lookup-hint">{lookupHint}</div>}
                <div className="barcode-lookup-error">{lookupError}</div>
                {selectedBarcode && (
                  <a
                    className="barcode-lookup-link"
                    href={googleSearchUrl(`${selectedBarcode} barcode product`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Search the web for this barcode
                  </a>
                )}
                <div style={{ marginTop: '0.75rem' }}>
                  <button type="button" className="barcode-lookup-add-btn" onClick={openAdd}>
                    Add to your Catalog
                  </button>
                </div>
                <div className="barcode-lookup-hint" style={{ marginTop: '0.5rem' }}>
                  Optional: set <code>VITE_GO_UPC_API_KEY</code> to enable a second lookup source.
                </div>
              </div>
            ) : result ? (
              <div className="barcode-lookup-card">
                <div className="barcode-lookup-card-top">
                  <div>
                    <div className="barcode-lookup-card-title">{result.name ?? 'Unknown item'}</div>
                    <div className="barcode-lookup-card-sub">Barcode: <code>{result.barcode}</code></div>
                    <div className="barcode-lookup-card-sub">Source: {result.sourceLabel}</div>
                    {result.sourceUrl && (
                      <a className="barcode-lookup-link" href={result.sourceUrl} target="_blank" rel="noreferrer">
                        View source
                      </a>
                    )}
                    <div style={{ marginTop: '0.75rem' }}>
                      <button type="button" className="barcode-lookup-add-btn" onClick={openAdd}>
                        Add / Edit in your Catalog
                      </button>
                    </div>
                  </div>
                  {result.imageUrl && (
                    <img className="barcode-lookup-image" src={result.imageUrl} alt={result.name ?? result.barcode} />
                  )}
                </div>
              </div>
            ) : (
              <div className="barcode-lookup-hint">Pick a barcode on the left to look it up.</div>
            )}

            {showAdd && (
              <div className="barcode-lookup-modal">
                <div className="barcode-lookup-modal-card">
                  <div className="barcode-lookup-modal-title">Save to Catalog</div>
                  <div className="barcode-lookup-modal-sub">
                    Barcode: <code>{selectedBarcode}</code>
                  </div>
                  <div className="barcode-lookup-form">
                    <label>
                      Manufacturer (optional)
                      <input value={addManufacturer} onChange={(e) => setAddManufacturer(e.target.value)} />
                    </label>
                    <label>
                      Item name *
                      <input value={addItemName} onChange={(e) => setAddItemName(e.target.value)} />
                    </label>
                    <label>
                      Image URL (optional)
                      <input value={addImageUrl} onChange={(e) => setAddImageUrl(e.target.value)} />
                    </label>
                    <label>
                      Product URL (optional)
                      <input value={addProductUrl} onChange={(e) => setAddProductUrl(e.target.value)} />
                    </label>
                    <label>
                      Notes (optional)
                      <input value={addNotes} onChange={(e) => setAddNotes(e.target.value)} />
                    </label>
                  </div>
                  <div className="barcode-lookup-modal-actions">
                    <button
                      type="button"
                      className="barcode-lookup-secondary-btn"
                      onClick={() => setShowAdd(false)}
                      disabled={addSaving}
                    >
                      Cancel
                    </button>
                    <button type="button" className="barcode-lookup-primary-btn" onClick={() => void saveAdd()} disabled={addSaving}>
                      {addSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <div className="barcode-lookup-hint" style={{ marginTop: '0.5rem' }}>
                    If you haven’t created the table yet, run <code>supabase/add-barcode-catalog.sql</code> in Supabase.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

