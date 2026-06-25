import { useCallback, useEffect, useState } from 'react'
import { enrichEbayBarcodeToItem } from '../services/ebayEnrichService'
import {
  deleteEbayScanGroup,
  fetchEbayScanGroups,
  isEbayScansConfigured,
} from '../services/ebayScansService'
import { getItemPicturePublicUrl } from '../lib/itemsImageStorage'
import type { EbayScanGroup } from '../types/ebay'
import './EbayPage.css'

const EBAY_SCANNER_PATH = '/ebay-scanner'

function scannerUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${EBAY_SCANNER_PATH}`
}

export default function EbayPage() {
  const [groups, setGroups] = useState<EbayScanGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [enrichingBarcode, setEnrichingBarcode] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })

  const refresh = useCallback(async () => {
    if (!isEbayScansConfigured()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setGroups(await fetchEbayScanGroups())
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load eBay scans' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const unlinked = groups.filter((g) => !g.item)
  const linked = groups.filter((g) => g.item)
  const totalQty = groups.reduce((sum, g) => sum + g.scan_count, 0)

  const runEnrich = async (barcode: string) => {
    setEnrichingBarcode(barcode)
    setStatus(null)
    try {
      const result = await enrichEbayBarcodeToItem(barcode)
      setStatus({
        kind: 'ok',
        text: result.created
          ? `Added "${result.item.item || result.item.part_number}" to Items and linked ${barcode}.`
          : `Updated Items row for ${barcode}.`,
      })
      await refresh()
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Enrichment failed' })
    } finally {
      setEnrichingBarcode(null)
    }
  }

  const runBulkEnrich = async () => {
    if (unlinked.length === 0) return
    setBulkRunning(true)
    setBulkProgress({ done: 0, total: unlinked.length })
    let ok = 0
    try {
      for (let i = 0; i < unlinked.length; i++) {
        const g = unlinked[i]
        try {
          await enrichEbayBarcodeToItem(g.barcode_value)
          ok++
        } catch {
          /* continue with next */
        }
        setBulkProgress({ done: i + 1, total: unlinked.length })
      }
      setStatus({
        kind: ok > 0 ? 'ok' : 'info',
        text: `Enriched ${ok} of ${unlinked.length} unlinked barcodes.`,
      })
      await refresh()
    } finally {
      setBulkRunning(false)
    }
  }

  const removeGroup = async (barcode: string) => {
    if (!window.confirm(`Remove all scans for barcode ${barcode}?`)) return
    try {
      await deleteEbayScanGroup(barcode)
      setStatus({ kind: 'ok', text: `Removed scans for ${barcode}.` })
      await refresh()
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Delete failed' })
    }
  }

  if (!isEbayScansConfigured()) {
    return (
      <div className="ebay-page">
        <header className="ebay-header">
          <h1>eBay</h1>
          <p>Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use eBay inventory scans.</p>
        </header>
      </div>
    )
  }

  return (
    <div className="ebay-page">
      <header className="ebay-header">
        <h1>eBay</h1>
        <p>
          Items scanned for eBay listing. Use the{' '}
          <a href={scannerUrl()} target="_blank" rel="noopener noreferrer">
            eBay scanner
          </a>{' '}
          on a phone to log barcodes, then enrich rows to add them to Items with product details and
          pictures.
        </p>
        <p className="ebay-migration-hint">
          Run <code>supabase/add-ebay-scans.sql</code> in Supabase SQL Editor before first use.
        </p>
      </header>

      <div className="ebay-stats">
        <div className="ebay-stat-card">
          <strong>{groups.length}</strong>
          <span>Unique barcodes</span>
        </div>
        <div className="ebay-stat-card">
          <strong>{totalQty}</strong>
          <span>Total scanned qty</span>
        </div>
        <div className="ebay-stat-card">
          <strong>{unlinked.length}</strong>
          <span>Need item info</span>
        </div>
        <div className="ebay-stat-card">
          <strong>{linked.length}</strong>
          <span>Linked to Items</span>
        </div>
      </div>

      {status && <div className={`ebay-status ebay-status-${status.kind}`}>{status.text}</div>}

      {bulkRunning && (
        <div className="ebay-bulk-progress">
          Enriching… {bulkProgress.done} / {bulkProgress.total}
          <progress value={bulkProgress.done} max={bulkProgress.total || 1} />
        </div>
      )}

      <div className="ebay-toolbar">
        <button type="button" className="ebay-btn" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
        <a className="ebay-btn ebay-btn-primary" href={scannerUrl()} target="_blank" rel="noopener noreferrer">
          Open eBay scanner
        </a>
        <button
          type="button"
          className="ebay-btn ebay-btn-primary"
          onClick={() => void runBulkEnrich()}
          disabled={bulkRunning || unlinked.length === 0}
        >
          Enrich all unlinked ({unlinked.length})
        </button>
      </div>

      <div className="ebay-table-wrap">
        <table className="ebay-table">
          <thead>
            <tr>
              <th>Picture</th>
              <th>Barcode</th>
              <th>Qty</th>
              <th>Item / part #</th>
              <th>Manufacturer</th>
              <th>Stock avail.</th>
              <th>Last scan</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9}>Loading scans…</td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  No scans yet. Open the{' '}
                  <a href={scannerUrl()} target="_blank" rel="noopener noreferrer">
                    eBay scanner
                  </a>{' '}
                  and scan barcodes — they will appear here.
                </td>
              </tr>
            ) : (
              groups.map((g) => {
                const pic = g.item ? getItemPicturePublicUrl(g.item) : null
                const busy = enrichingBarcode === g.barcode_value
                return (
                  <tr key={g.barcode_value} className={g.item ? '' : 'ebay-unlinked'}>
                    <td className="ebay-picture-cell">
                      {pic ? (
                        <img className="ebay-thumb" src={pic} alt="" loading="lazy" />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <code>{g.barcode_value}</code>
                    </td>
                    <td>
                      <strong>{g.scan_count}</strong>
                    </td>
                    <td>{g.item?.item || g.item?.part_number || '—'}</td>
                    <td>{g.item?.manufacturer || '—'}</td>
                    <td>{g.item?.stock_available ?? '—'}</td>
                    <td>{new Date(g.last_scanned_at).toLocaleString()}</td>
                    <td>{g.item ? <span className="ebay-badge linked">In Items</span> : <span className="ebay-badge pending">Needs info</span>}</td>
                    <td className="ebay-actions">
                      {!g.item && (
                        <button
                          type="button"
                          className="ebay-btn ebay-btn-primary"
                          disabled={busy || bulkRunning}
                          onClick={() => void runEnrich(g.barcode_value)}
                        >
                          {busy ? 'Finding info…' : 'Find info & add to Items'}
                        </button>
                      )}
                      {g.item && (
                        <button
                          type="button"
                          className="ebay-btn"
                          disabled={busy || bulkRunning}
                          onClick={() => void runEnrich(g.barcode_value)}
                        >
                          {busy ? 'Updating…' : 'Refresh from lookup'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="ebay-btn ebay-btn-danger"
                        onClick={() => void removeGroup(g.barcode_value)}
                      >
                        Remove scans
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
