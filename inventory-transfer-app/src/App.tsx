import { useMemo, useState } from 'react'
import {
  compareInventories,
  defaultChoices,
  lineIsDiscrepancy,
  type CompareLine,
  type QtyChoice,
} from './lib/compareInventory'
import { countOverrides, exportUpdatedProductsCsv } from './lib/exportProducts'
import { parseInventoryFile, type ParsedWorkbook, type SourceKind } from './lib/parseInventoryFiles'
import './App.css'

type ViewMode = 'problems' | 'all'

function formatQty(n: number | null, raw: string): string {
  if (n == null) return '—'
  if (raw === '') return '0'
  return raw
}

function problemLabel(line: CompareLine): string {
  if (line.qtyDiffers) return 'Different counts'
  if (line.isGrouped) return 'Added together'
  if (line.isSimilar) return 'Looks similar, not the same'
  if (line.match === 'ipoint-only') return 'Only in iPoint'
  if (line.match === 'dtools-only') return 'Only in D-Tools'
  return 'Match'
}

function deltaText(line: CompareLine): string {
  if (line.ipointQty == null || line.dtoolsQty == null) return '—'
  const d = line.ipointQty - line.dtoolsQty
  if (d === 0) return '0'
  return d > 0 ? `+${d}` : String(d)
}

function ipointLabel(line: CompareLine): string {
  return [line.ipointPartNumber, line.ipointItem].filter(Boolean).join(' · ') || '—'
}

function dtoolsLabel(line: CompareLine): string {
  return [line.dtoolsPartNumber, line.dtoolsModel].filter(Boolean).join(' · ') || '—'
}

