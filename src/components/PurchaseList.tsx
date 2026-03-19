import { useCallback, useEffect, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { extractPdfLinesFromArrayBuffer } from '../lib/extractPdfLines'
import { parsePurchaseManagerLines } from '../lib/parsePurchaseManagerExport'
import { parseInventoryXlsxArrayBuffer } from '../lib/inventoryFromXlsx'
import { comparePurchaseToInventory } from '../lib/purchaseListMatch'
import type { InventoryRow, PurchaseListBatch, PurchaseListItemRow, PullSuggestion } from '../types/purchaseList'
import './PurchaseList.css'

function isConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.length > 0 && typeof key === 'string' && key.length > 0
}

const CHUNK = 250
type ParsedDebugRow = {
  source_file: string
  row_index: number
  vendor: string
  job: string
  part: string
  required: number
  received: string
  ordered: string
  cost: string
  context_line: string
  raw_line: string
}

async function insertInChunks<T extends Record<string, unknown>>(
  table: string,
  rows: T[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from(table).insert(slice as never)
    if (error) throw new Error(error.message)
  }
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function PurchaseList() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pdfFiles, setPdfFiles] = useState<FileList | null>(null)
  const [xlsxFile, setXlsxFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [batches, setBatches] = useState<PurchaseListBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string>('')
  const [batchItems, setBatchItems] = useState<PurchaseListItemRow[]>([])
  const [inventoryCount, setInventoryCount] = useState(0)
  const [suggestions, setSuggestions] = useState<PullSuggestion[]>([])
  const [parsedDebugRows, setParsedDebugRows] = useState<ParsedDebugRow[]>([])

  const loadBatches = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('purchase_list_batches')
      .select('id, source_filename, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (e) throw new Error(e.message)
    setBatches((data ?? []) as PurchaseListBatch[])
  }, [])

  const loadInventoryCount = useCallback(async () => {
    const { count, error: e } = await supabase
      .from('inventory')
      .select('*', { count: 'exact', head: true })
    if (e) throw new Error(e.message)
    setInventoryCount(count ?? 0)
  }, [])

  const loadBatchItems = useCallback(async (batchId: string) => {
    if (!batchId) {
      setBatchItems([])
      return
    }
    const { data, error: e } = await supabase
      .from('purchase_list_items')
      .select('batch_id, vendor, job, part, required, received, ordered, cost, context_line, raw_line')
      .eq('batch_id', batchId)
      .order('part', { ascending: true })
    if (e) throw new Error(e.message)
    setBatchItems((data ?? []) as PurchaseListItemRow[])
  }, [])

  const runCompare = useCallback(async () => {
    setError(null)
    if (!selectedBatchId) {
      setSuggestions([])
      return
    }
    try {
      const { data: inv, error: e } = await supabase
        .from('inventory')
        .select('part_number, item, stock_available')
      if (e) throw new Error(e.message)
      const invRows = (inv ?? []) as Pick<InventoryRow, 'part_number' | 'item' | 'stock_available'>[]
      const purchaseRows = batchItems.map((r) => ({
        part: r.part,
        required: r.required,
        job: r.job,
      }))
      setSuggestions(comparePurchaseToInventory(purchaseRows, invRows))
    } catch (err) {
      setSuggestions([])
      setError(err instanceof Error ? err.message : 'Compare failed')
    }
  }, [selectedBatchId, batchItems])

  useEffect(() => {
    if (!isConfigured()) return
    ;(async () => {
      try {
        await loadBatches()
        await loadInventoryCount()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
  }, [loadBatches, loadInventoryCount])

  useEffect(() => {
    if (!selectedBatchId) return
    ;(async () => {
      try {
        await loadBatchItems(selectedBatchId)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load batch items')
      }
    })()
  }, [selectedBatchId, loadBatchItems])

  useEffect(() => {
    void runCompare()
  }, [runCompare])

  const handleUploadPdfs = async () => {
    setError(null)
    setSuccess(null)
    if (!pdfFiles?.length) {
      setError('Choose one or more Purchase Manager PDF exports.')
      return
    }
    setBusy(true)
    try {
      const debugRows: ParsedDebugRow[] = []
      // Full refresh requested: clear old purchase list data before importing new PDF(s).
      // Delete child rows first to satisfy FK constraints.
      const { error: delItemsErr } = await supabase
        .from('purchase_list_items')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
      if (delItemsErr) throw new Error(delItemsErr.message)

      const { error: delBatchesErr } = await supabase
        .from('purchase_list_batches')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
      if (delBatchesErr) throw new Error(delBatchesErr.message)

      for (const file of Array.from(pdfFiles)) {
        const buf = await file.arrayBuffer()
        const lines = await extractPdfLinesFromArrayBuffer(buf)
        const parsed = parsePurchaseManagerLines(lines)
        parsed.forEach((p, idx) => {
          debugRows.push({
            source_file: file.name,
            row_index: idx + 1,
            vendor: p.vendor ?? '',
            job: p.job ?? '',
            part: p.part ?? '',
            required: p.required ?? 0,
            received: p.received == null ? '' : String(p.received),
            ordered: p.ordered == null ? '' : String(p.ordered),
            cost: p.cost ?? '',
            context_line: p.context_line ?? '',
            raw_line: p.raw_line ?? '',
          })
        })
        if (parsed.length === 0) {
          const preview = lines.slice(0, 8).join(' || ')
          throw new Error(
            `No purchase rows parsed from "${file.name}". Extracted ${lines.length} text rows. ` +
            `First rows: ${preview || '(none)'}`
          )
        }

        const { data: batchRow, error: be } = await supabase
          .from('purchase_list_batches')
          .insert({ source_filename: file.name })
          .select('id')
          .single()
        if (be || !batchRow) throw new Error(be?.message ?? 'Failed to create batch')

        const batchId = (batchRow as { id: string }).id
        const inserts: PurchaseListItemRow[] = parsed.map((p) => ({
          batch_id: batchId,
          vendor: p.vendor,
          job: p.job,
          part: p.part,
          required: p.required,
          received: p.received,
          ordered: p.ordered,
          cost: p.cost,
          context_line: p.context_line,
          raw_line: p.raw_line,
        }))
        await insertInChunks('purchase_list_items', inserts as unknown as Record<string, unknown>[])
      }

      setSuccess(`Imported ${pdfFiles.length} PDF file(s) into purchase list.`)
      setParsedDebugRows(debugRows)
      setPdfFiles(null)
      await loadBatches()
      const { data: latest } = await supabase
        .from('purchase_list_batches')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (latest) setSelectedBatchId((latest as { id: string }).id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF import failed')
    } finally {
      setBusy(false)
    }
  }

  const handleUploadInventory = async () => {
    setError(null)
    setSuccess(null)
    if (!xlsxFile) {
      setError('Choose an inventory .xlsx file.')
      return
    }
    setBusy(true)
    try {
      const buf = await xlsxFile.arrayBuffer()
      const rows = parseInventoryXlsxArrayBuffer(buf)
      if (rows.length === 0) {
        throw new Error('No rows found in the first sheet, or headers did not match expected columns.')
      }

      const { error: delErr } = await supabase.from('inventory').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (delErr) throw new Error(delErr.message)

      const now = new Date().toISOString()
      const withTs = rows.map((r) => ({
        ...r,
        uploaded_at: now,
      }))
      await insertInChunks('inventory', withTs as unknown as Record<string, unknown>[])

      setSuccess(`Replaced inventory with ${rows.length} row(s) from "${xlsxFile.name}".`)
      setXlsxFile(null)
      await loadInventoryCount()
      void runCompare()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Inventory import failed')
    } finally {
      setBusy(false)
    }
  }

  const downloadPurchaseCsv = () => {
    if (batchItems.length === 0) return
    const flat = batchItems.map((r) => ({
      vendor: r.vendor ?? '',
      job: r.job ?? '',
      part: r.part,
      required: r.required,
      received: r.received ?? '',
      ordered: r.ordered ?? '',
      cost: r.cost ?? '',
      context_line: r.context_line ?? '',
    }))
    const csv = Papa.unparse(flat, { header: true })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `purchase-list-${selectedBatchId.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const downloadParsedDebugCsv = () => {
    if (parsedDebugRows.length === 0) return
    const csv = Papa.unparse(parsedDebugRows, { header: true })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `purchase-parse-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!isConfigured()) {
    return (
      <div className="purchase-list-page">
        <header className="purchase-list-header">
          <h1>Purchase List</h1>
          <p className="purchase-list-subtitle">Purchase Manager PDF + inventory XLSX → Supabase</p>
        </header>
        <div className="purchase-list-setup">
          <p>
            Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then run{' '}
            <code>supabase/add-purchase-list-inventory.sql</code> in the SQL Editor.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="purchase-list-page">
      <header className="purchase-list-header">
        <h1>Purchase List</h1>
        <p className="purchase-list-subtitle">
          Upload Purchase Manager PDF exports and your inventory spreadsheet. We match each line’s{' '}
          <strong>Required</strong> to <strong>stock_available</strong> using the same text as your inventory{' '}
          <strong>part_number</strong> or <strong>item</strong> (normalized text match).
        </p>
      </header>

      {error && <div className="purchase-list-error">{error}</div>}
      {success && <div className="purchase-list-success">{success}</div>}

      <section className="purchase-list-section">
        <h2>1. Purchase Manager PDF</h2>
        <div className="purchase-list-row">
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => setPdfFiles(e.target.files)}
          />
          <div className="purchase-list-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void handleUploadPdfs()}>
              Parse &amp; save to Supabase
            </button>
            <button type="button" disabled={parsedDebugRows.length === 0} onClick={downloadParsedDebugCsv}>
              Download parsed debug CSV
            </button>
          </div>
        </div>
        <p className="purchase-list-meta">
          Each file creates one batch. Large multi-page PDFs are supported (parsed in the browser).
        </p>
      </section>

      <section className="purchase-list-section">
        <h2>2. Inventory (.xlsx)</h2>
        <div className="purchase-list-row">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setXlsxFile(e.target.files?.[0] ?? null)}
          />
          <div className="purchase-list-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void handleUploadInventory()}>
              Import columns → inventory table
            </button>
          </div>
        </div>
        <p className="purchase-list-meta">
          Replaces all rows in <code>inventory</code> ({inventoryCount} row(s) currently). Columns mapped: manufacturer,
          category, type, item, part_number, description_customer, unit, color, unit_hard_cost, unit_price, margin,
          markup, id_class, vendor_name, barcode, stock_total, stock_available, stock_on_order.
        </p>
      </section>

      <section className="purchase-list-section">
        <h2>3. Compare Required vs stock_available</h2>
        <div className="purchase-list-row">
          <label>
            Batch:&nbsp;
            <select
              className="purchase-list-select"
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
            >
              <option value="">Select a batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {(b.source_filename || 'PDF')} · {formatWhen(b.created_at)}
                </option>
              ))}
            </select>
          </label>
          <div className="purchase-list-actions">
            <button type="button" disabled={!selectedBatchId || batchItems.length === 0} onClick={downloadPurchaseCsv}>
              Download batch as CSV
            </button>
            <button type="button" disabled={busy} onClick={() => void runCompare()}>
              Refresh compare
            </button>
          </div>
        </div>

        <div className="purchase-list-table-wrap">
          <table className="purchase-list-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Part (from PDF)</th>
                <th>Required</th>
                <th>stock_available</th>
                <th>Can pull from stock</th>
                <th>Match (via)</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {selectedBatchId ? 'No rows or inventory empty — import an XLSX first.' : 'Select a batch.'}
                  </td>
                </tr>
              ) : (
                suggestions.map((s, i) => {
                  const full = s.stock_available != null && s.can_pull >= s.required
                  const partial = s.stock_available != null && s.can_pull > 0 && s.can_pull < s.required
                  return (
                    <tr key={`${s.part}-${i}`}>
                      <td>{s.job ?? '—'}</td>
                      <td>{s.part}</td>
                      <td>{s.required}</td>
                      <td>{s.stock_available ?? '—'}</td>
                      <td>{s.can_pull}</td>
                      <td>
                        {s.match_type === 'none' ? (
                          <span className="purchase-list-badge none">No match</span>
                        ) : partial ? (
                          <span className="purchase-list-badge partial">
                            Partial ({s.match_type === 'item' ? 'item' : 'part #'})
                          </span>
                        ) : full ? (
                          <span className="purchase-list-badge ok">
                            Full ({s.match_type === 'item' ? 'item' : 'part #'})
                          </span>
                        ) : (
                          <span className="purchase-list-badge none">Insufficient</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default PurchaseList
