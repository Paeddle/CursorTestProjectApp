import { useState, useEffect } from 'react'
import Barcode from 'react-barcode'
import { supabase } from '../lib/supabase'
import type { POBarcode, PODocument, POCheckinSummary } from '../types/poCheckin'
import './POInfo.css'

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

function POInfo() {
  const [summaries, setSummaries] = useState<POCheckinSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchPo, setSearchPo] = useState('')
  const [expandedPo, setExpandedPo] = useState<Set<string>>(new Set())

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
        const [barcodesRes, docsRes] = await Promise.all([
          supabase.from('po_barcodes').select('*').order('scanned_at', { ascending: false }),
          supabase.from('po_documents').select('*').order('scanned_at', { ascending: false }),
        ])

        if (cancelled) return

        if (barcodesRes.error) throw new Error(barcodesRes.error.message)
        if (docsRes.error) throw new Error(docsRes.error.message)

        const barcodes = (barcodesRes.data ?? []) as POBarcode[]
        const documents = (docsRes.data ?? []) as PODocument[]

        const byPo = new Map<string, POCheckinSummary>()

        for (const b of barcodes) {
          const po = (b.po_number || '').trim()
          if (!po) continue
          const key = po.toLowerCase()
          if (!byPo.has(key)) {
            byPo.set(key, { po_number: po, barcodes: [], documents: [] })
          }
          byPo.get(key)!.barcodes.push(b)
        }

        for (const d of documents) {
          const po = (d.po_number || '').trim()
          if (!po) continue
          const key = po.toLowerCase()
          if (!byPo.has(key)) {
            byPo.set(key, { po_number: po, barcodes: [], documents: [] })
          }
          byPo.get(key)!.documents.push(d)
        }

        const list = Array.from(byPo.values()).sort((a, b) =>
          a.po_number.localeCompare(b.po_number, undefined, { numeric: true })
        )
        setSummaries(list)
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load PO check-in data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = searchPo.trim()
    ? summaries.filter(
        (s) =>
          s.po_number.toLowerCase().includes(searchPo.trim().toLowerCase())
      )
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
          Barcode scans and documents per PO from the scanning web app
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
        <button
          type="button"
          className="po-info-refresh"
          onClick={() => window.location.reload()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="po-info-error">
          {error}
        </div>
      )}

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

            return (
              <div key={key} className="po-info-card">
                <button
                  type="button"
                  className="po-info-card-header"
                  onClick={() => toggleExpanded(summary.po_number)}
                  aria-expanded={isExpanded}
                >
                  <span className="po-info-card-title">PO {summary.po_number}</span>
                  <span className="po-info-card-badge">
                    {summary.barcodes.length} barcode{summary.barcodes.length !== 1 ? 's' : ''}
                    {summary.documents.length > 0 && (
                      <> · {summary.documents.length} doc{summary.documents.length !== 1 ? 's' : ''}</>
                    )}
                  </span>
                  <span className="po-info-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                </button>

                {isExpanded && (
                  <div className="po-info-card-body">
                    {summary.barcodes.length > 0 && (
                      <section className="po-info-section">
                        <h4>Barcode scans</h4>
                        <ul className="po-info-scan-list">
                          {summary.barcodes.map((b) => (
                            <li key={b.id} className="po-info-scan-item">
                              <div className="po-info-barcode-wrap">
                                <Barcode
                                  value={b.barcode_value || ''}
                                  format="CODE128"
                                  displayValue={true}
                                  width={1.2}
                                  height={40}
                                  margin={0}
                                  fontSize={12}
                                  background="#fff"
                                  lineColor="#000"
                                />
                              </div>
                              <div className="po-info-scan-meta">
                                <code>{b.barcode_value}</code>
                                <span className="po-info-meta">{formatDateTime(b.scanned_at)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {summary.documents.length > 0 && (
                      <section className="po-info-section">
                        <h4>Documents</h4>
                        <ul className="po-info-doc-list">
                          {summary.documents.map((d) => (
                            <li key={d.id}>
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
    </div>
  )
}

export default POInfo
