import { useEffect, useMemo, useState } from 'react'
import {
  estimateRoughIn,
  type HeadEndMark,
  type PdfPageText,
  type RoughInEstimate,
} from './roughIn/estimateRoughIn'
import { openRoughInPdf, type RoughInDocument } from './roughIn/readRoughInPdf'
import './RoughInEstimatePanel.css'

type PlanPreview = {
  pageIndex: number
  width: number
  height: number
  url: string
}

function parseFt(value: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

function formatFt(feet: number): string {
  return `${feet.toLocaleString()} ft`
}

export function RoughInEstimatePanel() {
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState<PdfPageText[] | null>(null)
  const [doc, setDoc] = useState<RoughInDocument | null>(null)
  const [wallDrop, setWallDrop] = useState('20')
  const [floorToFloor, setFloorToFloor] = useState('12')
  const [slack, setSlack] = useState('10')
  const [mark, setMark] = useState<HeadEndMark | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogDismissed, setDialogDismissed] = useState(false)
  const [pendingMark, setPendingMark] = useState<HeadEndMark | null>(null)
  const [previews, setPreviews] = useState<PlanPreview[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [showRuns, setShowRuns] = useState(false)

  const estimate: RoughInEstimate | null = useMemo(() => {
    if (!pages) return null
    return estimateRoughIn(pages, {
      wallDropFt: parseFt(wallDrop),
      floorToFloorFt: parseFt(floorToFloor),
      slackPercent: parseFt(slack),
      headEndMark: mark,
    })
  }, [pages, wallDrop, floorToFloor, slack, mark])

  useEffect(() => {
    if (!estimate || estimate.ok || estimate.reason !== 'needs-head-end' || dialogDismissed) return
    setDialogOpen(true)
  }, [estimate, dialogDismissed])

  useEffect(() => {
    if (!dialogOpen || !doc || !estimate || estimate.ok || estimate.reason !== 'needs-head-end') return
    let cancelled = false
    setPreviewError(null)
    const indexes = estimate.planPageIndexes
    void (async () => {
      try {
        const next: PlanPreview[] = []
        for (const pageIndex of indexes) {
          const page = pages?.find((candidate) => candidate.pageIndex === pageIndex)
          const canvas = await doc.renderPage(pageIndex, 0.42)
          if (cancelled) return
          next.push({
            pageIndex,
            width: page?.width ?? canvas.width,
            height: page?.height ?? canvas.height,
            url: canvas.toDataURL('image/png'),
          })
        }
        if (!cancelled) setPreviews(next)
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : 'Could not draw the plan.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dialogOpen, doc, estimate, pages])

  async function onFile(file: File | null) {
    if (!file) return
    setBusy(true)
    setError(null)
    setFileName(file.name)
    setMark(null)
    setPendingMark(null)
    setDialogDismissed(false)
    setDialogOpen(false)
    setPreviews([])
    setShowRuns(false)
    try {
      const buffer = await file.arrayBuffer()
      const opened = await openRoughInPdf(buffer)
      setDoc(opened)
      setPages(opened.pages)
    } catch (err) {
      setDoc(null)
      setPages(null)
      setError(err instanceof Error ? err.message : 'Could not read that PDF.')
    } finally {
      setBusy(false)
    }
  }

  function confirmMark() {
    if (!pendingMark) return
    setMark(pendingMark)
    setDialogOpen(false)
    setDialogDismissed(true)
  }

  const needsMark = estimate != null && !estimate.ok && estimate.reason === 'needs-head-end'

  return (
    <div className="roughin-panel">
      <h2 className="roughin-title">Rough-in estimate</h2>
      <p className="roughin-lead">
        Upload a rough-in PDF. Footage is estimated from the pull sheet and the scaled plan: each cable is
        measured across the sheet to its panel, then the wall drop is added. Tall walls and extra floors are
        the two numbers below.
      </p>

      <div className="roughin-controls">
        <label className="roughin-field">
          <span>Rough-in PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              void onFile(file)
              event.target.value = ''
            }}
          />
        </label>
        <label className="roughin-field roughin-field--short">
          <span>Wall drop (ft)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={wallDrop}
            onChange={(event) => setWallDrop(event.target.value)}
          />
        </label>
        <label className="roughin-field roughin-field--short">
          <span>Floor-to-floor (ft)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={floorToFloor}
            onChange={(event) => setFloorToFloor(event.target.value)}
          />
        </label>
        <label className="roughin-field roughin-field--short">
          <span>Slack (%)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={slack}
            onChange={(event) => setSlack(event.target.value)}
          />
        </label>
      </div>
      <p className="roughin-hint">
        Wall drop is added to every cable. Raise it for high walls. Floor-to-floor is added again for each
        level between a device and the head end.
      </p>

      {fileName && <p className="roughin-file">{busy ? 'Reading ' : ''}{fileName}</p>}
      {error && <p className="roughin-error">{error}</p>}
      {estimate && !estimate.ok && estimate.reason === 'error' && (
        <p className="roughin-error">{estimate.message}</p>
      )}

      {needsMark && (
        <div className="roughin-callout">
          <p>{estimate.message}</p>
          <button type="button" className="wire-report-primary" onClick={() => setDialogOpen(true)}>
            Mark AV head end
          </button>
        </div>
      )}

      {estimate?.ok && (
        <div className="roughin-result">
          <p className="roughin-meta">
            {estimate.headEndNote} Scale {estimate.scaleLabel}. Wall drop {parseFt(wallDrop)} ft,
            floor-to-floor {parseFt(floorToFloor)} ft, {parseFt(slack)}% slack. {estimate.cableCount}{' '}
            cables, {formatFt(estimate.totalFeet)} total.
            {estimate.unlocated > 0
              ? ` ${estimate.unlocated} not found on the plan (wall drop only).`
              : ''}
          </p>
          <div className="roughin-table-wrap">
            <table className="roughin-table">
              <thead>
                <tr>
                  <th>Wire type</th>
                  <th>Cables</th>
                  <th>Feet</th>
                </tr>
              </thead>
              <tbody>
                {estimate.totals.map((total) => (
                  <tr key={total.wireType}>
                    <td>{total.wireType}</td>
                    <td>{total.count}</td>
                    <td>{formatFt(total.feet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="wire-report-secondary"
            onClick={() => setShowRuns((open) => !open)}
          >
            {showRuns ? 'Hide cable runs' : 'Show cable runs'}
          </button>
          {showRuns && (
            <div className="roughin-table-wrap roughin-table-wrap--runs">
              <table className="roughin-table">
                <thead>
                  <tr>
                    <th>Wire #</th>
                    <th>Type</th>
                    <th>Destination</th>
                    <th>Feet</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.rows.map((row, index) => (
                    <tr key={`${row.wireId}-${row.wireType}-${index}`}>
                      <td>{row.wireId || '—'}</td>
                      <td>{row.wireType}</td>
                      <td>{row.destination || '—'}</td>
                      <td>{formatFt(row.feet)}</td>
                      <td>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {dialogOpen && needsMark && (
        <div className="wire-modal-backdrop" role="presentation">
          <div
            className="wire-modal roughin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roughin-headend-title"
          >
            <h3 id="roughin-headend-title">No AV head end on this drawing</h3>
            <p>
              Click the head-end location on the plan, then estimate again. Other panels printed on the
              sheet are still used when the pull sheet names them.
            </p>
            {previewError && <p className="roughin-error">{previewError}</p>}
            {previews.length === 0 && !previewError && <p>Loading plan…</p>}
            <div className="roughin-plan-scroll">
              {previews.map((preview) => {
                const pin =
                  pendingMark && pendingMark.pageIndex === preview.pageIndex ? pendingMark : null
                return (
                  <figure key={preview.pageIndex} className="roughin-plan">
                    <figcaption>Page {preview.pageIndex + 1}</figcaption>
                    <button
                      type="button"
                      className="roughin-plan-hit"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        const x = ((event.clientX - rect.left) / rect.width) * preview.width
                        const y =
                          preview.height - ((event.clientY - rect.top) / rect.height) * preview.height
                        setPendingMark({ pageIndex: preview.pageIndex, x, y })
                      }}
                    >
                      <img src={preview.url} alt={`Plan page ${preview.pageIndex + 1}`} />
                      {pin && (
                        <span
                          className="roughin-pin"
                          style={{
                            left: `${(pin.x / preview.width) * 100}%`,
                            top: `${(1 - pin.y / preview.height) * 100}%`,
                          }}
                        />
                      )}
                    </button>
                  </figure>
                )
              })}
            </div>
            <div className="wire-modal-actions">
              <button
                type="button"
                className="wire-report-secondary"
                onClick={() => {
                  setDialogOpen(false)
                  setDialogDismissed(true)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wire-report-primary"
                disabled={!pendingMark}
                onClick={confirmMark}
              >
                Estimate again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
