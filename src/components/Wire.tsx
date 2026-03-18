import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { WireBoxScan, WireBoxSummary } from '../types/wireBox'
import './Wire.css'

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

async function loadSummaries(): Promise<WireBoxSummary[]> {
  const { data, error } = await supabase
    .from('wire_box_scans')
    .select('*')
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as WireBoxScan[]
  const byBox = new Map<string, WireBoxScan[]>()
  for (const row of rows) {
    const box = (row.box_id || '').trim()
    if (!box) continue
    const key = box.toLowerCase()
    if (!byBox.has(key)) byBox.set(key, [])
    byBox.get(key)!.push(row)
  }
  return Array.from(byBox.entries())
    .map(([key, scans]) => ({
      box_id: scans[0]!.box_id,
      scans: scans.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()),
    }))
    .sort((a, b) => a.box_id.localeCompare(b.box_id, undefined, { numeric: true }))
}

function Wire() {
  const [summaries, setSummaries] = useState<WireBoxSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchBox, setSearchBox] = useState('')
  const [expandedBox, setExpandedBox] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await loadSummaries()
      setSummaries(list)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load wire box data')
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

  const filtered = searchBox.trim()
    ? summaries.filter((s) =>
        s.box_id.toLowerCase().includes(searchBox.trim().toLowerCase())
      )
    : summaries

  const toggleExpanded = (boxId: string) => {
    const key = boxId.toLowerCase()
    setExpandedBox((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!isConfigured()) {
    return (
      <div className="wire-page">
        <header className="wire-header">
          <h1>Wire</h1>
          <p className="wire-subtitle">Wire box scans from the wire scanner app</p>
        </header>
        <div className="wire-setup">
          <p>Configure Supabase in your <code>.env</code> and run <code>supabase/add-wire-box-scans.sql</code>.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wire-page">
      <header className="wire-header">
        <h1>Wire</h1>
        <p className="wire-subtitle">
          Box numbers and scans from the wire scanner app (job name + footage per scan).
        </p>
      </header>

      <div className="wire-controls">
        <input
          type="text"
          className="wire-search"
          placeholder="Filter by box number..."
          value={searchBox}
          onChange={(e) => setSearchBox(e.target.value)}
        />
        <button type="button" className="wire-refresh" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="wire-error">{error}</div>}

      {loading ? (
        <div className="wire-loading">Loading wire box data…</div>
      ) : filtered.length === 0 ? (
        <div className="wire-empty">
          <p>
            {searchBox.trim()
              ? 'No boxes match your filter.'
              : 'No wire box scans yet. Data appears here after using the wire scanner app at /wire-scanner.'}
          </p>
        </div>
      ) : (
        <div className="wire-list">
          {filtered.map((summary) => {
            const key = summary.box_id.toLowerCase()
            const isExpanded = expandedBox.has(key)
            return (
              <div key={key} className="wire-card">
                <button
                  type="button"
                  className="wire-card-header"
                  onClick={() => toggleExpanded(summary.box_id)}
                  aria-expanded={isExpanded}
                >
                  <span className="wire-card-title">Box {summary.box_id}</span>
                  <span className="wire-card-badge">
                    {summary.scans.length} scan{summary.scans.length !== 1 ? 's' : ''}
                  </span>
                  <span className="wire-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                </button>
                {isExpanded && (
                  <div className="wire-card-body">
                    <table className="wire-scans-table">
                      <thead>
                        <tr>
                          <th>Job name</th>
                          <th>Current footage</th>
                          <th>Scanned at</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.scans.map((scan) => (
                          <tr key={scan.id}>
                            <td>{scan.job_name}</td>
                            <td>{scan.current_footage}</td>
                            <td>{formatDateTime(scan.scanned_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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

export default Wire
