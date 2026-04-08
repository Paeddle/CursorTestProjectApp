import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import type { WireBoxScan, WireBoxSummary } from '../../types/wireBox'
import {
  buildWireMaterialsReport,
  downloadTextFile,
  parseFootage,
  reportRowsToCsv,
  reportRowsToHtmlDocument,
  uniqueJobNamesFromScans,
  wireTypeIdToLabel,
  wireTypeIdToDefaultFt,
  type WireReportRow,
} from './wireReport'
import './WirePage.css'

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

function formatCheckType(raw: string | undefined): string {
  if (raw === 'check_out') return 'Check out'
  return 'Check in'
}

function scanTimeMs(scan: WireBoxScan): number {
  return new Date(scan.scanned_at).getTime()
}

/** Chronologically first scan in this box (initial intake). */
function oldestScanInBox(scans: WireBoxScan[]): WireBoxScan | null {
  if (!scans.length) return null
  return scans.reduce((a, b) => (scanTimeMs(a) <= scanTimeMs(b) ? a : b))
}

function isIntakeScan(scan: WireBoxScan, boxScans: WireBoxScan[]): boolean {
  if (scan.check_type === 'check_out') return false
  const first = oldestScanInBox(boxScans)
  if (!first) return false
  if (scan.id && first.id) return scan.id === first.id
  return scan.scanned_at === first.scanned_at
}

function formatFootageCell(scan: WireBoxScan): string {
  const cur = parseFootage(scan.current_footage)
  if (cur !== null) return `${cur} ft`
  return (scan.current_footage || '').trim() || '—'
}

function formatWireTypeDisplay(scan: WireBoxScan): string {
  const label = (scan.wire_type_label || '').trim()
  if (label) return label
  return wireTypeIdToLabel(scan.wire_type)
}

/** Newest-first scans: first row with wire type or label wins (box profile). */
function boxHeaderProfileScan(scans: WireBoxScan[]): WireBoxScan | undefined {
  for (const scan of scans) {
    const label = (scan.wire_type_label || '').trim()
    const wt = String(scan.wire_type ?? '').trim()
    if (label || wt) return scan
  }
  return undefined
}

function boxHeaderWireType(scans: WireBoxScan[]): string {
  const s = boxHeaderProfileScan(scans)
  return s ? formatWireTypeDisplay(s) : '—'
}

function boxHeaderDefaultWireDisplay(scans: WireBoxScan[]): string {
  const s = boxHeaderProfileScan(scans)
  if (!s) return '—'
  // Live catalog wins for known preset ids (avoids stale wire_type_default_ft from older scans).
  const fromCatalog = wireTypeIdToDefaultFt(s.wire_type)
  if (fromCatalog) return `${fromCatalog} ft`
  const raw = (s.wire_type_default_ft || '').trim()
  if (raw) return /ft\.?/i.test(raw) ? raw : `${raw} ft`
  return '—'
}

async function fetchAllScans(): Promise<WireBoxScan[]> {
  const { data, error } = await supabase
    .from('wire_box_scans')
    .select('*')
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WireBoxScan[]
}

function scansToSummaries(rows: WireBoxScan[]): WireBoxSummary[] {
  const byBox = new Map<string, WireBoxScan[]>()
  for (const row of rows) {
    const box = (row.box_id || '').trim()
    if (!box) continue
    const key = box.toLowerCase()
    if (!byBox.has(key)) byBox.set(key, [])
    byBox.get(key)!.push(row)
  }
  return Array.from(byBox.entries())
    .map(([, scans]) => ({
      box_id: scans[0]!.box_id,
      scans: scans.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()),
    }))
    .sort((a, b) => a.box_id.localeCompare(b.box_id, undefined, { numeric: true }))
}

