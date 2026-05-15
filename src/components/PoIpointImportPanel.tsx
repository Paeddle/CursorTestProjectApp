import { useCallback, useMemo, useState } from 'react'
import { extractPdfPlainTextForPoLineReport } from '../lib/extractPdfLines'
import { parsePoLineReportText } from '../lib/parsePoLineReport'
import { parsePoLineReportXlsx, summarizePoLineReportRows } from '../lib/parsePoLineReportXlsx'
import {
  parseItemLocationsXlsx,
  refNumberFromFilename,
} from '../lib/parseItemLocationsXlsx'
import {
  addJobRef,
  deleteJobRef,
  importItemLocations,
  importPoLineReport,
  summarizeLocationUploads,
} from '../services/poIpointService'
import type { PoItemLocation, PoJobRef } from '../types/poIpoint'

type Props = {
  jobRefs: PoJobRef[]
  itemLocations: PoItemLocation[]
  lineItemCount: number
  locationCount: number
  onDataChanged: () => void
  onError: (msg: string) => void
}

function formatImportedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function PoIpointImportPanel({
  jobRefs,
  itemLocations,
  lineItemCount,
  locationCount,
  onDataChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [newRef, setNewRef] = useState('')

  const locationFiles = useMemo(
    () => summarizeLocationUploads(itemLocations, jobRefs),
    [itemLocations, jobRefs]
  )

  const refsNeedingJob = useMemo(
    () => locationFiles.filter((f) => !f.has_job_ref),
    [locationFiles]
  )

  const runImport = useCallback(
    async (label: string, fn: () => Promise<{ count: number; detail?: string }>) => {
      setBusy(label)
      setImportMsg(null)
      onError('')
      try {
        const { count, detail } = await fn()
        setImportMsg(
          detail ?? `${label}: imported ${count} row${count === 1 ? '' : 's'} into Supabase.`
        )
        onDataChanged()
      } catch (e) {
        onError(e instanceof Error ? e.message : `${label} failed`)
      } finally {
        setBusy(null)
      }
    },
    [onDataChanged, onError]
  )

  const handlePoLineFile = async (file: File): Promise<{ count: number; detail?: string }> => {
    const buf = await file.arrayBuffer()
    const lower = file.name.toLowerCase()
    let rows: import('../lib/parsePoLineReportXlsx').ParsedPoLineItem[] = []
    if (lower.endsWith('.pdf')) {
      const text = await extractPdfPlainTextForPoLineReport(buf)
      if (!text.trim()) throw new Error('No text found in PDF.')
      rows = parsePoLineReportText(text).map((r) => ({ ...r, po_date: null }))
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      rows = parsePoLineReportXlsx(buf)
    } else if (lower.endsWith('.csv')) {
      const text = new TextDecoder().decode(buf)
      rows = parsePoLineReportText(text).map((r) => ({ ...r, po_date: null }))
    } else {
      throw new Error('Use .xlsx, .pdf, or .csv for PO Line Report.')
    }
    if (rows.length === 0) throw new Error('No PO lines found in file.')
    const stats = summarizePoLineReportRows(rows)
    await importPoLineReport(rows, file.name)
    const jobNote =
      stats.withoutJob > 0
        ? ` ${stats.withoutJob} line${stats.withoutJob !== 1 ? 's' : ''} have no job/customer (often Stock lines).`
        : ''
    return {
      count: rows.length,
      detail: `PO Line Report: imported ${stats.total} lines (${stats.uniquePos} POs, ${stats.uniqueJobs} jobs).${jobNote}`,
    }
  }

  const handleLocationFile = async (file: File): Promise<{ count: number }> => {
    const ref = refNumberFromFilename(file.name)
    if (!ref) {
      throw new Error('Filename must include a ref number (e.g. 4152.xlsx or SalesOrder_4152.xlsx).')
    }
    const rows = parseItemLocationsXlsx(await file.arrayBuffer())
    if (rows.length === 0) throw new Error('No locations found in spreadsheet.')
    await importItemLocations(ref, rows, file.name)
    return { count: rows.length }
  }

  const handleAddJobRef = async () => {
    if (!newJobName.trim() || !newRef.trim()) {
      onError('Job name and ref number are required.')
      return
    }
    setBusy('add-job')
    onError('')
    try {
      await addJobRef(newJobName, newRef)
      setNewJobName('')
      setNewRef('')
      onDataChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to add job ref')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="po-info-ipoint-section">
      <h2 className="po-info-ipoint-title">iPoint data import</h2>
      <p className="po-info-section-desc">
        Upload the PO Line Report and location spreadsheets below. Manage job names and ref numbers
        in the job reference list — no JobRef file upload needed. Copy job names from the PO Line
        Report so they match exactly.
      </p>

      <div className="po-info-ipoint-stats">
        <span>{lineItemCount} PO line{lineItemCount !== 1 ? 's' : ''}</span>
        <span>{jobRefs.length} job ref{jobRefs.length !== 1 ? 's' : ''}</span>
        <span>{locationCount} location row{locationCount !== 1 ? 's' : ''}</span>
        <span>{locationFiles.length} location file{locationFiles.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="po-info-ipoint-uploads">
        <label className="po-info-ipoint-upload">
          <span className="po-info-ipoint-upload-label">PO Line Report</span>
          <span className="po-info-ipoint-upload-hint">
            .xlsx, .pdf, or .csv — replaces all stored PO lines
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.pdf,.csv"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void runImport('PO Line Report', () => handlePoLineFile(f))
            }}
          />
        </label>
        <label className="po-info-ipoint-upload">
          <span className="po-info-ipoint-upload-label">Item locations</span>
          <span className="po-info-ipoint-upload-hint">
            e.g. 4152.xlsx — ref number taken from filename
          </span>
          <input
            type="file"
            accept=".xlsx,.xls"
            multiple
            disabled={!!busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (!files.length) return
              void (async () => {
                setBusy('locations')
                onError('')
                try {
                  let total = 0
                  for (const f of files) {
                    const { count } = await handleLocationFile(f)
                    total += count
                  }
                  setImportMsg(
                    `Item locations: imported ${total} row${total === 1 ? '' : 's'} into Supabase.`
                  )
                  onDataChanged()
                } catch (err) {
                  onError(err instanceof Error ? err.message : 'Location import failed')
                } finally {
                  setBusy(null)
                }
              })()
            }}
          />
        </label>
      </div>

      {busy && <p className="po-info-ipoint-busy">Working: {busy}…</p>}
      {importMsg && <p className="po-info-ipoint-success">{importMsg}</p>}

      <div className="po-info-location-files-block">
        <h3 className="po-info-ipoint-subtitle">Uploaded location files</h3>
        <p className="po-info-section-desc po-info-jobref-hint">
          Each ref number you have uploaded appears here. Refs marked{' '}
          <strong className="po-info-needs-ref-label">Needs job ref</strong> are not in the job
          reference list yet — add a row below with the job name from the PO Line Report and this
          ref number.
        </p>
        {refsNeedingJob.length > 0 && (
          <p className="po-info-ipoint-needs-ref-banner">
            {refsNeedingJob.length} ref{refsNeedingJob.length !== 1 ? 's' : ''} still need a job
            name: {refsNeedingJob.map((f) => f.ref_number).join(', ')}
          </p>
        )}
        {locationFiles.length === 0 ? (
          <p className="po-info-ipoint-empty">No location files uploaded yet.</p>
        ) : (
          <div className="po-info-jobref-table-wrap">
            <table className="po-info-jobref-table po-info-location-files-table">
              <thead>
                <tr>
                  <th>Ref #</th>
                  <th>File name</th>
                  <th>Rows</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {locationFiles.map((f) => (
                  <tr
                    key={f.ref_number}
                    className={f.has_job_ref ? undefined : 'po-info-location-file-needs-ref'}
                  >
                    <td className="po-info-jobref-ref">
                      <code>{f.ref_number}</code>
                    </td>
                    <td className="po-info-location-filename">
                      {f.source_file || '—'}
                    </td>
                    <td className="po-info-location-rows">{f.row_count}</td>
                    <td className="po-info-meta">{formatImportedAt(f.imported_at)}</td>
                    <td>
                      {f.has_job_ref ? (
                        <span className="po-info-location-status-ok">Linked</span>
                      ) : (
                        <span className="po-info-location-status-needs">Needs job ref</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="po-info-jobref-block">
        <h3 className="po-info-ipoint-subtitle">Job reference list</h3>
        <p className="po-info-section-desc po-info-jobref-hint">
          Link each ref number to the job name from the PO Line Report (must match iPoint text).
        </p>
        <div className="po-info-jobref-add">
          <input
            type="text"
            placeholder="Job name (from PO Line Report)"
            value={newJobName}
            onChange={(e) => setNewJobName(e.target.value)}
            disabled={!!busy}
          />
          <input
            type="text"
            placeholder="Ref #"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            disabled={!!busy}
            className="po-info-jobref-ref-input"
          />
          <button type="button" disabled={!!busy} onClick={() => void handleAddJobRef()}>
            Add
          </button>
        </div>
        {jobRefs.length === 0 ? (
          <p className="po-info-ipoint-empty">
            No job refs yet. Add rows above for each ref in the uploaded location files list.
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
                    <td className="po-info-jobref-name">{r.job_name}</td>
                    <td className="po-info-jobref-ref">
                      <code>{r.ref_number}</code>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="po-info-delete-item"
                        disabled={!!busy}
                        title="Delete job ref"
                        onClick={() => {
                          if (!window.confirm(`Delete job ref ${r.ref_number}?`)) return
                          void (async () => {
                            setBusy('delete')
                            try {
                              await deleteJobRef(r.id)
                              onDataChanged()
                            } catch (err) {
                              onError(err instanceof Error ? err.message : 'Delete failed')
                            } finally {
                              setBusy(null)
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
