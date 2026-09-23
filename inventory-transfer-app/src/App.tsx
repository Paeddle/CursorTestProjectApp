import { useMemo, useState } from 'react'
import {
  compareInventories,
  defaultChoices,
  type CompareLine,
  type QtyChoice,
} from './lib/compareInventory'
import { countOverrides, exportUpdatedProductsCsv } from './lib/exportProducts'
import { parseInventoryFile, type ParsedWorkbook, type SourceKind } from './lib/parseInventoryFiles'
import './App.css'

type ListFilter = 'differences' | 'matched' | 'ipoint-only' | 'dtools-only' | 'overrides'

function formatQty(n: number | null, raw: string): string {
  if (n == null) return '—'
  if (raw === '') return 'blank → 0'
  return raw
}

function deltaText(line: CompareLine): string {
  if (line.ipointQty == null || line.dtoolsQty == null) return '—'
  const d = line.ipointQty - line.dtoolsQty
  if (d === 0) return '0'
  return d > 0 ? `+${d}` : String(d)
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
  const [filter, setFilter] = useState<ListFilter>('differences')
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
    setBusy('Loading CSVFiles examples…')
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
      setError(
        err instanceof Error
          ? `${err.message} Example loading only works in local development when CSVFiles/Item List24.xlsx and CSVFiles/Products.csv are present. Upload both files here instead.`
          : 'Could not load example files.',
      )
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
      if (filter === 'differences' && !line.qtyDiffers) return false
      if (filter === 'matched' && line.match !== 'both') return false
      if (filter === 'ipoint-only' && line.match !== 'ipoint-only') return false
      if (filter === 'dtools-only' && line.match !== 'dtools-only') return false
      if (filter === 'overrides' && resolvedChoices[line.id] !== 'use-ipoint') return false
      if (!q) return true
      const hay = [
        line.partNumberDisplay,
        line.ipointItem,
        line.ipointManufacturer,
        line.dtoolsBrand,
        line.dtoolsModel,
        ...line.notes,
      ]
        .join(' ')
        .toUpperCase()
      return hay.includes(q)
    })
  }, [filter, query, resolvedChoices, result])

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
            Compare iPoint <strong>Stock available</strong> to D-Tools Cloud <strong>Quantity on Hand</strong> for
            every part number. Nothing is written back to either system — you review each difference, then download
            an updated Products.csv if you want D-Tools to use the iPoint quantities.
          </p>
        </div>
        <a className="xfer-home" href="/">
          SHS home
        </a>
      </header>

      <div className="xfer-uploads">
        <section className="xfer-card">
          <h2>iPoint — Item List</h2>
          <p>
            Current inventory export (example: <code>Item List24.xlsx</code>). Uses the <code>Part Number</code> and{' '}
            <code>stock_Available</code> columns.
          </p>
          <div className="xfer-file-row">
            <label className="xfer-file-btn">
              Upload iPoint file
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
            <span className="xfer-file-name">{ipoint?.fileName || 'No file yet'}</span>
          </div>
          {ipoint ? (
            <div className="xfer-meta">
              <div>
                <strong>Rows with a part number:</strong> {ipoint.items.length}
              </div>
              <div>
                <strong>Part column:</strong> {ipoint.partNumberHeader}
              </div>
              <div>
                <strong>Qty column:</strong> {ipoint.qtyHeader}
              </div>
              {ipoint.warnings.map((w) => (
                <p key={w} className="xfer-warn">
                  {w}
                </p>
              ))}
            </div>
          ) : null}
        </section>

        <section className="xfer-card">
          <h2>D-Tools Cloud — Products</h2>
          <p>
            Destination inventory export (example: <code>Products.csv</code>). Uses <code>Part Number</code> and{' '}
            <code>Quantity on Hand</code>. Other columns stay untouched on export.
          </p>
          <div className="xfer-file-row">
            <label className="xfer-file-btn">
              Upload Products file
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
            <span className="xfer-file-name">{dtools?.fileName || 'No file yet'}</span>
          </div>
          {dtools ? (
            <div className="xfer-meta">
              <div>
                <strong>Rows with a part number:</strong> {dtools.items.length}
              </div>
              <div>
                <strong>Part column:</strong> {dtools.partNumberHeader}
              </div>
              <div>
                <strong>Qty column:</strong> {dtools.qtyHeader}
              </div>
              {dtools.warnings.map((w) => (
                <p key={w} className="xfer-warn">
                  {w}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {import.meta.env.DEV ? (
        <div className="xfer-toolbar">
          <button type="button" className="xfer-btn xfer-btn-secondary" onClick={() => void loadSamples()} disabled={!!busy}>
            Load CSVFiles examples
          </button>
          <span className="xfer-muted">Local only: Item List24.xlsx + Products.csv from the CSVFiles folder.</span>
        </div>
      ) : null}

      {busy ? <p className="xfer-empty">{busy}</p> : null}
      {error ? <p className="xfer-error">{error}</p> : null}

      {result && ipoint && dtools ? (
        <>
          <div className="xfer-stats">
            <div className="xfer-stat">
              <span>iPoint parts</span>
              <b>{ipoint.items.length}</b>
            </div>
            <div className="xfer-stat">
              <span>D-Tools parts</span>
              <b>{dtools.items.length}</b>
            </div>
            <div className="xfer-stat">
              <span>Matched part numbers</span>
              <b>{result.matchedKeys}</b>
            </div>
            <div className="xfer-stat xfer-stat-alert">
              <span>Qty differences</span>
              <b>{result.qtyDifferences}</b>
            </div>
            <div className="xfer-stat">
              <span>iPoint only</span>
              <b>{result.ipointOnly}</b>
            </div>
            <div className="xfer-stat">
              <span>D-Tools only</span>
              <b>{result.dtoolsOnly}</b>
            </div>
            <div className="xfer-stat">
              <span>Use iPoint qty</span>
              <b>{overrideCount}</b>
            </div>
          </div>

          <div className="xfer-toolbar">
            <div className="xfer-tabs">
              {(
                [
                  ['differences', `Qty differences (${result.qtyDifferences})`],
                  ['matched', `Matched (${result.matchedKeys})`],
                  ['ipoint-only', `iPoint only (${result.ipointOnly})`],
                  ['dtools-only', `D-Tools only (${result.dtoolsOnly})`],
                  ['overrides', `Chosen overrides (${overrideCount})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`xfer-tab ${filter === id ? 'xfer-tab-active' : ''}`}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="xfer-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search part number, item, brand…"
            />
            <button type="button" className="xfer-btn" onClick={applyIpointToDiffs} disabled={result.qtyDifferences === 0}>
              Use iPoint qty for all differences
            </button>
            <button type="button" className="xfer-btn xfer-btn-secondary" onClick={resetChoices} disabled={overrideCount === 0}>
              Keep all D-Tools qtys
            </button>
            <button type="button" className="xfer-btn" onClick={exportCsv} disabled={overrideCount === 0}>
              Download updated Products.csv
            </button>
          </div>

          {result.ipointDuplicates || result.dtoolsDuplicates ? (
            <p className="xfer-warn">
              Duplicate part numbers: {result.ipointDuplicates} in iPoint, {result.dtoolsDuplicates} in D-Tools. Those
              rows stay visible so nothing is silently merged except summed iPoint stock when the same part appears more
              than once.
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p className="xfer-empty">No lines in this view{query.trim() ? ' for that search' : ''}.</p>
          ) : (
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>Part number</th>
                    <th>iPoint item</th>
                    <th>D-Tools brand / model</th>
                    <th>iPoint stock available</th>
                    <th>D-Tools qty on hand</th>
                    <th>Difference</th>
                    <th>Decision</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((line) => {
                    const choice = resolvedChoices[line.id]
                    const delta = line.ipointQty != null && line.dtoolsQty != null ? line.ipointQty - line.dtoolsQty : 0
                    return (
                      <tr key={line.id} className={line.qtyDiffers ? 'xfer-row-diff' : undefined}>
                        <td>
                          <code>{line.partNumberDisplay}</code>
                        </td>
                        <td>
                          {line.ipointItem || <span className="xfer-muted">—</span>}
                          {line.ipointManufacturer ? (
                            <div className="xfer-muted">{line.ipointManufacturer}</div>
                          ) : null}
                        </td>
                        <td>
                          {line.dtoolsBrand || line.dtoolsModel ? (
                            <>
                              {line.dtoolsBrand} {line.dtoolsModel}
                            </>
                          ) : (
                            <span className="xfer-muted">—</span>
                          )}
                        </td>
                        <td className="xfer-num">{formatQty(line.ipointQty, line.ipointRaw)}</td>
                        <td className="xfer-num">{formatQty(line.dtoolsQty, line.dtoolsRaw)}</td>
                        <td
                          className={`xfer-num ${delta > 0 ? 'xfer-delta-up' : delta < 0 ? 'xfer-delta-down' : ''}`}
                        >
                          {deltaText(line)}
                        </td>
                        <td>
                          {line.match === 'both' ? (
                            <div className="xfer-choice">
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
                                Use iPoint qty
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
        <p className="xfer-empty">Upload both files to see the side-by-side comparison.</p>
      )}
    </div>
  )
}