export function WirePage() {
  const [summaries, setSummaries] = useState<WireBoxSummary[]>([])
  const [allScans, setAllScans] = useState<WireBoxScan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchBox, setSearchBox] = useState('')
  const [expandedBox, setExpandedBox] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [reportJob, setReportJob] = useState('')
  const [reportRows, setReportRows] = useState<WireReportRow[] | null>(null)

  const jobOptions = useMemo(() => uniqueJobNamesFromScans(allScans), [allScans])

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true)
    }
    setError(null)
    try {
      const rows = await fetchAllScans()
      setAllScans(rows)
      setSummaries(scansToSummaries(rows))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load wire box data')
    } finally {
      if (!opts?.silent) {
        setLoading(false)
      }
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

  useEffect(() => {
    if (reportJob && !jobOptions.includes(reportJob)) {
      setReportJob('')
      setReportRows(null)
    }
  }, [jobOptions, reportJob])

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

  const deleteScan = async (scan: WireBoxScan) => {
    if (
      !window.confirm(
        `Delete this scan for ${scan.box_id} (${formatCheckType(scan.check_type)}, ${scan.job_name})?`
      )
    ) {
      return
    }
    if (!scan.id) {
      setError('Cannot delete: this row has no id. Refresh and try again.')
      return
    }
    setDeleting(true)
    setError(null)
    try {
      const { data, error: delErr } = await supabase
        .from('wire_box_scans')
        .delete()
        .eq('id', scan.id)
        .select('id')
      if (delErr) throw new Error(delErr.message)
      if (!data?.length) {
        throw new Error(
          'No row was deleted. In Supabase, run supabase/fix-wire-box-scans-delete-rls.sql (RLS must allow delete for your JWT role).'
        )
      }
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete scan')
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateReport = () => {
    if (!reportJob.trim()) return
    setReportRows(buildWireMaterialsReport(reportJob.trim(), allScans))
  }

  const safeReportFileStem = () =>
    reportJob.trim().replace(/[^\w\- ./()]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'job'

  const handleDownloadCsv = () => {
    if (!reportRows || !reportJob.trim()) return
    const csv = reportRowsToCsv(reportJob.trim(), reportRows)
    downloadTextFile(`wire-materials-${safeReportFileStem()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const handleDownloadHtml = () => {
    if (!reportRows || !reportJob.trim()) return
    const html = reportRowsToHtmlDocument(reportJob.trim(), reportRows)
    downloadTextFile(`wire-materials-${safeReportFileStem()}.html`, html, 'text/html;charset=utf-8')
  }

  const deleteBox = async (boxId: string, scanCount: number) => {
    if (
      !window.confirm(
        `Delete box ${boxId} and all ${scanCount} scan${scanCount !== 1 ? 's' : ''}? This cannot be undone.`
      )
    ) {
      return
    }
    setDeleting(true)
    setError(null)
    try {
      const { data, error: delErr } = await supabase
        .from('wire_box_scans')
        .delete()
        .eq('box_id', boxId)
        .select('id')
      if (delErr) throw new Error(delErr.message)
      if (!data?.length) {
        throw new Error(
          'No rows were deleted. In Supabase, run supabase/fix-wire-box-scans-delete-rls.sql (RLS must allow delete for your JWT role), or check the box ID matches.'
        )
      }
      setExpandedBox((prev) => {
        const next = new Set(prev)
        next.delete(boxId.toLowerCase())
        return next
      })
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete box')
    } finally {
      setDeleting(false)
    }
  }

  if (!isConfigured()) {
    return (
      <div className="wire-page">
        <header className="wire-header">
          <h1>Wire Tracker</h1>
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
        <h1>Wire Tracker</h1>
        <p className="wire-subtitle">Wire box scans from the wire scanner app</p>
      </header>

      <section className="wire-report-section" aria-labelledby="wire-report-heading">
        <h2 id="wire-report-heading" className="wire-report-title">
          Materials used report
        </h2>
        <p className="wire-report-hint">
          Pick a job, then create a rough-in style table: for each wire box on that job,{' '}
          <strong>used footage</strong> is the <strong>first</strong> scan&apos;s remaining length minus the{' '}
          <strong>last</strong> scan&apos;s (typically check-in at the start of the job and check-out when you leave).
          Unmatched boxes appear under &quot;Other&quot;; standard rows match common NM-B labels in the box ID.
        </p>
        <div className="wire-report-toolbar">
          <label className="wire-report-job-label">
            <span>Job</span>
            <select
              className="wire-report-select"
              value={reportJob}
              onChange={(e) => {
                setReportJob(e.target.value)
                setReportRows(null)
              }}
              disabled={loading || jobOptions.length === 0}
            >
              <option value="">Select a job…</option>
              {jobOptions.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="wire-report-primary"
            disabled={!reportJob.trim() || loading}
            onClick={handleCreateReport}
          >
            Create report
          </button>
          <button
            type="button"
            className="wire-report-secondary"
            disabled={!reportRows}
            onClick={handleDownloadCsv}
          >
            Download CSV
          </button>
          <button
            type="button"
            className="wire-report-secondary"
            disabled={!reportRows}
            onClick={handleDownloadHtml}
          >
            Download HTML
          </button>
        </div>
        {reportRows && (
          <div className="wire-report-preview">
            <table className="wire-report-table">
              <thead>
                <tr>
                  <th>Wire type</th>
                  <th>Box ID</th>
                  <th>Start (ft)</th>
                  <th>End (ft)</th>
                  <th>Used (ft)</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row, i) => (
                  <tr key={`${row.wireType}-${row.boxId ?? i}-${i}`}>
                    <td>{row.wireType}</td>
                    <td>{row.boxId ?? '—'}</td>
                    <td className="wire-report-num">{row.startFt === null ? '—' : row.startFt}</td>
                    <td className="wire-report-num">{row.endFt === null ? '—' : row.endFt}</td>
                    <td className="wire-report-num">{row.usedFt === null ? '—' : row.usedFt}</td>
                    <td className="wire-report-notes">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
            const headerWire = boxHeaderWireType(summary.scans)
            const headerDefault = boxHeaderDefaultWireDisplay(summary.scans)
            const nScans = summary.scans.length
            return (
              <div key={key} className="wire-card">
                <div className="wire-card-header-row">
                  <button
                    type="button"
                    className="wire-card-header"
                    onClick={() => toggleExpanded(summary.box_id)}
                    aria-expanded={isExpanded}
                    aria-label={`${summary.box_id}, ${headerWire}, default ${headerDefault}, ${nScans} scan${nScans !== 1 ? 's' : ''}`}
                  >
                    <span className="wire-card-title-block">
                      <span className="wire-card-title">{summary.box_id}</span>
                      <span className="wire-card-meta">
                        <span className="wire-card-wire-type">{headerWire}</span>
                        <span className="wire-card-meta-sep" aria-hidden>
                          {' · '}
                        </span>
                        <span className="wire-card-default-cap">Default {headerDefault}</span>
                      </span>
                    </span>
                    <span className="wire-card-badge">
                      {nScans} scan{nScans !== 1 ? 's' : ''}
                    </span>
                    <span className="wire-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                  </button>
                  <button
                    type="button"
                    className="wire-delete-box"
                    title="Delete this box and all its scans"
                    disabled={deleting}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteBox(summary.box_id, summary.scans.length)
                    }}
                  >
                    Delete box
                  </button>
                </div>
                {isExpanded && (
                  <div className="wire-card-body">
                    <table className="wire-scans-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Job name</th>
                          <th>Footage left</th>
                          <th>Scanned at</th>
                          <th className="wire-actions-col"> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.scans.map((scan) => (
                          <tr key={scan.id}>
                            <td>
                              {isIntakeScan(scan, summary.scans) ? (
                                <span className="wire-check-badge wire-check-intake">Intake</span>
                              ) : (
                                <span
                                  className={
                                    scan.check_type === 'check_out'
                                      ? 'wire-check-badge wire-check-out'
                                      : 'wire-check-badge wire-check-in'
                                  }
                                >
                                  {formatCheckType(scan.check_type)}
                                </span>
                              )}
                            </td>
                            <td>{scan.job_name}</td>
                            <td>{formatFootageCell(scan)}</td>
                            <td>{formatDateTime(scan.scanned_at)}</td>
                            <td className="wire-actions-col">
                              <button
                                type="button"
                                className="wire-delete-scan"
                                title="Delete this scan"
                                disabled={deleting}
                                onClick={() => deleteScan(scan)}
                              >
                                Delete
                              </button>
                            </td>
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
