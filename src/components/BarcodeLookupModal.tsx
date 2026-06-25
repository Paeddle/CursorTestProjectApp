import { useEffect, useState } from 'react'
import { fetchItemsAsCatalog, upsertItemFromCatalogEntry } from '../services/itemsService'
import { normalizeBarcodeValue, barcodesMatch } from '../lib/barcodeCatalogLookup'
import { lookupProductByBarcode } from '../services/barcodeLookup/providers'
import type { ProductLookupResult } from '../services/barcodeLookup/types'
import type { BarcodeCatalogItem } from '../types/poCheckin'
import './BarcodeLookup.css'

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

function catalogToLookupResult(c: BarcodeCatalogItem): ProductLookupResult {
  return {
    barcode: c.barcode_value,
    name: c.item_name,
    partNumber: c.part_number ?? null,
    manufacturer: c.manufacturer ?? null,
    imageUrl: c.image_url,
    sourceUrl: c.product_url,
    sourceLabel: c.manufacturer ? `Your items (${c.manufacturer})` : 'Your items',
    confidence: 'high',
  }
}

function applyLookupToForm(
  r: ProductLookupResult,
  setters: {
    setManufacturer: (v: string) => void
    setPartNumber: (v: string) => void
    setItemName: (v: string) => void
    setImageUrl: (v: string) => void
    setProductUrl: (v: string) => void
    setNotes: (v: string) => void
  }
) {
  setters.setManufacturer(r.manufacturer ?? '')
  setters.setPartNumber(r.partNumber ?? '')
  setters.setItemName(r.name ?? '')
  setters.setImageUrl(r.imageUrl ?? '')
  setters.setProductUrl(r.sourceUrl ?? '')
  setters.setNotes('')
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
  const [result, setResult] = useState<ProductLookupResult | null>(null)
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
      try {
        const rows = await fetchItemsAsCatalog()
        if (!cancelled) setCatalog(rows)
      } catch {
        /* ignore load errors in modal */
      }
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
      applyLookupToForm(catalogToLookupResult(catalogSeed), {
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
          const r = catalogToLookupResult(match)
          setResult(r)
          applyLookupToForm(r, {
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
          if (!cancelled) {
            setLookupHint(
              'This barcode does not look like a standard UPC/EAN. It may be an internal/Code128 label — try adding it manually.'
            )
          }
        }

        const lookupCode = meta.looksLikeUpcEan ? meta.digits : selectedBarcode
        const hit = await lookupProductByBarcode(lookupCode, { catalog })
        if (!cancelled && hit) {
          setResult(hit)
          applyLookupToForm(hit, {
            setManufacturer: setAddManufacturer,
            setPartNumber: setAddPartNumber,
            setItemName: setAddItemName,
            setImageUrl: setAddImageUrl,
            setProductUrl: setAddProductUrl,
            setNotes: setAddNotes,
          })
          return
        }

        if (!cancelled) {
          setLookupError(
            serperEnabled
              ? 'No match in your items, UPCitemdb, or AV distributor sources.'
              : 'No match found. Add VITE_SERPER_API_KEY to search ADI, Snap One, B&H, and other AV sources.'
          )
        }
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
  }, [selectedBarcode, catalog, catalogSeed, openCatalogEditor, serperEnabled])

  const openAdd = () => {
    const existing = catalog.find((c) => barcodesMatch(c.barcode_value, selectedBarcode))

    if (existing) {
      applyLookupToForm(catalogToLookupResult(existing), {
        setManufacturer: setAddManufacturer,
        setPartNumber: setAddPartNumber,
        setItemName: setAddItemName,
        setImageUrl: setAddImageUrl,
        setProductUrl: setAddProductUrl,
        setNotes: setAddNotes,
      })
    } else if (result) {
      applyLookupToForm(result, {
        setManufacturer: setAddManufacturer,
        setPartNumber: setAddPartNumber,
        setItemName: setAddItemName,
        setImageUrl: setAddImageUrl,
        setProductUrl: setAddProductUrl,
        setNotes: setAddNotes,
      })
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
      const saved = await upsertItemFromCatalogEntry({
        barcode_value: barcodeValueToSave,
        manufacturer: addManufacturer.trim() || null,
        part_number: addPartNumber.trim() || null,
        item_name: addItemName.trim(),
        image_url: addImageUrl.trim() || null,
        product_url: addProductUrl.trim() || null,
        notes: addNotes.trim() || null,
      })
      setCatalog((prev) => {
        const rest = prev.filter((c) => c.barcode_value !== saved.barcode_value)
        return [saved, ...rest]
      })
      setResult(catalogToLookupResult(saved))
      setShowAdd(false)
      onCatalogSaved?.()
      onClose()
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : 'Failed to save to items')
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
              <div className="barcode-lookup-loading">Searching AV distributors and product databases…</div>
            ) : lookupError ? (
              <div>
                {lookupHint && <div className="barcode-lookup-hint">{lookupHint}</div>}
                <div className="barcode-lookup-error">{lookupError}</div>
                {selectedBarcode && (
                  <a
                    className="barcode-lookup-link"
                    href={googleSearchUrl(`${selectedBarcode} pro AV UPC`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Search the web for this barcode
                  </a>
                )}
                <div className="barcode-lookup-hint" style={{ marginTop: '0.5rem' }}>
                  AV distributor search (Serper): <strong>{serperEnabled ? 'Yes' : 'No'}</strong>
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
                    {result.manufacturer ? (
                      <div className="barcode-lookup-card-sub">Manufacturer: {result.manufacturer}</div>
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
