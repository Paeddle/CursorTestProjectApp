import { useCallback, useEffect, useRef, useState } from 'react'
import { addJobRef, deleteJobRef, syncPoIpointFromOneDrive } from '../services/poIpointService'
import type { PoJobRef } from '../types/poIpoint'

const LAST_SYNC_KEY = 'po_ipoint_onedrive_last_sync_v1'
/** Minimum time between automatic syncs when opening PO Info. */
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000

type Props = {
  jobRefs: PoJobRef[]
  lineItemCount: number
  locationCount: number
  onDataChanged: () => void
  onError: (msg: string) => void
}

function formatSyncSummary(result: {
  jobRefs: number
  poLines: number
  locations: number
  files: string[]
  skipped: string[]
  folder: string
}): string {
  const parts = [
    `${result.poLines} PO line${result.poLines !== 1 ? 's' : ''}`,
    `${result.jobRefs} job ref${result.jobRefs !== 1 ? 's' : ''}`,
    `${result.locations} location row${result.locations !== 1 ? 's' : ''}`,
  ]
  let msg = `Synced from OneDrive/${result.folder}: ${parts.join(', ')}.`
  if (result.skipped.length > 0) {
    msg += ` Note: ${result.skipped.join('; ')}.`
  }
  return msg
}

function PoIpointImportPanel({
  jobRefs,
  lineItemCount,
  locationCount,
  onDataChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [newRef, setNewRef] = useState('')
  const syncInFlight = useRef(false)

  const runOneDriveSync = useCallback(
    async (opts?: { force?: boolean }) => {
      if (syncInFlight.current) return
      if (!opts?.force) {
        const last = Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
        if (Date.now() - last < AUTO_SYNC_INTERVAL_MS) return
      }
      syncInFlight.current = true
      setBusy(true)
      onError('')
      try {
        const result = await syncPoIpointFromOneDrive()
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
        setLastSyncAt(new Date().toLocaleString())
        setSyncMsg(formatSyncSummary(result))
        onDataChanged()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'OneDrive sync failed'
        onError(
          `${msg}. Ensure sync-po-ipoint is deployed and OneDrive POInfo folder is configured (see supabase/ONEDRIVE_PO_IPOINT_SETUP.txt).`
        )
      } finally {
        setBusy(false)
        syncInFlight.current = false
      }
    },
    [onDataChanged, onError]
  )

  useEffect(() => {
    void runOneDriveSync()
  }, [runOneDriveSync])

  const handleAddJobRef = async () => {
    if (!newJobName.trim() || !newRef.trim()) {
      onError('Job name and ref number are required.')
      return
    }
    setBusy(true)
    onError('')
    try {
      await addJobRef(newJobName, newRef)
      setNewJobName('')
      setNewRef('')
      onDataChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to add job ref')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="po-info-ipoint-section">
      <h2 className="po-info-ipoint-title">iPoint data (OneDrive)</h2>
      <p className="po-info-section-desc">
        Exports are read automatically from your OneDrive <code>POInfo</code> folder (
        <code>JobRef.xlsx</code>, <code>POLineReport.pdf</code>, and ref spreadsheets like{' '}
        <code>4152.xlsx</code>). Save or export from iPoint into that folder — PO Info syncs on
        load and when you click Sync now. No file upload needed in the browser.
      </p>

      <div className="po-info-ipoint-sync-row">
        <button
          type="button"
          className="po-info-sync-onedrive-btn"
          disabled={busy}
          onClick={() => void runOneDriveSync({ force: true })}
        >
          {busy ? 'Syncing from OneDrive…' : 'Sync now'}
        </button>
        {lastSyncAt && (
          <span className="po-info-ipoint-last-sync">Last sync: {lastSyncAt}</span>
        )}
      </div>

      <div className="po-info-ipoint-stats">
        <span>{lineItemCount} PO line{lineItemCount !== 1 ? 's' : ''}</span>
        <span>{jobRefs.length} job ref{jobRefs.length !== 1 ? 's' : ''}</span>
        <span>{locationCount} location row{locationCount !== 1 ? 's' : ''}</span>
      </div>

      {busy && !syncMsg && <p className="po-info-ipoint-busy">Reading OneDrive folder…</p>}
      {syncMsg && <p className="po-info-ipoint-success">{syncMsg}</p>}

      <div className="po-info-jobref-block">
        <h3 className="po-info-ipoint-subtitle">Job reference list</h3>
        <p className="po-info-section-desc po-info-jobref-hint">
          Usually populated from <code>JobRef.xlsx</code>. You can also add or remove rows here.
        </p>
        <div className="po-info-jobref-add">
          <input
            type="text"
            placeholder="Job name"
            value={newJobName}
            onChange={(e) => setNewJobName(e.target.value)}
            disabled={busy}
          />
          <input
            type="text"
            placeholder="Ref #"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            disabled={busy}
            className="po-info-jobref-ref-input"
          />
          <button type="button" disabled={busy} onClick={() => void handleAddJobRef()}>
            Add
          </button>
        </div>
        {jobRefs.length === 0 ? (
          <p className="po-info-ipoint-empty">
            No job refs yet. Add <code>JobRef.xlsx</code> to OneDrive/POInfo and sync.
          </p>
        ) : (
          <div className="po-info-jobref-table-wrap">
            <table className="po-info-jobref-table">
              <thead>
                <tr>
                  <th>Job name</th>
                  <th>Ref</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobRefs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.job_name}</td>
                    <td>
                      <code>{r.ref_number}</code>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="po-info-delete-item"
                        disabled={busy}
                        title="Delete job ref"
                        onClick={() => {
                          if (!window.confirm(`Delete job ref ${r.ref_number}?`)) return
                          void (async () => {
                            setBusy(true)
                            try {
                              await deleteJobRef(r.id)
                              onDataChanged()
                            } catch (err) {
                              onError(err instanceof Error ? err.message : 'Delete failed')
                            } finally {
                              setBusy(false)
                            }
                          })()
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default PoIpointImportPanel
