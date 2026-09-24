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

function FileCountMeta({ file, source }: { file: ParsedWorkbook; source: SourceKind }) {
  const excelCount = file.dataRowCount + 1
  return (
    <div className="xfer-meta">
      <div>
        <strong>Spreadsheet rows:</strong> {excelCount.toLocaleString()} including header ({file.dataRowCount.toLocaleString()}{' '}
        product rows)
      </div>
      <div>
        <strong>Included in compare:</strong> {file.comparedCount.toLocaleString()}
      </div>
      <div>
        <strong>Blank part number:</strong> {file.blankPartNumberCount.toLocaleString()}
        {source === 'dtools' ? ' (still compared by Model)' : ' (still compared by Item if present)'}
      </div>
      {file.skippedNoIdentity ? (
        <div>
          <strong>Skipped, no match fields:</strong> {file.skippedNoIdentity.toLocaleString()}
        </div>
      ) : null}
      <div>
        <strong>Part column:</strong> {file.partNumberHeader}
      </div>
      <div>
        <strong>Qty column:</strong> {file.qtyHeader}
      </div>
      {file.warnings.map((w) => (
        <p key={w} className="xfer-warn">
          {w}
        </p>
      ))}
    </div>
  )
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
        line.dtoolsPartNumber,
        line.dtoolsModel,
        line.matchVia,
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
            Compare iPoint <strong>Item</strong> or <strong>Part Number</strong> to D-Tools Cloud{' '}
            <strong>Model</strong> or <strong>Part Number</strong>. Any of those four fields matching counts as the
            same part. Then compare iPoint <strong>Stock available</strong> to D-Tools <strong>Quantity on Hand</strong>
            . Nothing is written back to either system — you review each difference, then download an updated
            Products.csv if you want D-Tools to use the iPoint quantities.
          </p>
        </div>
        <a className="xfer-home" href="/">
          SHS home
        </a>
      </header>

      <section className="xfer-algorithm" aria-labelledby="xfer-algorithm-title">
        <h2 id="xfer-algorithm-title">How the comparison works</h2>
        <ol>
          <li>
            <strong>Read the files in the browser only.</strong> iPoint is read from <code>Item</code>,{' '}
            <code>Part Number</code>, and <code>stock_Available</code> (Excel or CSV). D-Tools is read from{' '}
            <code>Model</code>, <code>Part Number</code>, and <code>Quantity on Hand</code>. No data is uploaded to a
            server or written back to iPoint or D-Tools Cloud.
          </li>
          <li>
            <strong>Normalize text before matching.</strong> Leading/trailing spaces are stripped, internal spaces are
            collapsed, and letters are compared in uppercase. So <code>tp13bk</code> and <code>TP13BK</code> are the
            same key. Values shorter than 2 characters, and placeholders like <code>N/A</code>, <code>-</code>,{' '}
            <code>NONE</code>, <code>NULL</code>, or <code>?</code>, are ignored so they cannot create fake matches.
          </li>
          <li>
            <strong>A D-Tools row matches an iPoint row if any one of these equalities is true</strong> after
            normalization:
            <ul>
              <li>iPoint Part Number = D-Tools Part Number</li>
              <li>iPoint Part Number = D-Tools Model</li>
              <li>iPoint Item = D-Tools Part Number</li>
              <li>iPoint Item = D-Tools Model</li>
            </ul>
            Brand, description, UPC, and every other column are not used for matching. The <em>Matched via</em> column
            lists which of those four checks succeeded.
          </li>
          <li>
            <strong>Results are grouped by D-Tools product row.</strong> If several iPoint rows match the same D-Tools
            row, their <code>stock_Available</code> values are added together and the note says they were summed. If
            one iPoint row matches more than one D-Tools row, that iPoint quantity is shown on each matched D-Tools
            line so you can decide per D-Tools product.
          </li>
          <li>
            <strong>Quantities are numbers.</strong> Blank <code>stock_Available</code> or <code>Quantity on Hand</code>{' '}
            is treated as <strong>0</strong> and labeled <code>blank → 0</code>. Commas are stripped (<code>1,200</code>{' '}
            → 1200). A quantity difference is any matched pair where iPoint stock ≠ D-Tools qty on hand. Unmatched
            rows (iPoint only / D-Tools only) are listed separately and are not treated as quantity differences.
          </li>
          <li>
            <strong>Override is opt-in and local.</strong> Default for every matched line is Keep D-Tools. Choosing Use
            iPoint qty only changes the downloaded CSV: that D-Tools row’s <code>Quantity on Hand</code> is replaced
            with the iPoint stock used on that line. Every other Products column stays as it was, including rows you
            did not override. The original uploaded files are never modified.
          </li>
        </ol>
      </section>

      <div className="xfer-uploads">
        <section className="xfer-card">
          <h2>iPoint — Item List</h2>
          <p>
            Current inventory export (example: <code>Item List24.xlsx</code>). Matches using the <code>Item</code> and{' '}
            <code>Part Number</code> columns against D-Tools, and compares <code>stock_Available</code>.
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
          {ipoint ? <FileCountMeta file={ipoint} source="ipoint" /> : null}
        </section>

        <section className="xfer-card">
          <h2>D-Tools Cloud — Products</h2>
          <p>
            Destination inventory export (example: <code>Products.csv</code>). Matches using <code>Model</code> and{' '}
            <code>Part Number</code>, then compares <code>Quantity on Hand</code>. Other columns stay untouched on
            export.
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
          {dtools ? <FileCountMeta file={dtools} source="dtools" /> : null}
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
              <span>iPoint rows compared</span>
              <b>{ipoint.comparedCount}</b>
            </div>
            <div className="xfer-stat">
              <span>D-Tools rows compared</span>
              <b>{dtools.comparedCount}</b>
            </div>
            <div className="xfer-stat">
              <span>Matched D-Tools rows</span>
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
              Duplicate identity values: {result.ipointDuplicates} iPoint item/part-number values and{' '}
              {result.dtoolsDuplicates} D-Tools model/part-number values appear on more than one row. Those stay
              visible. If several iPoint rows match one D-Tools row, stock available is summed.
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p className="xfer-empty">No lines in this view{query.trim() ? ' for that search' : ''}.</p>
          ) : (
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>iPoint part number</th>
                    <th>iPoint item</th>
                    <th>D-Tools part number</th>
                    <th>D-Tools model</th>
                    <th>Matched via</th>
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
                          {line.dtoolsPartNumber ? (
                            <code>{line.dtoolsPartNumber}</code>
                          ) : (
                            <span className="xfer-muted">—</span>
                          )}
                          {line.dtoolsBrand ? <div className="xfer-muted">{line.dtoolsBrand}</div> : null}
                        </td>
                        <td>{line.dtoolsModel || <span className="xfer-muted">—</span>}</td>
                        <td className="xfer-notes">{line.matchVia || '—'}</td>
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