async function fileFromSample(url: string, fallbackName: string): Promise<File> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  return new File([blob], fallbackName, { type: blob.type })
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function App() {
  const [ipoint, setIpoint] = useState<ParsedWorkbook | null>(null)
  const [dtools, setDtools] = useState<ParsedWorkbook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('problems')
  const [query, setQuery] = useState('')
  const [choices, setChoices] = useState<Record<string, QtyChoice>>({})

  const result = useMemo(() => {
    if (!ipoint || !dtools) return null
    return compareInventories(ipoint, dtools)
  }, [ipoint, dtools])

  const loadFile = async (file: File, kind: SourceKind) => {
    setBusy(`Reading ${file.name}…`)
    setError(null)
    try {
      const parsed = await parseInventoryFile(file, kind)
      if (kind === 'ipoint') setIpoint(parsed)
      else setDtools(parsed)
      setChoices({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    } finally {
      setBusy(null)
    }
  }

  const loadSamples = async () => {
    setBusy('Loading example files…')
    setError(null)
    try {
      const [ipFile, dtFile] = await Promise.all([
        fileFromSample('/dev-samples/ipoint', 'Item List24.xlsx'),
        fileFromSample('/dev-samples/products', 'Products.csv'),
      ])
      const [ipParsed, dtParsed] = await Promise.all([
        parseInventoryFile(ipFile, 'ipoint'),
        parseInventoryFile(dtFile, 'dtools'),
      ])
      setIpoint(ipParsed)
      setDtools(dtParsed)
      setChoices({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load example files.')
    } finally {
      setBusy(null)
    }
  }

  const resolvedChoices = useMemo(() => {
    if (!result) return {}
    return { ...defaultChoices(result.lines), ...choices }
  }, [choices, result])

  const visible = useMemo(() => {
    if (!result) return []
    const q = query.trim().toUpperCase()
    return result.lines.filter((line) => {
      if (view === 'problems' && !lineIsDiscrepancy(line)) return false
      if (!q) return true
      return [ipointLabel(line), dtoolsLabel(line), problemLabel(line), line.similarTo, line.groupDetail]
        .join(' ')
        .toUpperCase()
        .includes(q)
    })
  }, [query, result, view])

  const overrideCount = countOverrides(resolvedChoices)

  const exportCsv = () => {
    if (!dtools || !result) return
    const csv = exportUpdatedProductsCsv(dtools, result.lines, resolvedChoices)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`Products-qty-from-ipoint-${stamp}.csv`, csv)
  }

  return (
    <div className="xfer-page">
      <header className="xfer-header">
        <div>
          <h1>Inventory Transfer</h1>
          <p className="xfer-lead">
            Upload both lists. Same part numbers are compared. Anything that does not line up shows in the list below.
          </p>
        </div>
        <a className="xfer-home" href="/">
          Home
        </a>
      </header>

      <div className="xfer-uploads">
        <section className="xfer-card">
          <h2>iPoint file</h2>
          <label className="xfer-file-btn">
            Choose file
            <input
              type="file"
              hidden
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void loadFile(file, 'ipoint')
              }}
            />
          </label>
          {ipoint ? (
            <div className="xfer-meta">
              {ipoint.comparedCount.toLocaleString()} parts · {ipoint.fileName}
              {ipoint.dataRowCount === 1000 ? (
                <p className="xfer-warn">This file has exactly 1,000 parts. If iPoint has more, export all of them.</p>
              ) : null}
            </div>
          ) : (
            <p className="xfer-muted">No file yet</p>
          )}
        </section>

        <section className="xfer-card">
          <h2>D-Tools file</h2>
          <label className="xfer-file-btn">
            Choose file
            <input
              type="file"
              hidden
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void loadFile(file, 'dtools')
              }}
            />
          </label>
          {dtools ? (
            <div className="xfer-meta">
              {dtools.comparedCount.toLocaleString()} parts · {dtools.fileName}
            </div>
          ) : (
            <p className="xfer-muted">No file yet</p>
          )}
        </section>
      </div>

      {import.meta.env.DEV ? (
        <button type="button" className="xfer-btn xfer-btn-secondary" onClick={() => void loadSamples()} disabled={!!busy}>
          Load example files
        </button>
      ) : null}

      {busy ? <p className="xfer-empty">{busy}</p> : null}
      {error ? <p className="xfer-error">{error}</p> : null}

      {result && ipoint && dtools ? (
        <>
          <p className="xfer-coverage">
            <strong>{result.discrepancyCount.toLocaleString()} problems</strong>
            {' · '}
            {result.matchedKeys.toLocaleString()} parts match
            {' · '}
            {result.qtyDifferences.toLocaleString()} have different counts
          </p>

          <div className="xfer-toolbar">
            <label className="xfer-choice">
              <input
                type="checkbox"
                checked={view === 'all'}
                onChange={(e) => setView(e.target.checked ? 'all' : 'problems')}
              />
              Show matching parts too
            </label>
            <input
              className="xfer-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
            />
            <button type="button" className="xfer-btn" onClick={exportCsv} disabled={overrideCount === 0}>
              Download D-Tools file ({overrideCount} count changes)
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="xfer-empty">{query.trim() ? 'Nothing matches that search.' : 'No problems found.'}</p>
          ) : (
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>What is different</th>
                    <th>iPoint</th>
                    <th>D-Tools</th>
                    <th>iPoint count</th>
                    <th>D-Tools count</th>
                    <th>Use iPoint count?</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((line) => {
                    const choice = resolvedChoices[line.id]
                    return (
                      <tr
                        key={line.id}
                        className={[
                          line.qtyDiffers ? 'xfer-row-diff' : '',
                          line.isSimilar ? 'xfer-row-similar' : '',
                          line.isGrouped ? 'xfer-row-grouped' : '',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined}
                      >
                        <td>
                          <strong>{problemLabel(line)}</strong>
                          {line.isSimilar && line.similarTo ? (
                            <div className="xfer-muted">Close to {line.similarTo}</div>
                          ) : null}
                          {line.isGrouped ? <div className="xfer-group-total">{line.groupDetail}</div> : null}
                        </td>
                        <td>
                          {ipointLabel(line) === '—' ? <span className="xfer-muted">—</span> : ipointLabel(line)}
                        </td>
                        <td>
                          {dtoolsLabel(line) === '—' ? <span className="xfer-muted">—</span> : dtoolsLabel(line)}
                        </td>
                        <td className="xfer-num">
                          {formatQty(line.ipointQty, line.isGrouped ? String(line.ipointQty) : line.ipointRaw)}
                        </td>
                        <td className="xfer-num">{formatQty(line.dtoolsQty, line.dtoolsRaw)}</td>
                        <td>
                          {line.qtyDiffers ? (
                            <label className="xfer-choice">
                              <input
                                type="checkbox"
                                checked={choice === 'use-ipoint'}
                                onChange={(e) =>
                                  setChoices((prev) => ({
                                    ...prev,
                                    [line.id]: e.target.checked ? 'use-ipoint' : 'keep-dtools',
                                  }))
                                }
                              />
                              Yes ({deltaText(line)})
                            </label>
                          ) : line.match === 'both' ? (
                            <span className="xfer-muted">Same</span>
                          ) : (
                            <span className="xfer-muted">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="xfer-empty">Choose both files to compare.</p>
      )}
    </div>
  )
}
