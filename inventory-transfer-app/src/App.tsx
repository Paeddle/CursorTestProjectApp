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
      return [
        ipointLabel(line),
        dtoolsLabel(line),
        problemLabel(line),
        line.ipointManufacturer,
        line.dtoolsBrand,
        line.matchVia,
        line.similarTo,
        line.groupDetail,
        ...line.notes,
      ]
        .join(' ')
        .toUpperCase()
        .includes(q)
    })
  }, [query, result, view])

  const overrideCount = countOverrides(resolvedChoices)

  const setChoice = (id: string, choice: QtyChoice) => {
    setChoices((prev) => ({ ...prev, [id]: choice }))
  }

  const applyIpointToDiffs = () => {
    if (!result) return
    const next = { ...resolvedChoices }
    for (const line of result.lines) {
      if (line.qtyDiffers) next[line.id] = 'use-ipoint'
    }
    setChoices(next)
  }

  const resetChoices = () => setChoices({})

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
            Compare iPoint <strong>Item</strong> or <strong>Part Number</strong> to D-Tools Cloud{' '}
            <strong>Model</strong> or <strong>Part Number</strong>. Matching parts then compare iPoint{' '}
            <strong>Stock available</strong> to D-Tools <strong>Quantity on Hand</strong>. Nothing is written back
            to either system — you review differences, then download an updated Products.csv if you want D-Tools to
            use the iPoint quantities.
          </p>
        </div>
        <a className="xfer-home" href="/">
          Home
        </a>
      </header>

      <section className="xfer-algorithm" aria-labelledby="xfer-algorithm-title">
        <h2 id="xfer-algorithm-title">How the comparison works</h2>
        <ol>
          <li>
            <strong>Files stay in the browser.</strong> iPoint is read from <code>Item</code>,{' '}
            <code>Part Number</code>, and <code>stock_Available</code>. D-Tools is read from <code>Model</code>,{' '}
            <code>Part Number</code>, and <code>Quantity on Hand</code>. Nothing is uploaded to a server or written
            back to iPoint or D-Tools Cloud.
          </li>
          <li>
            <strong>Text is cleaned before matching.</strong> Extra spaces are stripped and letters are compared in
            uppercase, so <code>tp13bk</code> and <code>TP13BK</code> are the same. Short placeholders like{' '}
            <code>N/A</code>, <code>-</code>, or <code>NONE</code> are ignored so they cannot create fake matches.
          </li>
          <li>
            <strong>A D-Tools row matches an iPoint row if any one of these is true</strong> after that cleanup:
            <ul>
              <li>iPoint Part Number = D-Tools Part Number</li>
              <li>iPoint Part Number = D-Tools Model</li>
              <li>iPoint Item = D-Tools Part Number</li>
              <li>iPoint Item = D-Tools Model</li>
            </ul>
            Hyphens that are the only difference (same letters and numbers) also count as a match. Brand,
            description, and UPC are not used.
          </li>
          <li>
            <strong>Several iPoint rows can land on one D-Tools product.</strong> Their stock counts are{' '}
            <strong>added together</strong> and the row is labeled <em>Added together</em>, even if the total happens
            to equal the D-Tools quantity.
          </li>
          <li>
            <strong>Blank quantities count as 0.</strong> Commas are stripped (<code>1,200</code> → 1200).{' '}
            <em>Different counts</em> means the iPoint stock is not the same number as D-Tools qty on hand.
          </li>
          <li>
            <strong>Close SKUs are not treated as the same part.</strong> Related names like <code>C4-CA1</code> vs{' '}
            <code>C4-CA1-V2</code> are labeled <em>Looks similar, not the same</em>. Quantity is not copied from
            those. Rows that only appear in one file stay <em>Only in iPoint</em> or <em>Only in D-Tools</em>.
          </li>
          <li>
            <strong>Override is optional and local.</strong> Checking <em>Use iPoint count</em> only changes the
            downloaded Products.csv for that row. Original files are never modified.
          </li>
        </ol>
      </section>

      <div className="xfer-uploads">
        <section className="xfer-card">
          <h2>iPoint file</h2>
          <div className="xfer-file-row">
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
            <span className="xfer-file-name">{ipoint ? `${ipoint.comparedCount.toLocaleString()} parts · ${ipoint.fileName}` : 'No file yet'}</span>
          </div>
          {ipoint?.dataRowCount === 1000 ? (
            <p className="xfer-warn">This file has exactly 1,000 parts. If iPoint has more, export all of them.</p>
          ) : null}
        </section>

        <section className="xfer-card">
          <h2>D-Tools file</h2>
          <div className="xfer-file-row">
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
            <span className="xfer-file-name">{dtools ? `${dtools.comparedCount.toLocaleString()} parts · ${dtools.fileName}` : 'No file yet'}</span>
          </div>
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
            <strong>{result.discrepancyCount.toLocaleString()} problems</strong> in one list. Exact matches:{' '}
            {result.matchedKeys.toLocaleString()} of {dtools.comparedCount.toLocaleString()} D-Tools parts and{' '}
            {ipoint.comparedCount.toLocaleString()} iPoint parts. Similar SKUs are near-misses, not missed exact
            matches.
          </p>

          <div className="xfer-stats">
            <div className="xfer-stat xfer-stat-alert">
              <span>Problems</span>
              <b>{result.discrepancyCount}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Different counts</span>
              <b>{result.qtyDifferences}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Added together</span>
              <b>{result.groupedCount}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Looks similar</span>
              <b>{result.similarCount}</b>
            </div>
            <div className="xfer-stat">
              <span>Only in iPoint</span>
              <b>{result.ipointOnly}</b>
            </div>
            <div className="xfer-stat">
              <span>Only in D-Tools</span>
              <b>{result.dtoolsOnly}</b>
            </div>
            <div className="xfer-stat">
              <span>Matched</span>
              <b>{result.matchedKeys}</b>
            </div>
            <div className="xfer-stat">
              <span>Use iPoint count</span>
              <b>{overrideCount}</b>
            </div>
          </div>

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
              placeholder="Search part number, item, brand…"
            />
            <button type="button" className="xfer-btn" onClick={applyIpointToDiffs} disabled={result.qtyDifferences === 0}>
              Use iPoint count for all differences
            </button>
            <button type="button" className="xfer-btn xfer-btn-secondary" onClick={resetChoices} disabled={overrideCount === 0}>
              Keep all D-Tools counts
            </button>
            <button type="button" className="xfer-btn" onClick={exportCsv} disabled={overrideCount === 0}>
              Download updated Products.csv
            </button>
          </div>

          {result.ipointDuplicates || result.dtoolsDuplicates ? (
            <p className="xfer-warn">
              Duplicate IDs: {result.ipointDuplicates} iPoint item/part-number values and {result.dtoolsDuplicates}{' '}
              D-Tools model/part-number values appear on more than one row. If several iPoint rows match one D-Tools
              row, stock is added together.
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p className="xfer-empty">{query.trim() ? 'Nothing matches that search.' : 'No problems found.'}</p>
          ) : (
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>What is different</th>
                    <th>iPoint part number</th>
                    <th>iPoint item</th>
                    <th>D-Tools part number</th>
                    <th>D-Tools model</th>
                    <th>Matched via</th>
                    <th>Similar SKU</th>
                    <th>iPoint stock</th>
                    <th>D-Tools qty</th>
                    <th>Difference</th>
                    <th>Decision</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((line) => {
                    const choice = resolvedChoices[line.id]
                    const delta =
                      line.ipointQty != null && line.dtoolsQty != null ? line.ipointQty - line.dtoolsQty : 0
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
                        </td>
                        <td>
                          {line.ipointPartNumber ? (
                            <code>{line.ipointPartNumber}</code>
                          ) : (
                            <span className="xfer-muted">—</span>
                          )}
                          {line.isSimilar && line.match === 'dtools-only' ? (
                            <div className="xfer-muted">Nearby iPoint SKU — not a match</div>
                          ) : null}
                        </td>
                        <td>
                          {line.ipointItem || <span className="xfer-muted">—</span>}
                          {line.ipointManufacturer ? (
                            <div className="xfer-muted">{line.ipointManufacturer}</div>
                          ) : null}
                        </td>
                        <td>
                          {line.dtoolsPartNumber ? (
                            <code>{line.dtoolsPartNumber}</code>
                          ) : (
                            <span className="xfer-muted">—</span>
                          )}
                          {line.dtoolsBrand ? <div className="xfer-muted">{line.dtoolsBrand}</div> : null}
                          {line.isSimilar && line.match === 'ipoint-only' ? (
                            <div className="xfer-muted">Nearby D-Tools SKU — not a match</div>
                          ) : null}
                        </td>
                        <td>{line.dtoolsModel || <span className="xfer-muted">—</span>}</td>
                        <td className="xfer-notes">{line.matchVia || '—'}</td>
                        <td>
                          {line.isSimilar ? <span className="xfer-flag-similar">Similar</span> : null}
                          {line.similarTo ? (
                            <code>{line.similarTo}</code>
                          ) : (
                            <span className="xfer-muted">—</span>
                          )}
                        </td>
                        <td className="xfer-num">
                          {formatQty(line.ipointQty, line.isGrouped ? String(line.ipointQty) : line.ipointRaw)}
                          {line.isGrouped ? (
                            <div className="xfer-group">
                              <span className="xfer-flag-grouped">Added together</span>
                              <ul>
                                {line.ipointSlices.map((slice, idx) => (
                                  <li key={`${line.id}-s-${idx}`}>
                                    <code>{slice.partNumber || slice.item || 'row'}</code>
                                    {slice.item && slice.partNumber ? ` · ${slice.item}` : ''}
                                    {': '}
                                    {slice.qtyRaw === '' ? 'blank→0' : slice.qtyRaw}
                                  </li>
                                ))}
                              </ul>
                              <div className="xfer-group-total">{line.groupDetail}</div>
                            </div>
                          ) : null}
                        </td>
                        <td className="xfer-num">{formatQty(line.dtoolsQty, line.dtoolsRaw)}</td>
                        <td
                          className={`xfer-num ${delta > 0 ? 'xfer-delta-up' : delta < 0 ? 'xfer-delta-down' : ''}`}
                        >
                          {deltaText(line)}
                        </td>
                        <td>
                          {line.match === 'both' ? (
                            <div className="xfer-choice-stack">
                              <label>
                                <input
                                  type="radio"
                                  name={`choice-${line.id}`}
                                  checked={choice !== 'use-ipoint'}
                                  onChange={() => setChoice(line.id, 'keep-dtools')}
                                />
                                Keep D-Tools
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name={`choice-${line.id}`}
                                  checked={choice === 'use-ipoint'}
                                  onChange={() => setChoice(line.id, 'use-ipoint')}
                                />
                                Use iPoint count
                              </label>
                            </div>
                          ) : (
                            <span className="xfer-muted">No D-Tools row to update</span>
                          )}
                        </td>
                        <td className="xfer-notes">{line.notes.join('. ') || '—'}</td>
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
