import { useEffect, useMemo, useState } from 'react'
import {
  applySimilarSelection,
  applyTreatedSimilar,
  applyUncombined,
  compareInventories,
  defaultChoices,
  lineIsDiscrepancy,
  type CompareLine,
  type QtyChoice,
} from './lib/compareInventory'
import { categoriesFromRecords } from './lib/categoryMatch'
import {
  canAddAsNew,
  countAdds,
  countOverrides,
  buildProductsExport,
  exportHighlightedProductsXlsx,
  exportUpdatedProductsCsv,
  previewAddCategory,
} from './lib/exportProducts'
import { parseInventoryFile, type ParsedWorkbook, type SourceKind } from './lib/parseInventoryFiles'
import { fetchPartsTrackerCategories } from './lib/partsCategories'
import './App.css'

type StatFilter = 'review' | 'diff' | 'grouped' | 'similar' | 'ipoint' | 'dtools' | 'matched' | 'overrides' | 'adds'
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
  if (line.groupSlices.length > 1 && !line.quantitiesCombined) return 'Not combined'
  if (line.isGrouped) return 'Added together'
  if (line.isSimilar) return 'Looks similar, not the same'
  if (line.match === 'ipoint-only') return 'Only in iPoint'
  if (line.match === 'dtools-only') return 'Only in D-Tools'
  return 'Match'
}

function lineIpointQty(line: CompareLine): number | null {
  return line.ipointQty ?? line.similarIpointQty
}

function lineIpointRaw(line: CompareLine): string {
  if (line.quantitiesCombined && line.isGrouped && line.ipointQty != null) return String(line.ipointQty)
  return line.ipointRaw || line.similarIpointRaw
}

function deltaText(line: CompareLine): string {
  const ipointQty = lineIpointQty(line)
  const dtoolsQty = line.dtoolsQty
  if (ipointQty == null || dtoolsQty == null) return '—'
  const d = ipointQty - dtoolsQty
  if (d === 0) return '0'
  return d > 0 ? `+${d}` : String(d)
}

function ipointLabel(line: CompareLine): string {
  return [line.ipointPartNumber, line.ipointItem].filter(Boolean).join(' · ') || '—'
}

function dtoolsLabel(line: CompareLine): string {
  return [line.dtoolsPartNumber, line.dtoolsModel].filter(Boolean).join(' · ') || '—'
}

function lineMatchesFilter(
  line: CompareLine,
  filter: StatFilter | null,
  choice: QtyChoice | undefined,
  addNew?: boolean,
): boolean {
  if (filter === 'review') return true
  if (filter === 'diff') return line.qtyDiffers
  if (filter === 'grouped') return line.groupSlices.length > 1
  if (filter === 'similar') return line.isSimilar && !line.treatedAsSame
  if (filter === 'ipoint') return line.match === 'ipoint-only'
  if (filter === 'dtools') return line.match === 'dtools-only'
  if (filter === 'matched') return line.match === 'both'
  if (filter === 'overrides') return choice === 'use-ipoint'
  if (filter === 'adds') return Boolean(addNew && canAddAsNew(line))
  return lineIsDiscrepancy(line)
}

