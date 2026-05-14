import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeBarcodeValue, barcodesMatch } from '../lib/barcodeCatalogLookup'
import type { BarcodeCatalogItem } from '../types/poCheckin'
import './BarcodeLookup.css'

type LookupResult = {
  barcode: string
  name: string | null
  partNumber: string | null
  imageUrl: string | null
  sourceUrl: string | null
  sourceLabel: string
}

type LookupMeta = {
  normalized: string
  digits: string
  looksLikeUpcEan: boolean
}

function getLookupMeta(raw: string): LookupMeta {
  const normalized = normalizeBarcodeValue(raw)
  const digits = normalized.replace(/[^\d]/g, '')
  const looksLikeUpcEan =
    digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14
  return { normalized, digits, looksLikeUpcEan }
}

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

async function lookupOpenFoodFacts(barcode: string): Promise<LookupResult | null> {
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
    (product.image_front_url as string | undefined) || (product.image_url as string | undefined) || null
  const sourceUrl = `https://world.openfoodfacts.org/product/${barcode}`
  return { barcode, name, partNumber: null, imageUrl, sourceUrl, sourceLabel: 'Open Food Facts' }
}

function jinaFetchUrl(targetUrl: string): string {
  const trimmed = targetUrl.trim()
  if (trimmed.startsWith('http://')) return `https://r.jina.ai/http://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('https://')) return `https://r.jina.ai/http://${trimmed.slice('https://'.length)}`
  return `https://r.jina.ai/http://${trimmed}`
}

function extractMetaContent(htmlText: string, key: 'og:title' | 'og:image'): string | null {
  const re = new RegExp(`<meta\\s+[^>]*property=[\"']${key}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`, 'i')
  const m = htmlText.match(re)
  if (!m) return null
  return m[1]?.trim() || null
}

function extractTitle(htmlText: string): string | null {
  const m = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (!m) return null
  return m[1]?.trim() || null
}

async function lookupAdiViaSerper(barcode: string, serperApiKey: string): Promise<LookupResult | null> {
  const queries = [
    `${barcode} site:adiglobaldistribution.com`,
    `${barcode} site:adiglobaldistribution.us`,
    `${barcode} "ADI"`,
  ]
  let chosen: { link: string; title?: string } | null = null
  for (const q of queries) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperApiKey },
      body: JSON.stringify({ q, num: 8 }),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(`Serper search failed (${res.status}). ${msg}`.trim())
    }
    const data = (await res.json()) as any
    const organic: Array<{ link?: string; title?: string }> = data?.organic ?? []
    const pick = organic.find((r) => {
      const link = (r.link || '').toLowerCase()
      return (
        link.includes('adiglobaldistribution.com') ||
        link.includes('adiglobaldistribution.us') ||
        link.includes('adiglobaldistribution')
      )
    })
    if (pick?.link) {
      chosen = { link: pick.link, title: pick.title }
      break
    }
  }
  const link = chosen?.link
  if (!link) return null
  const htmlRes = await fetch(jinaFetchUrl(link), { headers: { Accept: 'text/plain' } })
  if (!htmlRes.ok) return null
  const text = await htmlRes.text()
  const ogTitle = extractMetaContent(text, 'og:title')
  const ogImage = extractMetaContent(text, 'og:image')
  const title = ogTitle || extractTitle(text) || chosen?.title || null
  return { barcode, name: title, partNumber: null, imageUrl: ogImage, sourceUrl: link, sourceLabel: 'ADI (search)' }
}

function catalogToLookupResult(c: BarcodeCatalogItem): LookupResult {
  return {
    barcode: c.barcode_value,
    name: c.item_name,
    partNumber: c.part_number ?? null,
    imageUrl: c.image_url,
    sourceUrl: c.product_url,
    sourceLabel: c.manufacturer ? `Catalog (${c.manufacturer})` : 'Catalog',
  }
}

function applyCatalogRowToForm(
  c: BarcodeCatalogItem,
  setters: {
    setManufacturer: (v: string) => void
    setPartNumber: (v: string) => void
    setItemName: (v: string) => void
    setImageUrl: (v: string) => void
    setProductUrl: (v: string) => void
    setNotes: (v: string) => void
  }
) {
  setters.setManufacturer(c.manufacturer ?? '')
  setters.setPartNumber(c.part_number ?? '')
  setters.setItemName(c.item_name ?? '')
  setters.setImageUrl(c.image_url ?? '')
  setters.setProductUrl(c.product_url ?? '')
  setters.setNotes(c.notes ?? '')
}

