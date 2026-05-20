import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  getDymoDiagnostics,
  getDymoPrinterNames,
  printLabelsWithDymo,
  type DymoDiagnostics,
} from '../lib/dymoLabelPrint'
import {
  countPendingLabels,
  fetchOldestPendingBatchId,
  fetchPendingBatchRows,
  fetchRecentQueueActivity,
  isSupabaseConfigured,
  markBatchStatus,
  queueRecordToPrintRow,
  type LabelPrintQueueRecord,
} from '../lib/labelPrintQueue'
import './LabelPrintStation.css'

export const PRINT_STATION_ROUTE_PATH = '/print-station' as const

export function LabelPrintStation() {
  const [dymoReady, setDymoReady] = useState(false)
  const [printerNames, setPrinterNames] = useState<string[]>([])
  const [dymoDiag, setDymoDiag] = useState<DymoDiagnostics | null>(null)
  const [dymoChecking, setDymoChecking] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [autoPrint, setAutoPrint] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [statusLine, setStatusLine] = useState('Starting…')
  const [recent, setRecent] = useState<LabelPrintQueueRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const processingLock = useRef(false)

  const refreshCounts = useCallback(async () => {
    try {
      const n = await countPendingLabels()
      setPendingCount(n)
      const activity = await fetchRecentQueueActivity()
      setRecent(activity)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue status')
    }
  }, [])

  const refreshDymo = useCallback(async () => {
    setDymoChecking(true)
    try {
      const diag = await getDymoDiagnostics()
      setDymoDiag(diag)
      const names = getDymoPrinterNames()
      setPrinterNames(names)
      const ok = names.length > 0
      setDymoReady(ok)
      if (!ok) setStatusLine(diag.summary)
      return ok
    } finally {
      setDymoChecking(false)
    }
  }, [])

  const processNextBatch = useCallback(async (options?: { force?: boolean }) => {
    if (processingLock.current) return
    if (!autoPrint && !options?.force) return

    const dymoOk = await refreshDymo()
    if (!dymoOk || getDymoPrinterNames().length === 0) {
      setStatusLine('Waiting for DYMO Connect and a connected LabelWriter…')
      return
    }

    let batchId: string | null = null
    processingLock.current = true
    setProcessing(true)
    setError(null)

    try {
      batchId = await fetchOldestPendingBatchId()
      if (!batchId) {
        setStatusLine('Idle — no labels waiting in queue.')
        return
      }

      const rows = await fetchPendingBatchRows(batchId)
      if (rows.length === 0) {
        return
      }

      const po = rows[0]?.po_number ?? 'PO'
      setStatusLine(`Printing ${rows.length} label${rows.length !== 1 ? 's' : ''} for ${po}…`)
      await markBatchStatus(batchId, 'pending', 'printing')

      const printRows = rows.map(queueRecordToPrintRow)
      await printLabelsWithDymo(printRows)
      await markBatchStatus(batchId, 'printing', 'done')
      setStatusLine(`Printed ${rows.length} label${rows.length !== 1 ? 's' : ''} for ${po}.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Print failed'
      if (batchId) {
        try {
          await markBatchStatus(batchId, 'printing', 'failed', msg)
        } catch {
          await markBatchStatus(batchId, 'pending', 'failed', msg)
        }
      }
      setError(msg)
      setStatusLine('Print failed — see error below.')
    } finally {
      processingLock.current = false
      setProcessing(false)
      await refreshCounts()
      if (autoPrint) {
        const remaining = await countPendingLabels()
        if (remaining > 0) {
          window.setTimeout(() => void processNextBatch(), 300)
        }
      }
    }
  }, [autoPrint, refreshCounts, refreshDymo])

  const handleProcessNow = () => {
    void processNextBatch({ force: true })
  }

  useEffect(() => {
    void refreshDymo()
    void refreshCounts()
  }, [refreshDymo, refreshCounts])

  useEffect(() => {
    if (!isSupabaseConfigured()) return

    const channel = supabase
      .channel('label-print-station')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'label_print_queue' },
        () => {
          void refreshCounts()
          void processNextBatch()
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'label_print_queue' },
        () => {
          void refreshCounts()
        }
      )
      .subscribe()

    const poll = window.setInterval(() => {
      void refreshCounts()
      void processNextBatch()
    }, 8000)

    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(poll)
    }
  }, [refreshCounts, processNextBatch])

  useEffect(() => {
    void processNextBatch()
  }, [processNextBatch, autoPrint, dymoReady])

  if (!isSupabaseConfigured()) {
    return (
      <div className="print-station-page">
        <header className="print-station-header">
          <h1>Label Print Station</h1>
          <p className="print-station-subtitle">Supabase is required for the print queue.</p>
        </header>
        <div className="print-station-setup">
          <p>
            Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your{' '}
            <code>.env</code>, then run <code>supabase/add-label-print-queue.sql</code> in the Supabase SQL
            Editor.
          </p>
          <Link to="/" className="print-station-link">
            ← Back to Order Tracker
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="print-station-page">
      <header className="print-station-header">
        <h1>Label Print Station</h1>
        <p className="print-station-subtitle">
          Keep this page open on the laptop with DYMO Connect, or run <code>npm run print-agent</code> in a
          terminal (recommended when using the live website URL).
        </p>
      </header>

      {dymoDiag?.isRemoteOrigin && !dymoReady && (
        <div className="print-station-banner">
          <strong>Using the live website?</strong> Browsers often block it from talking to DYMO on your PC. Run{' '}
          <code>npm run print-agent</code> in the project folder on this laptop instead — it prints queued labels
          without browser restrictions.
        </div>
      )}

      <div className="print-station-grid">
        <section className="print-station-card" aria-live="polite">
          <h2>Printer</h2>
          {dymoReady && printerNames.length > 0 ? (
            <p className="print-station-ok">Ready — {printerNames.join(', ')}</p>
          ) : (
            <p className="print-station-warn">{dymoDiag?.summary ?? 'Checking DYMO…'}</p>
          )}
          {dymoDiag && (
            <p className="print-station-hint">{dymoDiag.recommendedAction}</p>
          )}
          <button
            type="button"
            className="print-station-btn"
            disabled={dymoChecking}
            onClick={() => void refreshDymo()}
          >
            {dymoChecking ? 'Checking…' : 'Check DYMO again'}
          </button>
          {dymoDiag && dymoDiag.printers.length > 0 && (
            <ul className="print-station-printer-list">
              {dymoDiag.printers.map((p) => (
                <li key={p.name}>
                  {p.name} — {p.isConnected ? 'connected' : 'not connected'}
                </li>
              ))}
            </ul>
          )}
          {dymoDiag?.environment && (
            <details className="print-station-details">
              <summary>Technical details</summary>
              <pre>{JSON.stringify(dymoDiag.environment, null, 2)}</pre>
              {dymoDiag.localServiceProbe && (
                <pre>{JSON.stringify(dymoDiag.localServiceProbe, null, 2)}</pre>
              )}
            </details>
          )}
        </section>

        <section className="print-station-card">
          <h2>Queue</h2>
          <p className="print-station-pending">
            <span className="print-station-pending-num">{pendingCount}</span> label
            {pendingCount !== 1 ? 's' : ''} waiting
          </p>
          <p className="print-station-status">{processing ? 'Printing…' : statusLine}</p>
          <label className="print-station-auto">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
            />
            Auto-print new queue items
          </label>
          <button
            type="button"
            className="print-station-btn print-station-btn-primary"
            disabled={processing || pendingCount === 0}
            onClick={handleProcessNow}
          >
            Print next batch now
          </button>
        </section>
      </div>

      {error && <div className="print-station-error">{error}</div>}

      <section className="print-station-recent">
        <h2>Recent activity</h2>
        {recent.length === 0 ? (
          <p className="print-station-muted">No completed jobs yet.</p>
        ) : (
          <ul className="print-station-recent-list">
            {recent.map((row) => (
              <li key={row.id} className={`print-station-recent-item print-station-recent--${row.status}`}>
                <span className="print-station-recent-po">{row.po_number}</span>
                <span className="print-station-recent-loc">
                  {row.job_name || row.item_name}
                  {row.location_name ? ` · ${row.location_name}` : ''}
                </span>
                <span className="print-station-recent-status">{row.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="print-station-footer">
        <Link to="/" className="print-station-link">
          ← Order Tracker
        </Link>
        <span className="print-station-muted"> · Queue labels from the PO Info tab on your tablet.</span>
      </p>
    </div>
  )
}

export default LabelPrintStation
