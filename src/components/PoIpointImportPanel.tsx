import { useCallback, useEffect, useMemo, useState } from 'react'
import { extractPdfPlainTextForPoLineReport } from '../lib/extractPdfLines'
import {
  planLocationFileUploads,
  summarizeLocationUploadPlans,
  uploadedLocationRefs,
} from '../lib/locationUploadPlan'
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
  searchPoItemLocations,
  summarizeLocationUploads,
} from '../services/poIpointService'
import type { PoItemLocation, PoJobRef } from '../types/poIpoint'

/** Product lookup UI — re-enable when needed. */
const SHOW_PRODUCT_IN_IMPORTED_LOCATIONS = false

type Props = {
  jobRefs: PoJobRef[]
  itemLocations: PoItemLocation[]
  lineItemCount: number
  locationCount: number
  ipointLoading?: boolean
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
  ipointLoading,
  onDataChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [locationProgress, setLocationProgress] = useState<{
    current: number
    total: number
    fileName: string
  } | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [newRef, setNewRef] = useState('')
  const [productLookup, setProductLookup] = useState('')
  const [productLookupHits, setProductLookupHits] = useState<PoItemLocation[]>([])
  const [productLookupBusy, setProductLookupBusy] = useState(false)

  const locationFiles = useMemo(
    () => summarizeLocationUploads(itemLocations, jobRefs),
    [itemLocations, jobRefs]
  )

  const uploadedRefSet = useMemo(
    () => uploadedLocationRefs(locationFiles),
    [locationFiles]
  )

  useEffect(() => {
    const q = productLookup.trim()
    if (!q) {
      setProductLookupHits([])
      setProductLookupBusy(false)
      return
    }

    let cancelled = false
    setProductLookupBusy(true)
    void searchPoItemLocations(q)
      .then((hits) => {
        if (!cancelled) {
          setProductLookupHits(
            hits.sort(
              (a, b) =>
                String(a.ref_number).localeCompare(String(b.ref_number), undefined, {
                  numeric: true,
                }) || a.location_name.localeCompare(b.location_name)
            )
          )
        }
      })
      .catch((e) => {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : 'Product search failed')
          setProductLookupHits([])
        }
      })
      .finally(() => {
        if (!cancelled) setProductLookupBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [productLookup, onError])

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
    const stockNote =
      stats.withoutJob > 0
        ? ` ${stats.withoutJob} stock line${stats.withoutJob !== 1 ? 's' : ''} (blank customer).`
        : ''
    const qtyNote =
      stats.withQuantity < stats.total
        ? ` ${stats.withQuantity} line${stats.withQuantity !== 1 ? 's' : ''} have Req. quantities (${stats.total - stats.withQuantity} missing — re-export or use PDF/CSV if Excel dropped the Req. column).`
        : ` All ${stats.withQuantity} lines include Req. quantities.`
    return {
      count: rows.length,
      detail: `PO Line Report: imported ${stats.total} line${stats.total !== 1 ? 's' : ''} (${stats.uniquePos} POs).${qtyNote}${stockNote}`,
    }
  }

  const handleLocationFile = useCallback(async (
    file: File
  ): Promise<{ count: number; detail?: string }> => {
    const ref = refNumberFromFilename(file.name)
    if (!ref) {
      throw new Error('Filename must include a ref number (e.g. 4152.xlsx or SalesOrder_4152.xlsx).')
    }
    const rows = parseItemLocationsXlsx(await file.arrayBuffer())
    if (rows.length === 0) throw new Error('No locations found in spreadsheet.')
    const count = await importItemLocations(ref, rows, file.name)
    return {
      count,
      detail: `Ref ${ref}: ${count} row${count !== 1 ? 's' : ''} from ${file.name}.`,
    }
  }, [])

  const handleLocationFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      setImportMsg(null)
      onError('')
      setBusy('locations')

      const plans = planLocationFileUploads(files, uploadedRefSet)
      const { toUpload, skipped, invalid } = summarizeLocationUploadPlans(plans)

      if (toUpload.length === 0) {
        setBusy(null)
        setLocationProgress(null)
        const parts: string[] = []
        if (skipped.length > 0) {
          parts.push(
            `Skipped ${skipped.length} file${skipped.length !== 1 ? 's' : ''} (already uploaded or duplicate ref in selection).`
          )
        }
        if (invalid.length > 0) {
          parts.push(
            `${invalid.length} file${invalid.length !== 1 ? 's' : ''} skipped (need a ref number in the filename, e.g. 4152.xlsx).`
          )
        }
        setImportMsg(
          parts.length > 0
            ? parts.join(' ')
            : 'No location files selected.'
        )
        return
      }

      const details: string[] = []
      const errors: string[] = []
      let totalRows = 0
      let succeeded = 0

      for (let i = 0; i < toUpload.length; i++) {
        const plan = toUpload[i]!
        setLocationProgress({
          current: i + 1,
          total: toUpload.length,
          fileName: plan.file.name,
        })
        try {
          const { count, detail } = await handleLocationFile(plan.file)
          totalRows += count
          succeeded++
          if (detail) details.push(detail)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Import failed'
          errors.push(`${plan.file.name}: ${msg}`)
        }
      }

      setBusy(null)
      setLocationProgress(null)

      const summaryParts: string[] = []
      if (succeeded > 0) {
        summaryParts.push(
          `Imported ${succeeded} file${succeeded !== 1 ? 's' : ''} (${totalRows.toLocaleString()} location row${totalRows !== 1 ? 's' : ''}).`
        )
      }
      if (skipped.length > 0) {
        const existing = skipped.filter((p) => p.status === 'skip-existing')
        const dup = skipped.filter((p) => p.status === 'skip-duplicate')
        if (existing.length > 0) {
          summaryParts.push(
            `Skipped ${existing.length} already uploaded (${existing.map((p) => p.ref).join(', ')}).`
          )
        }
        if (dup.length > 0) {
          summaryParts.push(
            `Skipped ${dup.length} duplicate ref${dup.length !== 1 ? 's' : ''} in selection.`
          )
        }
      }
      if (invalid.length > 0) {
        summaryParts.push(
          `${invalid.length} file${invalid.length !== 1 ? 's' : ''} skipped (invalid filename or type).`
        )
      }

      setImportMsg(summaryParts.join(' '))

      if (errors.length > 0) {
        onError(errors.join('\n'))
      } else {
        onError('')
      }

      if (succeeded > 0) {
        onDataChanged()
      }
    },
    [handleLocationFile, onDataChanged, onError, uploadedRefSet]
  )

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

  const locationUploadDisabled = !!busy
  const uploadedRefList = useMemo(
    () => [...uploadedRefSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [uploadedRefSet]
  )

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
            disabled={locationUploadDisabled}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void runImport('PO Line Report', () => handlePoLineFile(f))
            }}
          />
        </label>
        <label className="po-info-ipoint-upload po-info-ipoint-upload-locations">
          <span className="po-info-ipoint-upload-label">Item locations</span>
          <span className="po-info-ipoint-upload-hint">
            Select multiple .xlsx files (e.g. 4152.xlsx). Ref # comes from the filename. Files
            whose ref is already uploaded are skipped automatically.
          </span>
          <input
            type="file"
            accept=".xlsx,.xls"
            multiple
            disabled={locationUploadDisabled}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              void handleLocationFiles(files)
            }}
          />
          {uploadedRefList.length > 0 && (
            <span className="po-info-ipoint-upload-refs">
              Already uploaded refs: {uploadedRefList.join(', ')}
            </span>
          )}
        </label>
      </div>

      {locationProgress && (
        <p className="po-info-ipoint-progress" role="status">
          Uploading {locationProgress.current} of {locationProgress.total}:{' '}
          <strong>{locationProgress.fileName}</strong>
        </p>
      )}
      {busy && !locationProgress && <p className="po-info-ipoint-busy">Working: {busy}…</p>}
      {importMsg && <p className="po-info-ipoint-success">{importMsg}</p>}

      <div className="po-info-location-files-block">
        <h3 className="po-info-ipoint-subtitle">Uploaded location files</h3>
        <p className="po-info-section-desc po-info-jobref-hint">
          Each ref number you have uploaded appears here (row counts loaded from Supabase, not
          limited to the first 1,000 rows). Refs marked{' '}
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
        <p className="po-info-section-desc">
          {ipointLoading
            ? 'Loading room locations from Supabase…'
            : locationCount > 0
              ? `${locationCount.toLocaleString()} location row${locationCount !== 1 ? 's' : ''} loaded for PO matching.`
              : 'No location rows loaded yet.'}
        </p>
        {locationFiles.length === 0 ? (
          <p className="po-info-ipoint-empty">No location files uploaded yet.</p>
        ) : (
          <div className="po-info-jobref-table-wrap po-info-scroll-panel">
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

      {SHOW_PRODUCT_IN_IMPORTED_LOCATIONS && (
      <div className="po-info-product-lookup-block">
        <h3 className="po-info-ipoint-subtitle">Check product in imported locations</h3>
        <p className="po-info-section-desc">
          After uploading location files, search here to confirm a part (e.g. VX80R) is in Supabase
          with the expected room. This uses the same matching rules as PO Info line items.
        </p>
        <input
          type="text"
          className="po-info-product-lookup-input"
          placeholder="Product name, e.g. VX80R"
          value={productLookup}
          onChange={(e) => setProductLookup(e.target.value)}
        />
        {productLookup.trim() && (
          <div className="po-info-product-lookup-results">
            {productLookupBusy ? (
              <p className="po-info-ipoint-empty">Searching Supabase…</p>
            ) : productLookupHits.length === 0 ? (
              <p className="po-info-ipoint-empty">
                No rows match &quot;{productLookup.trim()}&quot; in imported location data. Try
                re-uploading the ref file (e.g. 4846.xlsx).
              </p>
            ) : (
              <>
                <p className="po-info-product-lookup-count">
                  {productLookupHits.length} row
                  {productLookupHits.length !== 1 ? 's' : ''} —{' '}
                  {[...new Set(productLookupHits.map((h) => h.location_name))].length} unique room
                  {[...new Set(productLookupHits.map((h) => h.location_name))].length !== 1
                    ? 's'
                    : ''}
                </p>
                <div className="po-info-jobref-table-wrap">
                  <table className="po-info-jobref-table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Product</th>
                        <th>Room</th>
                        <th>Job ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productLookupHits.slice(0, 40).map((h) => (
                        <tr key={h.id}>
                          <td>{h.ref_number}</td>
                          <td>{h.product_name}</td>
                          <td>{h.location_name}</td>
                          <td>
                            {jobRefs.find((r) => r.ref_number === h.ref_number)?.job_name ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {productLookupHits.length > 40 && (
                  <p className="po-info-section-desc">Showing first 40 of {productLookupHits.length}.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
      )}

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
            disabled={locationUploadDisabled}
          />
          <input
            type="text"
            placeholder="Ref #"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            disabled={locationUploadDisabled}
            className="po-info-jobref-ref-input"
          />
          <button type="button" disabled={locationUploadDisabled} onClick={() => void handleAddJobRef()}>
            Add
          </button>
        </div>
        {jobRefs.length === 0 ? (
          <p className="po-info-ipoint-empty">
            No job refs yet. Add rows above for each ref in the uploaded location files list.
          </p>
        ) : (
          <div className="po-info-jobref-table-wrap po-info-scroll-panel">
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
                        disabled={locationUploadDisabled}
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