interface BarcodeLookupModalProps {
  barcodeValue: string
  /** Known catalog row (e.g. from PO row or catalog list) — skips slow lookups when it matches this barcode. */
  catalogSeed: BarcodeCatalogItem | null
  /** When true (catalog "Edit"), open the save form immediately with fields filled. */
  openCatalogEditor: boolean
  onClose: () => void
  onCatalogSaved?: () => void
}

export default function BarcodeLookupModal({
  barcodeValue,
  catalogSeed,
  openCatalogEditor,
  onClose,
  onCatalogSaved,
}: BarcodeLookupModalProps) {
  const [catalog, setCatalog] = useState<BarcodeCatalogItem[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupHint, setLookupHint] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addManufacturer, setAddManufacturer] = useState('')
  const [addPartNumber, setAddPartNumber] = useState('')
  const [addItemName, setAddItemName] = useState('')
  const [addImageUrl, setAddImageUrl] = useState('')
  const [addProductUrl, setAddProductUrl] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const serperEnabled = Boolean(import.meta.env.VITE_SERPER_API_KEY)
  const selectedBarcode = normalizeBarcodeValue(barcodeValue)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await supabase.from('barcode_catalog').select('*').order('updated_at', { ascending: false })
      if (!cancelled && !res.error) setCatalog((res.data ?? []) as BarcodeCatalogItem[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedBarcode) return

    const seedMatches = catalogSeed && barcodesMatch(catalogSeed.barcode_value, selectedBarcode)

    if (seedMatches && catalogSeed) {
      setLookupLoading(false)
      setLookupError(null)
      setLookupHint(null)
      setResult(catalogToLookupResult(catalogSeed))
      applyCatalogRowToForm(catalogSeed, {
        setManufacturer: setAddManufacturer,
        setPartNumber: setAddPartNumber,
        setItemName: setAddItemName,
        setImageUrl: setAddImageUrl,
        setProductUrl: setAddProductUrl,
        setNotes: setAddNotes,
      })
      setShowAdd(openCatalogEditor)
      return
    }

    setLookupLoading(true)
    setLookupError(null)
    setLookupHint(null)
    setResult(null)
    setShowAdd(false)

    let cancelled = false
    async function doLookup() {
      const meta = getLookupMeta(selectedBarcode)
      try {
        const match = catalog.find((c) => barcodesMatch(c.barcode_value, selectedBarcode))
        if (!cancelled && match) {
          setResult(catalogToLookupResult(match))
          applyCatalogRowToForm(match, {
            setManufacturer: setAddManufacturer,
            setPartNumber: setAddPartNumber,
            setItemName: setAddItemName,
            setImageUrl: setAddImageUrl,
            setProductUrl: setAddProductUrl,
            setNotes: setAddNotes,
          })
          return
        }

        if (!meta.looksLikeUpcEan) {
          if (!cancelled) setLookupHint('This barcode does not look like a standard UPC/EAN. It may be an internal/Code128 label.')
        }

        const candidates: string[] = []
        if (meta.looksLikeUpcEan) candidates.push(meta.digits)
        if (meta.normalized !== meta.digits && meta.normalized) candidates.push(meta.normalized)
        const serperKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined

        for (const c of candidates) {
          const off = await lookupOpenFoodFacts(c)
          if (!cancelled && off) {
            setResult(off)
            setAddManufacturer('')
            setAddPartNumber('')
            setAddItemName(off.name ?? '')
            setAddImageUrl(off.imageUrl ?? '')
            setAddProductUrl(off.sourceUrl ?? '')
            setAddNotes('')
            return
          }
        }

        if (serperKey && candidates.length > 0) {
          const preferred = meta.looksLikeUpcEan ? meta.digits : candidates[0]
          const r = await lookupAdiViaSerper(preferred, serperKey)
          if (!cancelled && r) {
            setResult(r)
            setAddManufacturer('')
            setAddPartNumber('')
            setAddItemName(r.name ?? '')
            setAddImageUrl(r.imageUrl ?? '')
            setAddProductUrl(r.sourceUrl ?? '')
            setAddNotes('')
            return
          }
        }

        if (!cancelled) setLookupError('No match found in available sources.')
      } catch (e: unknown) {
        if (!cancelled) setLookupError(e instanceof Error ? e.message : 'Lookup failed')
      } finally {
        if (!cancelled) setLookupLoading(false)
      }
    }

    void doLookup()
    return () => {
      cancelled = true
    }
  }, [selectedBarcode, catalog, catalogSeed, openCatalogEditor])

  const openAdd = () => {
    const existing = catalog.find((c) => barcodesMatch(c.barcode_value, selectedBarcode))

    if (existing) {
      applyCatalogRowToForm(existing, {
        setManufacturer: setAddManufacturer,
        setPartNumber: setAddPartNumber,
        setItemName: setAddItemName,
        setImageUrl: setAddImageUrl,
        setProductUrl: setAddProductUrl,
        setNotes: setAddNotes,
      })
    } else if (result) {
      setAddManufacturer('')
      setAddPartNumber(result.partNumber ?? '')
      setAddItemName(result.name ?? '')
      setAddImageUrl(result.imageUrl ?? '')
      setAddProductUrl(result.sourceUrl ?? '')
      setAddNotes('')
    } else {
      setAddManufacturer('')
      setAddPartNumber('')
      setAddItemName('')
      setAddImageUrl('')
      setAddProductUrl('')
      setAddNotes('')
    }
    setShowAdd(true)
  }

  const saveAdd = async () => {
    const meta = getLookupMeta(selectedBarcode)
    const barcodeValueToSave = meta.looksLikeUpcEan ? meta.digits : meta.normalized
    if (!barcodeValueToSave || !addItemName.trim()) {
      setLookupError('Please enter at least an Item name.')
      return
    }
    setAddSaving(true)
    setLookupError(null)
    try {
      const row = {
        barcode_value: barcodeValueToSave,
        manufacturer: addManufacturer.trim() || null,
        part_number: addPartNumber.trim() || null,
        item_name: addItemName.trim(),
        image_url: addImageUrl.trim() || null,
        product_url: addProductUrl.trim() || null,
        notes: addNotes.trim() || null,
      }
      const res = await supabase.from('barcode_catalog').upsert(row, { onConflict: 'barcode_value' }).select('*').single()
      if (res.error) throw new Error(res.error.message)
      const saved = res.data as BarcodeCatalogItem
      setCatalog((prev) => {
        const rest = prev.filter((c) => c.barcode_value !== saved.barcode_value)
        return [saved, ...rest]
      })
      setResult(catalogToLookupResult(saved))
      setShowAdd(false)
      onCatalogSaved?.()
      onClose()
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : 'Failed to save to catalog')
    } finally {
      setAddSaving(false)
    }
  }

  return (
    <div className="barcode-lookup-overlay" onClick={onClose}>
      <div className="barcode-lookup-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="barcode-lookup-modal-head">
          <h2 className="barcode-lookup-modal-title">
            Look up: <code>{selectedBarcode}</code>
          </h2>
          <button type="button" className="barcode-lookup-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="barcode-lookup-modal-body">
          <div className="barcode-lookup-result barcode-lookup-result-standalone">
            {lookupLoading ? (
              <div className="barcode-lookup-loading">Looking up…</div>
            ) : lookupError ? (
              <div>
                {lookupHint && <div className="barcode-lookup-hint">{lookupHint}</div>}
                <div className="barcode-lookup-error">{lookupError}</div>
                {selectedBarcode && (
                  <a
                    className="barcode-lookup-link"
                    href={googleSearchUrl(selectedBarcode)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Search the web for this barcode
                  </a>
                )}
                <div className="barcode-lookup-hint" style={{ marginTop: '0.5rem' }}>
                  Serper (ADI search) enabled: <strong>{serperEnabled ? 'Yes' : 'No'}</strong>
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                  <button type="button" className="barcode-lookup-add-btn" onClick={openAdd}>
                    Add to your Catalog
                  </button>
                </div>
              </div>
            ) : result ? (
              <div className="barcode-lookup-card">
                <div className="barcode-lookup-card-top">
                  <div>
                    <div className="barcode-lookup-card-title">{result.name ?? 'Unknown item'}</div>
                    <div className="barcode-lookup-card-sub">Barcode: <code>{result.barcode}</code></div>
                    {result.partNumber ? (
                      <div className="barcode-lookup-card-sub">
                        Part number: <code>{result.partNumber}</code>
                      </div>
                    ) : null}
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
            ) : null}
          </div>
        </div>

        {showAdd && (
          <div className="barcode-lookup-inner-modal">
            <div className="barcode-lookup-modal-card barcode-lookup-editor-card">
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
                  Part number (optional)
                  <input value={addPartNumber} onChange={(e) => setAddPartNumber(e.target.value)} />
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
                <button type="button" className="barcode-lookup-secondary-btn" onClick={() => setShowAdd(false)} disabled={addSaving}>
                  Cancel
                </button>
                <button type="button" className="barcode-lookup-primary-btn" onClick={() => void saveAdd()} disabled={addSaving}>
                  {addSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