async function fileFromSample(url: string, fallbackName: string): Promise<File> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  return new File([blob], fallbackName, { type: blob.type })
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadText(filename: string, text: string) {
  downloadBlob(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }))
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
  const [statFilter, setStatFilter] = useState<StatFilter | null>(null)
  const [query, setQuery] = useState('')
  const [choices, setChoices] = useState<Record<string, QtyChoice>>({})
  const [treatedSimilar, setTreatedSimilar] = useState<Record<string, boolean>>({})
  const [uncombined, setUncombined] = useState<Record<string, boolean>>({})
  const [addNew, setAddNew] = useState<Record<string, boolean>>({})
  const [similarPick, setSimilarPick] = useState<Record<string, string>>({})
  const [trackerCategories, setTrackerCategories] = useState<string[]>([])
  const [sortCol, setSortCol] = useState<SortCol | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    let cancelled = false
    void fetchPartsTrackerCategories()
      .then((cats) => {
        if (!cancelled) setTrackerCategories(cats)
      })
      .catch(() => {
        if (!cancelled) setTrackerCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      setUncombined({})
      setAddNew({})
      setSimilarPick({})
      setStatFilter(null)
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
      setUncombined({})
      setAddNew({})
      setSimilarPick({})
      setStatFilter(null)
      setSortCol(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load example files.')
    } finally {
      setBusy(null)
    }
  }

  const effectiveLines = useMemo(() => {
    if (!result) return []
    return applyUncombined(
      applyTreatedSimilar(applySimilarSelection(result.lines, similarPick), treatedSimilar),
      uncombined,
    )
  }, [result, similarPick, treatedSimilar, uncombined])

  const resolvedChoices = useMemo(() => {
    if (!effectiveLines.length) return {}
    return { ...defaultChoices(effectiveLines), ...choices }
  }, [choices, effectiveLines])

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    const filtered = effectiveLines.filter((line) => {
      if (!lineMatchesFilter(line, statFilter, resolvedChoices[line.id], addNew[line.id])) return false
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
  }, [addNew, effectiveLines, query, resolvedChoices, sortCol, sortDir, statFilter])

  const stats = useMemo(
    () => ({
      discrepancyCount: effectiveLines.filter(lineIsDiscrepancy).length,
      qtyDifferences: effectiveLines.filter((line) => line.qtyDiffers).length,
      groupedCount: effectiveLines.filter((line) => line.groupSlices.length > 1).length,
      similarCount: effectiveLines.filter((line) => line.isSimilar && !line.treatedAsSame).length,
      ipointOnly: effectiveLines.filter((line) => line.match === 'ipoint-only').length,
      dtoolsOnly: effectiveLines.filter((line) => line.match === 'dtools-only').length,
      matchedKeys: effectiveLines.filter((line) => line.match === 'both').length,
    }),
    [effectiveLines],
  )

  const overrideCount = countOverrides(resolvedChoices)
  const addCount = countAdds(effectiveLines, addNew)
  const catalogCategories = useMemo(() => {
    const fromFile = dtools
      ? categoriesFromRecords(
          dtools.originalRows.map((row) => row.record),
          dtools.headers,
        )
      : []
    return [...new Set([...trackerCategories, ...fromFile])]
  }, [dtools, trackerCategories])

  const builtExport = useMemo(() => {
    if (!dtools) return null
    return buildProductsExport(dtools, effectiveLines, resolvedChoices, addNew, catalogCategories)
  }, [addNew, catalogCategories, dtools, effectiveLines, resolvedChoices])

  const setChoice = (id: string, choice: QtyChoice) => {
    setChoices((prev) => ({ ...prev, [id]: choice }))
  }

  const toggleAddNew = (lineId: string, checked: boolean) => {
    setAddNew((prev) => {
      const next = { ...prev }
      if (checked) next[lineId] = true
      else delete next[lineId]
      return next
    })
  }

  const toggleStatFilter = (id: StatFilter) => {
    setStatFilter((prev) => (prev === id ? null : id))
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

  const setQuantitiesCombined = (lineId: string, combined: boolean) => {
    setUncombined((prev) => {
      const next = { ...prev }
      if (combined) delete next[lineId]
      else next[lineId] = true
      return next
    })
    if (!combined) setChoice(lineId, 'keep-dtools')
  }

  const toggleTreatAsSame = (line: CompareLine, checked: boolean) => {
    setTreatedSimilar((prev) => {
      const next = { ...prev }
      if (checked) next[line.id] = true
      else delete next[line.id]
      return next
    })
    if (checked) {
      setAddNew((prev) => {
        const next = { ...prev }
        delete next[line.id]
        return next
      })
    }
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
    if (!builtExport) return
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`Products-qty-from-ipoint-${stamp}.csv`, exportUpdatedProductsCsv(builtExport))
  }

  const exportXlsx = async () => {
    if (!builtExport) return
    setBusy('Building highlighted workbook…')
    setError(null)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const blob = await exportHighlightedProductsXlsx(builtExport)
      downloadBlob(`Products-highlighted-${stamp}.xlsx`, blob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the highlighted workbook.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="xfer-page">
      <header className="xfer-header">
        <div>
          <div className="xfer-title-row">
            <img
              className="xfer-logo"
              src={`${import.meta.env.BASE_URL}favicon.png`}
              alt="SHS"
            />
            <h1>Inventory Transfer</h1>
          </div>
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
            to equal the D-Tools quantity. That combined total is the only number that can be saved onto the matching
            Products.csv row. Choose <em>Don't combine quantities</em> if they should not be added — then the
            Products.csv row keeps its current D-Tools quantity.
          </li>
          <li>
            <strong>Blank quantities count as 0.</strong> Commas are stripped (<code>1,200</code> → 1200).{' '}
            <em>Different counts</em> means the iPoint stock is not the same number as D-Tools qty on hand.
          </li>
          <li>
            <strong>Close SKUs are not treated as the same part unless you say so.</strong> Related names like{' '}
            <code>ARC ULTRA</code> vs <code>ARC ULTRA WALL MOUNT</code> are labeled <em>Looks similar, not the same</em>
            because names share words like <code>ARC</code> and <code>WALL MOUNT</code>, or one name starts with the
            other. If several parts look similar, pick the right one from the Similar SKU menu. Checking{' '}
            <em>Treat as same part</em> applies only to that one row. <em>Add as new Products.csv row</em> adds the
            iPoint item as a new product.
          </li>
          <li>
            <strong>Override is optional and local.</strong> Checking <em>Use iPoint count</em> only changes{' '}
            <code>Quantity on Hand</code> on that same D-Tools row in the downloaded Products.csv. Checking{' '}
            <em>Add as new Products.csv row</em> appends a new product built from the iPoint file. Every original
            Products row stays, in the same order — original files are never modified.
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
            {(
              [
                ['review', 'Rows to review', stats.discrepancyCount, true],
                ['diff', 'Different counts', stats.qtyDifferences, true],
                ['grouped', 'Added together', stats.groupedCount, true],
                ['similar', 'Looks similar', stats.similarCount, true],
                ['ipoint', 'Only in iPoint', stats.ipointOnly, false],
                ['dtools', 'Only in D-Tools', stats.dtoolsOnly, false],
                ['matched', 'Same in both', stats.matchedKeys, false],
                ['overrides', 'Use iPoint count', overrideCount, false],
                ['adds', 'Add as new row', addCount, false],
              ] as const
            ).map(([id, label, value, alert]) => (
              <button
                key={id}
                type="button"
                className={`xfer-stat ${alert ? 'xfer-stat-alert' : ''} ${statFilter === id ? 'xfer-stat-on' : ''}`}
                aria-pressed={statFilter === id}
                onClick={() => toggleStatFilter(id)}
              >
                <span>{label}</span>
                <b>{value}</b>
              </button>
            ))}
          </div>

          <div className="xfer-toolbar">
            <span className="xfer-showing">
              Showing {visible.length.toLocaleString()} {visible.length === 1 ? 'row' : 'rows'}
            </span>
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
            <button type="button" className="xfer-btn" onClick={exportCsv} disabled={overrideCount === 0 && addCount === 0}>
              Download updated Products.csv
            </button>
            <button
              type="button"
              className="xfer-btn"
              onClick={() => void exportXlsx()}
              disabled={overrideCount === 0 && addCount === 0}
            >
              Download highlighted xlsx
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
            <p className="xfer-empty">{query.trim() ? 'Nothing matches that search.' : 'No rows in this view.'}</p>
          ) : (
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <colgroup>
                  <col className="xfer-col-problem" />
                  <col className="xfer-col-pn" />
                  <col className="xfer-col-item" />
                  <col className="xfer-col-pn" />
                  <col className="xfer-col-item" />
                  <col className="xfer-col-via" />
                  <col className="xfer-col-similar" />
                  <col className="xfer-col-qty" />
                  <col className="xfer-col-qty" />
                  <col className="xfer-col-diff" />
                  <col className="xfer-col-decision" />
                  <col className="xfer-col-notes" />
                </colgroup>
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
                    const ipointShown = lineIpointQty(line)
                    const delta =
                      ipointShown != null && line.dtoolsQty != null ? ipointShown - line.dtoolsQty : 0
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
                        <td className="xfer-problem">
                          {problemLabel(line)}
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
                        <td>{line.ipointItem || <span className="xfer-muted">—</span>}</td>
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
                          {line.similarCandidates.length > 1 ? (
                            <select
                              className="xfer-similar-select"
                              value={similarPick[line.id] || line.similarCandidates[0].id}
                              onChange={(e) =>
                                setSimilarPick((prev) => ({ ...prev, [line.id]: e.target.value }))
                              }
                              aria-label="Choose similar part"
                            >
                              {line.similarCandidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.optionLabel}
                                </option>
                              ))}
                            </select>
                          ) : line.similarTo ? (
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
                          {line.treatedAsSame ? (
                            <div className="xfer-muted">Now comparing these counts</div>
                          ) : null}
                        </td>
                        <td className="xfer-num">
                          {formatQty(ipointShown, lineIpointRaw(line))}
                          {line.groupSlices.length > 1 ? (
                            <div className="xfer-group">
                              <div className="xfer-choice-stack">
                                <label>
                                  <input
                                    type="radio"
                                    name={`combine-${line.id}`}
                                    checked={line.quantitiesCombined}
                                    onChange={() => setQuantitiesCombined(line.id, true)}
                                  />
                                  Combine quantities
                                </label>
                                <label>
                                  <input
                                    type="radio"
                                    name={`combine-${line.id}`}
                                    checked={!line.quantitiesCombined}
                                    onChange={() => setQuantitiesCombined(line.id, false)}
                                  />
                                  Don't combine quantities
                                </label>
                              </div>
                              <ul>
                                {line.groupSlices.map((slice) => (
                                  <li key={`${line.id}-s-${slice.sourceIndex}`}>
                                    <code>{slice.partNumber || slice.item || 'row'}</code>
                                    {slice.item && slice.partNumber ? ` · ${slice.item}` : ''}
                                    {': '}
                                    {slice.qtyRaw === '' ? 'blank→0' : slice.qtyRaw}
                                  </li>
                                ))}
                              </ul>
                              {line.quantitiesCombined ? (
                                <div className="xfer-group-total">{line.groupDetail}</div>
                              ) : (
                                <div className="xfer-muted">Not added together — Products.csv keeps the D-Tools qty</div>
                              )}
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
                          {line.match === 'both' && line.quantitiesCombined ? (
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
                          ) : line.match === 'both' ? (
                            <span className="xfer-muted">Combine quantities first to change this Products.csv row</span>
                          ) : canAddAsNew(line) ? (
                            <div className="xfer-choice-stack">
                              <label className="xfer-choice xfer-treat">
                                <input
                                  type="checkbox"
                                  checked={Boolean(addNew[line.id])}
                                  onChange={(e) => toggleAddNew(line.id, e.target.checked)}
                                />
                                Add iPoint item as new Products.csv row
                              </label>
                              {addNew[line.id] ? (
                                <div className="xfer-muted">
                                  Category: {previewAddCategory(line, catalogCategories) || '—'}
                                </div>
                              ) : null}
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
