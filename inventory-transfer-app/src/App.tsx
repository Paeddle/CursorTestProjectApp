import { useMemo, useState } from 'react'
import {
  applyTreatedSimilar,
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
type SortCol =
  | 'problem'
  | 'ipointPn'
  | 'ipointItem'
  | 'dtoolsPn'
  | 'dtoolsModel'
  | 'matchVia'
  | 'similar'
  | 'ipointQty'
  | 'dtoolsQty'
  | 'diff'
  | 'decision'
  | 'notes'
type SortDir = 'asc' | 'desc'

function formatQty(n: number | null, raw: string): string {
  if (n == null) return '—'
  if (raw === '') return '0'
  return raw
}

function problemLabel(line: CompareLine): string {
  if (line.treatedAsSame && line.qtyDiffers) return 'Different counts'
  if (line.treatedAsSame) return 'Treated as the same'
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

function sortValue(line: CompareLine, col: SortCol, choice: QtyChoice | undefined): string | number {
  switch (col) {
    case 'problem':
      return problemLabel(line)
    case 'ipointPn':
      return line.ipointPartNumber
    case 'ipointItem':
      return line.ipointItem
    case 'dtoolsPn':
      return line.dtoolsPartNumber
    case 'dtoolsModel':
      return line.dtoolsModel
    case 'matchVia':
      return line.matchVia
    case 'similar':
      return `${line.treatedAsSame ? '1' : '0'}${line.similarTo}`
    case 'ipointQty':
      return line.ipointQty ?? Number.NEGATIVE_INFINITY
    case 'dtoolsQty':
      return line.dtoolsQty ?? Number.NEGATIVE_INFINITY
    case 'diff':
      if (line.ipointQty == null || line.dtoolsQty == null) return Number.NEGATIVE_INFINITY
      return line.ipointQty - line.dtoolsQty
    case 'decision':
      return choice === 'use-ipoint' ? 1 : 0
    case 'notes':
      return line.notes.join(' ')
  }
}

function SortHeader({
  id,
  label,
  sortCol,
  sortDir,
  onCycle,
}: {
  id: SortCol
  label: string
  sortCol: SortCol | null
  sortDir: SortDir
  onCycle: (id: SortCol) => void
}) {
  const arrow = sortCol === id ? (sortDir === 'asc' ? '▲' : '▼') : ''
  return (
    <th>
      <button type="button" className="xfer-sort" onClick={() => onCycle(id)}>
        <span>{label}</span>
        {arrow ? <span className="xfer-sort-arrow">{arrow}</span> : null}
      </button>
    </th>
  )
}

export function App() {
  const [ipoint, setIpoint] = useState<ParsedWorkbook | null>(null)
  const [dtools, setDtools] = useState<ParsedWorkbook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('problems')
  const [query, setQuery] = useState('')
  const [choices, setChoices] = useState<Record<string, QtyChoice>>({})
  const [treatedSimilar, setTreatedSimilar] = useState<Record<string, boolean>>({})
  const [sortCol, setSortCol] = useState<SortCol | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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
      setTreatedSimilar({})
      setSortCol(null)
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
      setTreatedSimilar({})
      setSortCol(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load example files.')
    } finally {
      setBusy(null)
    }
  }

  const effectiveLines = useMemo(() => {
    if (!result) return []
    return applyTreatedSimilar(result.lines, treatedSimilar)
  }, [result, treatedSimilar])

  const resolvedChoices = useMemo(() => {
    if (!effectiveLines.length) return {}
    return { ...defaultChoices(effectiveLines), ...choices }
  }, [choices, effectiveLines])

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    const filtered = effectiveLines.filter((line) => {
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
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortCol, resolvedChoices[a.id])
      const bv = sortValue(b, sortCol, resolvedChoices[b.id])
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [effectiveLines, query, resolvedChoices, sortCol, sortDir, view])

  const stats = useMemo(
    () => ({
      discrepancyCount: effectiveLines.filter(lineIsDiscrepancy).length,
      qtyDifferences: effectiveLines.filter((line) => line.qtyDiffers).length,
      groupedCount: effectiveLines.filter((line) => line.isGrouped).length,
      similarCount: effectiveLines.filter((line) => line.isSimilar && !line.treatedAsSame).length,
      ipointOnly: effectiveLines.filter((line) => line.match === 'ipoint-only').length,
      dtoolsOnly: effectiveLines.filter((line) => line.match === 'dtools-only').length,
      matchedKeys: effectiveLines.filter((line) => line.match === 'both').length,
    }),
    [effectiveLines],
  )

  const overrideCount = countOverrides(resolvedChoices)

  const setChoice = (id: string, choice: QtyChoice) => {
    setChoices((prev) => ({ ...prev, [id]: choice }))
  }

  const cycleSort = (id: SortCol) => {
    if (sortCol !== id) {
      setSortCol(id)
      setSortDir('asc')
      return
    }
    if (sortDir === 'asc') {
      setSortDir('desc')
      return
    }
    setSortCol(null)
    setSortDir('asc')
  }

  const toggleTreatAsSame = (line: CompareLine, checked: boolean) => {
    setTreatedSimilar((prev) => {
      const next = { ...prev }
      const ids = [line.id, line.similarPeerId].filter(Boolean)
      for (const id of ids) {
        if (checked) next[id] = true
        else delete next[id]
      }
      return next
    })
  }

  const applyIpointToDiffs = () => {
    const next = { ...resolvedChoices }
    for (const line of effectiveLines) {
      if (line.qtyDiffers) next[line.id] = 'use-ipoint'
    }
    setChoices(next)
  }

  const resetChoices = () => setChoices({})

  const exportCsv = () => {
    if (!dtools) return
    const csv = exportUpdatedProductsCsv(dtools, effectiveLines, resolvedChoices)
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
            <strong>Close SKUs are not treated as the same part unless you say so.</strong> Related names like{' '}
            <code>C4-CA1</code> vs <code>C4-CA1-V2</code> are labeled <em>Looks similar, not the same</em>. Check{' '}
            <em>Treat as same part</em> to compare their counts and, if you want, copy the iPoint count onto that
            D-Tools row. Rows that only appear in one file stay <em>Only in iPoint</em> or <em>Only in D-Tools</em>.
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
          <div className="xfer-stats">
            <div className="xfer-stat xfer-stat-alert">
              <span>Rows to review</span>
              <b>{stats.discrepancyCount}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Different counts</span>
              <b>{stats.qtyDifferences}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Added together</span>
              <b>{stats.groupedCount}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Looks similar</span>
              <b>{stats.similarCount}</b>
            </div>
            <div className="xfer-stat">
              <span>Only in iPoint</span>
              <b>{stats.ipointOnly}</b>
            </div>
            <div className="xfer-stat">
              <span>Only in D-Tools</span>
              <b>{stats.dtoolsOnly}</b>
            </div>
            <div className="xfer-stat">
              <span>Same in both</span>
              <b>{stats.matchedKeys}</b>
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
              Show matching rows too
            </label>
            <input
              className="xfer-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search part number, item, brand…"
            />
            <button type="button" className="xfer-btn" onClick={applyIpointToDiffs} disabled={stats.qtyDifferences === 0}>
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
            <p className="xfer-empty">{query.trim() ? 'Nothing matches that search.' : 'No rows to review.'}</p>
          ) : (
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortHeader id="problem" label="What is different" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="ipointPn" label="iPoint part number" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="ipointItem" label="iPoint item" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="dtoolsPn" label="D-Tools part number" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="dtoolsModel" label="D-Tools model" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="matchVia" label="Matched via" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="similar" label="Similar SKU" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="ipointQty" label="iPoint stock" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="dtoolsQty" label="D-Tools qty" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="diff" label="Difference" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="decision" label="Decision" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
                    <SortHeader id="notes" label="Notes" sortCol={sortCol} sortDir={sortDir} onCycle={cycleSort} />
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
                          {line.isSimilar && line.match === 'dtools-only' && !line.treatedAsSame ? (
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
                          {line.isSimilar && line.match === 'ipoint-only' && !line.treatedAsSame ? (
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
                          {line.isSimilar && line.similarDtoolsSourceIndex != null ? (
                            <label className="xfer-choice xfer-treat">
                              <input
                                type="checkbox"
                                checked={line.treatedAsSame}
                                onChange={(e) => toggleTreatAsSame(line, e.target.checked)}
                              />
                              Treat as same part
                            </label>
                          ) : null}
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
