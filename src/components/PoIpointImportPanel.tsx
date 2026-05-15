import { useCallback, useState } from 'react'
import { extractPdfPlainTextForPoLineReport } from '../lib/extractPdfLines'
import { parsePoLineReportText } from '../lib/parsePoLineReport'
import { parsePoLineReportXlsx } from '../lib/parsePoLineReportXlsx'
import { parseJobRefXlsx } from '../lib/parseJobRefXlsx'
import {
  parseItemLocationsXlsx,
  refNumberFromFilename,
} from '../lib/parseItemLocationsXlsx'
import {
  addJobRef,
  deleteJobRef,
  importItemLocations,
  importJobRefs,
  importPoLineReport,
} from '../services/poIpointService'
import type { PoJobRef } from '../types/poIpoint'

type Props = {
  jobRefs: PoJobRef[]
  lineItemCount: number
  locationCount: number
  onDataChanged: () => void
  onError: (msg: string) => void
}

function PoIpointImportPanel({
  jobRefs,
  lineItemCount,
  locationCount,
  onDataChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [newRef, setNewRef] = useState('')

  const runImport = useCallback(
    async (label: string, fn: () => Promise<number>) => {
      setBusy(label)
      setImportMsg(null)
      onError('')
      try {
        const n = await fn()
        setImportMsg(`${label}: imported ${n} row${n === 1 ? '' : 's'} into Supabase.`)
        onDataChanged()
      } catch (e) {
        onError(e instanceof Error ? e.message : `${label} failed`)
      } finally {
        setBusy(null)
      }
    },
    [onDataChanged, onError]
  )

  const handlePoLineFile = async (file: File) => {
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
    await importPoLineReport(rows, file.name)
    return rows.length
  }

  const handleJobRefFile = async (file: File) => {
    const rows = parseJobRefXlsx(await file.arrayBuffer())
    if (rows.length === 0) throw new Error('No job references found.')
    await importJobRefs(rows)
    return rows.length
  }

  const handleLocationFile = async (file: File) => {
    const ref = refNumberFromFilename(file.name)
    if (!ref) {
      throw new Error('Filename must be a ref number (e.g. 4152.xlsx).')
    }
    const rows = parseItemLocationsXlsx(await file.arrayBuffer())
    if (rows.length === 0) throw new Error('No locations found in spreadsheet.')
    await importItemLocations(ref, rows, file.name)
    return rows.length
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
        Upload iPoint exports below. Each file is parsed in your browser and saved to Supabase.
        Run <code>supabase/add-po-ipoint-import.sql</code> once if the tables are not created yet.
      </p>

      <div className="po-info-ipoint-stats">
        <span>{lineItemCount} PO line{lineItemCount !== 1 ? 's' : ''}</span>
        <span>{jobRefs.length} job ref{jobRefs.length !== 1 ? 's' : ''}</span>
        <span>{locationCount} location row{locationCount !== 1 ? 's' : ''}</span>
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
          <span className="po-info-ipoint-upload-label">JobRef</span>
          <span className="po-info-ipoint-upload-hint">JobRef.xlsx — merges by ref number</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void runImport('JobRef', () => handleJobRefFile(f))
            }}
          />
        </label>
        <label className="po-info-ipoint-upload">
          <span className="po-info-ipoint-upload-label">Item locations</span>
          <span className="po-info-ipoint-upload-hint">
            4152.xlsx — ref from filename; replaces that ref
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
                    total += await handleLocationFile(f)
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
          <p className="po-info-ipoint-empty">No job refs yet. Upload JobRef.xlsx or add rows above.</p>
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
