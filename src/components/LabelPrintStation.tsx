import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  connectLocalDymo,
  openDymoCertificateCheckPage,
  printRowsViaWebService,
} from '../lib/dymoWebService'
import {
  countPendingLabels,
  countFailedLabels,
  fetchRecentQueueActivity,
  retryFailedQueueItems,
  isSupabaseConfigured,
  markBatchStatus,
  queueRecordToPrintRow,
  type LabelPrintQueueRecord,
} from '../lib/labelPrintQueue'
import './LabelPrintStation.css'

export const PRINT_STATION_ROUTE_PATH = '/print-station' as const

const SETUP_KEY = 'order-tracker-print-station-ready'

export function LabelPrintStation() {
  const [dymoReady, setDymoReady] = useState(false)
  const [printerNames, setPrinterNames] = useState<string[]>([])
  const [dymoChecking, setDymoChecking] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [autoPrint, setAutoPrint] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [statusLine, setStatusLine] = useState('Starting…')
  const [recent, setRecent] = useState<LabelPrintQueueRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const processingLock = useRef(false)

  const printStationUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${PRINT_STATION_ROUTE_PATH}` : PRINT_STATION_ROUTE_PATH

  const refreshCounts = useCallback(async () => {
    try {
      const [n, f] = await Promise.all([countPendingLabels(), countFailedLabels()])
      setPendingCount(n)
      setFailedCount(f)
      const activity = await fetchRecentQueueActivity()
      setRecent(activity)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue status')
    }
  }, [])

  const refreshDymo = useCallback(async () => {
    setDymoChecking(true)
    setConnectError(null)
    try {
      const result = await connectLocalDymo()
      setDymoReady(result.ok)
      setPrinterNames(result.printers)
      if (result.ok) {
        localStorage.setItem(SETUP_KEY, '1')
        setStatusLine(`Ready — ${result.printers.join(', ')}`)
        return true
      }
      setConnectError(result.error)
      setStatusLine(result.error ?? 'Printer not connected')
      return false
    } finally {
      setDymoChecking(false)
    }
  }, [])

  const processNextBatch = useCallback(
    async (options?: { force?: boolean }) => {
      if (processingLock.current) return
      if (!autoPrint && !options?.force) return

      if (!dymoReady || printerNames.length === 0) {
        const ok = await refreshDymo()
        if (!ok) return
      }

      let batchId: string | null = null
      processingLock.current = true
      setProcessing(true)
      setError(null)

      try {
        const { data: nextRow } = await supabase
          .from('label_print_queue')
          .select('batch_id')
          .in('status', ['pending', 'failed'])
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        batchId = nextRow?.batch_id ?? null
        if (!batchId) {
          setStatusLine('Idle — no labels waiting in queue.')
          return
        }

        const { data: batchRows, error: batchErr } = await supabase
          .from('label_print_queue')
          .select('*')
          .eq('batch_id', batchId)
          .in('status', ['pending', 'failed'])
          .order('created_at', { ascending: true })

        if (batchErr) throw new Error(batchErr.message)
        const rows = (batchRows ?? []) as LabelPrintQueueRecord[]
        if (rows.length === 0) return

        const po = rows[0]?.po_number ?? 'PO'
        setStatusLine(`Printing ${rows.length} label${rows.length !== 1 ? 's' : ''} for ${po}…`)

        await supabase
          .from('label_print_queue')
          .update({ status: 'printing', error_message: null })
          .eq('batch_id', batchId)
          .in('status', ['pending', 'failed'])

        const printRows = rows.map(queueRecordToPrintRow)
        await printRowsViaWebService(printRows, printerNames[0])
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
          const failed = await countFailedLabels()
          if (remaining > 0 || failed > 0) {
            window.setTimeout(() => void processNextBatch(), 400)
          }
        }
      }
    },
    [autoPrint, dymoReady, printerNames, refreshCounts, refreshDymo]
  )

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
        () => void refreshCounts()
      )
      .subscribe()

    const poll = window.setInterval(() => {
      void refreshCounts()
      void processNextBatch()
    }, 6000)

    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(poll)
    }
  }, [refreshCounts, processNextBatch])

  useEffect(() => {
    if (dymoReady) void processNextBatch()
  }, [dymoReady, processNextBatch])

  if (!isSupabaseConfigured()) {
    return (
      <div className="print-station-page">
        <header className="print-station-header">
          <h1>Label Print Station</h1>
          <p className="print-station-subtitle">Supabase is required for the print queue.</p>
        </header>
        <div className="print-station-setup">
          <p>
            Run <code>supabase/add-label-print-queue.sql</code> in the Supabase SQL Editor and set{' '}
            <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code> on the deployed app.
          </p>
          <Link to="/" className="print-station-link">
            ← Order Tracker
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
          Open this page on the <strong>laptop with the DYMO printer</strong>. Queue labels from your tablet in{' '}
          <strong>PO Info</strong> — they print here automatically. No terminal commands needed.
        </p>
      </header>

      <section className="print-station-setup-card">
        <h2>One-time setup (laptop with printer)</h2>
        <ol className="print-station-steps">
          <li>Install <strong>DYMO Connect</strong> and connect the LabelWriter by USB.</li>
          <li>
            Bookmark this page:{' '}
            <a href={printStationUrl} className="print-station-link">
              {printStationUrl}
            </a>
          </li>
          <li>
            If the browser asks to access devices on your local network, choose <strong>Allow</strong>.
          </li>
        </ol>
        <div className="print-station-setup-actions">
          <button
            type="button"
            className="print-station-btn print-station-btn-primary"
            disabled={dymoChecking}
            onClick={() => void refreshDymo()}
          >
            {dymoChecking ? 'Connecting…' : 'Connect printer'}
          </button>
          <button type="button" className="print-station-btn" onClick={openDymoCertificateCheckPage}>
            Trust DYMO certificate
          </button>
        </div>
        {connectError && !dymoReady && <p className="print-station-connect-error">{connectError}</p>}
      </section>

      <div className="print-station-grid">
        <section className="print-station-card" aria-live="polite">
          <h2>Printer</h2>
          {dymoReady && printerNames.length > 0 ? (
            <p className="print-station-ok">Ready — {printerNames.join(', ')}</p>
          ) : (
            <p className="print-station-warn">Not connected — click Connect printer above.</p>
          )}
        </section>

        <section className="print-station-card">
          <h2>Queue</h2>
          <p className="print-station-pending">
            <span className="print-station-pending-num">{pendingCount}</span> waiting
            {failedCount > 0 && (
              <span className="print-station-failed-count">
                {' '}
                · <strong>{failedCount}</strong> failed
              </span>
            )}
          </p>
          <p className="print-station-status">{processing ? 'Printing…' : statusLine}</p>
          <label className="print-station-auto">
            <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
            Auto-print new queue items
          </label>
          <button
            type="button"
            className="print-station-btn print-station-btn-primary"
            disabled={processing || !dymoReady || (pendingCount === 0 && failedCount === 0)}
            onClick={() => void processNextBatch({ force: true })}
          >
            Print next batch now
          </button>
          <button
            type="button"
            className="print-station-btn"
            disabled={processing || failedCount === 0}
            onClick={() => {
              void retryFailedQueueItems()
                .then((n) => {
                  setStatusLine(n > 0 ? `Re-queued ${n} failed label(s).` : 'No failed labels.')
                  void refreshCounts()
                  void processNextBatch({ force: true })
                })
                .catch((e) => setError(e instanceof Error ? e.message : 'Retry failed'))
            }}
          >
            Retry failed labels
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
                <span className="print-station-recent-status">
                  {row.status}
                  {row.error_message ? ` — ${row.error_message}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="print-station-footer">
        <Link to="/" className="print-station-link">
          ← Order Tracker
        </Link>
        <span className="print-station-muted">
          {' '}
          · Tablet: PO Info → Print selected labels · Laptop: keep this page open
        </span>
      </p>
    </div>
  )
}

export default LabelPrintStation
