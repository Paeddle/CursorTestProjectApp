import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { POBarcode } from '../types/poCheckin'
import './BarcodeLookup.css'

type LookupResult = {
  barcode: string
  name: string | null
  imageUrl: string | null
  sourceUrl: string | null
  sourceLabel: string
}

function isConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.length > 0 && typeof key === 'string' && key.length > 0
}

function normalizeBarcode(v: string): string {
  return (v || '').trim()
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

export default function BarcodeLookup() {
  const [barcodes, setBarcodes] = useState<POBarcode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filterPo, setFilterPo] = useState('')
  const [filterBarcode, setFilterBarcode] = useState('')

  const [selectedBarcode, setSelectedBarcode] = useState<string>('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

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
        const res = await supabase.from('po_barcodes').select('*').order('scanned_at', { ascending: false })
        if (res.error) throw new Error(res.error.message)
        if (!cancelled) setBarcodes((res.data ?? []) as POBarcode[])
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
    const code = normalizeBarcode(barcode)
    if (!code) return
    setSelectedBarcode(code)
    setLookupLoading(true)
    setLookupError(null)
    setResult(null)
    try {
      const off = await lookupOpenFoodFacts(code)
      if (off) {
        setResult(off)
        return
      }
      setLookupError('No match found (try another barcode).')
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLookupLoading(false)
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
              <div className="barcode-lookup-error">{lookupError}</div>
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
                  </div>
                  {result.imageUrl && (
                    <img className="barcode-lookup-image" src={result.imageUrl} alt={result.name ?? result.barcode} />
                  )}
                </div>
              </div>
            ) : (
              <div className="barcode-lookup-hint">Pick a barcode on the left to look it up.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

