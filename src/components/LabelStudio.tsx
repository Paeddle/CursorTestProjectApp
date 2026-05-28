import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { DYMO_PAPER_TEMPLATES, LABEL_HEIGHT_MM, LABEL_WIDTH_MM } from '../lib/dymoLabelXml'
import { getDymoDiagnostics } from '../lib/dymoLabelPrint'
import {
  fetchLabelStudioBarcodeItems,
  fetchLabelStudioInventoryItems,
  fetchLabelStudioLocationItems,
  fetchLabelStudioPoLineItems,
  filterLabelStudioItems,
} from '../lib/labelStudioItems'
import { printStudioLabels } from '../lib/labelStudioPrint'
import {
  mergedBarcodeForElement,
  previewTextForTemplate,
  resolveMergeTemplate,
  normalizeMergedText,
} from '../lib/labelStudioMerge'
import { parseLabelItemsXlsx } from '../lib/parseLabelItemsXlsx'
import {
  deleteLabelStudioTemplate,
  duplicateLabelStudioTemplate,
  loadLabelStudioTemplates,
  saveLabelStudioTemplate,
} from '../lib/labelStudioStorage'
import {
  createElementId,
  defaultInventoryTemplate,
  defaultShippingTemplate,
  isBarcodeElement,
  isTextElement,
  LABEL_STUDIO_MERGE_FIELDS,
  normalizeStudioTemplate,
  type LabelStudioBarcodeType,
  type LabelStudioElement,
  type LabelStudioItem,
  type LabelStudioItemSource,
  type LabelStudioTemplate,
} from '../types/labelStudio'
import './LabelStudio.css'

type DataSource = LabelStudioItemSource | 'excel'

const GUIDE_STORAGE_KEY = 'label-studio-guide-dismissed'

const SOURCE_OPTIONS: {
  id: DataSource
  label: string
  hint: string
}[] = [
  {
    id: 'inventory',
    label: 'Inventory',
    hint: 'Items from your inventory upload (Purchase List page). Good for part labels with barcodes.',
  },
  {
    id: 'barcode',
    label: 'Barcode catalog',
    hint: 'Saved barcode lookups (manufacturer, part number, UPC).',
  },
  {
    id: 'location',
    label: 'Room locations',
    hint: 'iPoint location sheets — room name + product per row.',
  },
  {
    id: 'po_line',
    label: 'PO lines',
    hint: 'Open purchase order lines (PO number + item name).',
  },
]

function elementSummary(el: LabelStudioElement): string {
  const short = el.content.replace(/\{\{|\}\}/g, '').trim() || '(empty)'
  if (isBarcodeElement(el)) return `Barcode: ${short}`
  const preview = el.content.length > 28 ? `${el.content.slice(0, 28)}…` : el.content
  return `Text: ${preview}`
}

export default function LabelStudio() {
  const [templates, setTemplates] = useState<LabelStudioTemplate[]>(() => loadLabelStudioTemplates())
  const [template, setTemplate] = useState<LabelStudioTemplate>(() => loadLabelStudioTemplates()[0])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<DataSource>('inventory')
  const [items, setItems] = useState<LabelStudioItem[]>([])
  const [excelItems, setExcelItems] = useState<LabelStudioItem[]>([])
  const [search, setSearch] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [previewItemId, setPreviewItemId] = useState<string | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [printing, setPrinting] = useState(false)
  const [dymoSummary, setDymoSummary] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(
    () => localStorage.getItem(GUIDE_STORAGE_KEY) !== '1'
  )
  const dragRef = useRef<{
    elementId: string
    startX: number
    startY: number
    origXPct: number
    origYPct: number
  } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const activeItems = dataSource === 'excel' ? excelItems : items
  const filteredItems = useMemo(
    () => filterLabelStudioItems(activeItems, search),
    [activeItems, search]
  )

  const previewItem = useMemo(() => {
    const id = previewItemId ?? [...selectedItemIds][0] ?? filteredItems[0]?.id
    return filteredItems.find((i) => i.id === id) ?? null
  }, [filteredItems, previewItemId, selectedItemIds])

  const selectedElement = template.elements.find((e) => e.id === selectedElementId) ?? null
  const selectedItems = filteredItems.filter((i) => selectedItemIds.has(i.id))
  const paperName =
    DYMO_PAPER_TEMPLATES.find((p) => p.id === template.paperTemplateId)?.paperName ?? '30323 Shipping'

  const loadItemsForSource = useCallback(async (source: DataSource) => {
    if (source === 'excel') return
    setLoadingItems(true)
    setItemsError(null)
    try {
      let loaded: LabelStudioItem[] = []
      if (source === 'inventory') loaded = await fetchLabelStudioInventoryItems()
      else if (source === 'location') loaded = await fetchLabelStudioLocationItems()
      else if (source === 'barcode') loaded = await fetchLabelStudioBarcodeItems()
      else if (source === 'po_line') loaded = await fetchLabelStudioPoLineItems()
      setItems(loaded)
      if (loaded.length === 0) {
        setItemsError(`No rows found. Upload data on the relevant page first (e.g. Purchase List for inventory).`)
      }
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : 'Failed to load items')
      setItems([])
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => {
    if (dataSource !== 'excel') void loadItemsForSource(dataSource)
  }, [dataSource, loadItemsForSource])

  useEffect(() => {
    void getDymoDiagnostics().then((d) => setDymoSummary(d.summary))
  }, [])

  const dismissGuide = () => {
    setShowGuide(false)
    localStorage.setItem(GUIDE_STORAGE_KEY, '1')
  }

  const updateTemplate = (patch: Partial<LabelStudioTemplate>) => {
    setTemplate((t) => ({ ...t, ...patch }))
  }

  const updateElement = (id: string, patch: Record<string, unknown>) => {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as LabelStudioElement) : el
      ),
    }))
  }

  const applyPreset = (preset: 'inventory' | 'shipping') => {
    const next = preset === 'inventory' ? defaultInventoryTemplate() : defaultShippingTemplate()
    setTemplate(next)
    setSelectedElementId(next.elements[0]?.id ?? null)
    setStatus({
      kind: 'ok',
      text:
        preset === 'inventory'
          ? 'Loaded “item + barcode” layout. Select inventory items on the left, then print.'
          : 'Loaded “job + location” layout. Select location or PO items on the left, then print.',
    })
  }

  const addTextElement = () => {
    const el: LabelStudioElement = {
      kind: 'text',
      id: createElementId(),
      name: `TEXT${template.elements.length + 1}`,
      content: '{{item}}',
      xPct: 10,
      yPct: 10,
      widthPct: 80,
      heightPct: 25,
      fontSize: 18,
      bold: true,
      align: 'Center',
    }
    setTemplate((t) => ({ ...t, elements: [...t.elements, el] }))
    setSelectedElementId(el.id)
  }

  const addBarcodeElement = () => {
    const el: LabelStudioElement = {
      kind: 'barcode',
      id: createElementId(),
      name: `BARCODE${template.elements.length + 1}`,
      content: '{{barcode}}',
      xPct: 10,
      yPct: 55,
      widthPct: 80,
      heightPct: 38,
      barcodeType: 'Auto',
      size: 'Medium',
      textPosition: 'Bottom',
    }
    setTemplate((t) => ({ ...t, elements: [...t.elements, el] }))
    setSelectedElementId(el.id)
  }

  const deleteSelectedElement = () => {
    if (!selectedElementId) return
    setTemplate((t) => ({
      ...t,
      elements: t.elements.filter((e) => e.id !== selectedElementId),
    }))
    setSelectedElementId(null)
  }

  const handleSaveTemplate = () => {
    const toSave = { ...template, updatedAt: new Date().toISOString() }
    saveLabelStudioTemplate(toSave)
    setTemplates(loadLabelStudioTemplates())
    setStatus({ kind: 'ok', text: `Saved “${toSave.name}” on this browser.` })
  }

  const handleNewTemplate = () => {
    const t: LabelStudioTemplate = {
      ...defaultShippingTemplate(),
      id: `tpl-${Date.now().toString(36)}`,
      name: 'My template',
    }
    setTemplate(t)
    setSelectedElementId(t.elements[0]?.id ?? null)
  }

  const handleDuplicateTemplate = () => {
    const copy = duplicateLabelStudioTemplate(template)
    setTemplate(copy)
    saveLabelStudioTemplate(copy)
    setTemplates(loadLabelStudioTemplates())
    setStatus({ kind: 'ok', text: `Created copy: “${copy.name}”.` })
  }

  const handleDeleteTemplate = () => {
    if (!window.confirm(`Delete saved template “${template.name}”?`)) return
    deleteLabelStudioTemplate(template.id)
    const next = loadLabelStudioTemplates()
    setTemplates(next)
    setTemplate(next[0] ?? defaultShippingTemplate())
  }

  const toggleItemSelection = (id: string, multi: boolean) => {
    setSelectedItemIds((prev) => {
      const next = new Set(multi ? prev : [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setPreviewItemId(id)
  }

  const selectAllVisible = () => {
    setSelectedItemIds(new Set(filteredItems.map((i) => i.id)))
  }

  const clearSelection = () => setSelectedItemIds(new Set())

  const handlePrint = async () => {
    const toPrint =
      selectedItems.length > 0 ? selectedItems : previewItem ? [previewItem] : []
    if (toPrint.length === 0) {
      setStatus({
        kind: 'err',
        text: 'Check one or more items in the list on the left (or click a single row to preview).',
      })
      return
    }
    setPrinting(true)
    setStatus({ kind: 'info', text: `Sending ${toPrint.length} label(s) to the printer…` })
    try {
      const result = await printStudioLabels(template, toPrint)
      setStatus({
        kind: 'ok',
        text: `Printed ${result.printed} label${result.printed !== 1 ? 's' : ''}.`,
      })
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Print failed' })
    } finally {
      setPrinting(false)
    }
  }

  const handleExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseLabelItemsXlsx(buf)
      if (parsed.length === 0) throw new Error('No rows found in the spreadsheet.')
      setExcelItems(parsed)
      setDataSource('excel')
      setStatus({
        kind: 'ok',
        text: `Loaded ${parsed.length} rows from Excel. Column headers become fields like {{item}}, {{barcode}}, etc.`,
      })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Excel import failed' })
    }
  }

  const onCanvasPointerDown = (el: LabelStudioElement, ev: React.PointerEvent) => {
    ev.preventDefault()
    setSelectedElementId(el.id)
    dragRef.current = {
      elementId: el.id,
      startX: ev.clientX,
      startY: ev.clientY,
      origXPct: el.xPct,
      origYPct: el.yPct,
    }
    ;(ev.target as HTMLElement).setPointerCapture(ev.pointerId)
  }

  const onCanvasPointerMove = (ev: React.PointerEvent) => {
    const drag = dragRef.current
    const canvas = canvasRef.current
    if (!drag || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100
    const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100
    updateElement(drag.elementId, {
      xPct: Math.max(0, Math.min(100 - 5, drag.origXPct + dxPct)),
      yPct: Math.max(0, Math.min(100 - 5, drag.origYPct + dyPct)),
    })
  }

  const onCanvasPointerUp = () => {
    dragRef.current = null
  }

  const canvasPreviewText = (el: LabelStudioElement): string => {
    if (!previewItem) return el.content.replace(/\{\{[^}]+\}\}/g, '…')
    if (isBarcodeElement(el)) {
      return mergedBarcodeForElement(el.content, previewItem) || '(no value)'
    }
    return normalizeMergedText(resolveMergeTemplate(el.content, previewItem.fields))
  }

  const currentSourceHint =
    dataSource === 'excel'
      ? 'Using your uploaded spreadsheet — each column is a merge field.'
      : SOURCE_OPTIONS.find((s) => s.id === dataSource)?.hint ?? ''

  return (
    <div className="label-studio">
      <header className="ls-header">
        <div>
          <h1>Label Studio</h1>
          <p className="ls-header-sub">
            Print stickers on your DYMO LabelWriter ({LABEL_WIDTH_MM}×{LABEL_HEIGHT_MM} mm). Use this
            computer with DYMO Connect running.
          </p>
        </div>
        {dymoSummary && (
          <div className="ls-printer-pill" title="Printer status from DYMO Connect">
            {dymoSummary}
          </div>
        )}
      </header>

      {showGuide && (
        <section className="ls-guide" aria-label="How to use Label Studio">
          <div className="ls-guide-head">
            <strong>How it works (3 steps)</strong>
            <button type="button" className="ls-guide-dismiss" onClick={dismissGuide}>
              Hide guide
            </button>
          </div>
          <ol className="ls-guide-steps">
            <li>
              <span className="ls-step-num">1</span>
              <span>
                <strong>Pick a layout</strong> — use a quick-start card below, or adjust the label preview
                in the middle.
              </span>
            </li>
            <li>
              <span className="ls-step-num">2</span>
              <span>
                <strong>Choose what to print</strong> — check items in the list on the left (inventory,
                barcodes, locations, or upload Excel like Label Live).
              </span>
            </li>
            <li>
              <span className="ls-step-num">3</span>
              <span>
                <strong>Print</strong> — click the blue Print button. Each checked row prints one label with
                its data filled in.
              </span>
            </li>
          </ol>
          <p className="ls-guide-foot">
            Placeholders like <code>{'{{item}}'}</code> and <code>{'{{barcode}}'}</code> are replaced with real
            values from the row you selected. Click any box on the label preview to edit it.
          </p>
        </section>
      )}

      <section className="ls-quick-start" aria-label="Quick start layouts">
        <h2 className="ls-section-title">Quick start</h2>
        <div className="ls-preset-cards">
          <button type="button" className="ls-preset-card" onClick={() => applyPreset('inventory')}>
            <span className="ls-preset-icon" aria-hidden>
              ▐▌
            </span>
            <span className="ls-preset-name">Item + barcode</span>
            <span className="ls-preset-desc">Product name, part #, scannable UPC/Code128 barcode</span>
          </button>
          <button type="button" className="ls-preset-card" onClick={() => applyPreset('shipping')}>
            <span className="ls-preset-icon" aria-hidden>
              Aa
            </span>
            <span className="ls-preset-name">Job + location</span>
            <span className="ls-preset-desc">Customer/job name on top, room or location below (PO stickers)</span>
          </button>
        </div>
      </section>

      {status && (
        <div className={`label-studio-status ${status.kind}`} role="status">
          {status.text}
        </div>
      )}

      <div className="ls-print-bar">
        <div className="ls-print-bar-summary">
          <strong>
            {selectedItemIds.size > 0
              ? `${selectedItemIds.size} item${selectedItemIds.size !== 1 ? 's' : ''} ready to print`
              : previewItem
                ? '1 item (preview only — check the box to print)'
                : 'No items selected'}
          </strong>
          <span className="ls-print-bar-meta">
            Template: {template.name} · Roll: {paperName}
          </span>
        </div>
        <button
          type="button"
          className="ls-btn ls-btn-primary ls-btn-print"
          onClick={() => void handlePrint()}
          disabled={printing}
        >
          {printing ? 'Printing…' : 'Print labels'}
        </button>
      </div>

      <div className="label-studio-grid">
        <aside className="label-studio-panel ls-panel-items">
          <div className="ls-panel-head">
            <span className="ls-step-badge">Step 2</span>
            <h2>Choose items to print</h2>
          </div>

          <label className="ls-field">
            <span className="ls-field-label">Data source</span>
            <select
              className="ls-select"
              value={dataSource === 'excel' ? 'excel' : dataSource}
              onChange={(e) => {
                const v = e.target.value as DataSource
                setDataSource(v)
              }}
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              {excelItems.length > 0 && <option value="excel">Excel upload ({excelItems.length} rows)</option>}
            </select>
            <span className="ls-field-hint">{currentSourceHint}</span>
          </label>

          {dataSource !== 'excel' && (
            <button
              type="button"
              className="ls-btn ls-btn-secondary ls-btn-block"
              onClick={() => void loadItemsForSource(dataSource)}
              disabled={loadingItems}
            >
              {loadingItems ? 'Loading…' : 'Reload list'}
            </button>
          )}

          <div className="ls-excel-upload">
            <span className="ls-field-label">Or import from Excel</span>
            <p className="ls-field-hint">Same idea as Label Live — first row = column names.</p>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => void handleExcelUpload(e)} />
          </div>

          <input
            className="label-studio-search"
            type="search"
            placeholder="Search by name, part, barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="ls-item-actions">
            <button type="button" className="ls-btn ls-btn-secondary" onClick={selectAllVisible}>
              Select all shown
            </button>
            <button type="button" className="ls-btn ls-btn-secondary" onClick={clearSelection}>
              Clear
            </button>
          </div>

          {itemsError && <p className="ls-error">{itemsError}</p>}

          <div className="label-studio-item-list" role="listbox" aria-label="Items to print">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                role="option"
                aria-selected={selectedItemIds.has(item.id)}
                className={`label-studio-item-row${selectedItemIds.has(item.id) ? ' selected' : ''}`}
                onClick={(ev) => toggleItemSelection(item.id, ev.ctrlKey || ev.metaKey)}
              >
                <input
                  type="checkbox"
                  checked={selectedItemIds.has(item.id)}
                  onChange={() => toggleItemSelection(item.id, false)}
                  onClick={(ev) => ev.stopPropagation()}
                  aria-label={`Print ${item.title}`}
                />
                <span>{item.title}</span>
              </div>
            ))}
            {!loadingItems && filteredItems.length === 0 && (
              <p className="ls-empty">No items match your search.</p>
            )}
          </div>
        </aside>

        <section className="label-studio-panel label-studio-canvas-wrap">
          <div className="ls-panel-head">
            <span className="ls-step-badge">Step 1</span>
            <h2>Label layout</h2>
          </div>

          <details className="ls-template-details">
            <summary>Template settings (name, roll size, save)</summary>
            <div className="ls-template-form">
              <label className="ls-field">
                <span className="ls-field-label">Saved template</span>
                <select
                  className="ls-select"
                  value={template.id}
                  onChange={(e) => {
                    const t = templates.find((x) => x.id === e.target.value)
                    if (t) {
                      const normalized = normalizeStudioTemplate(t)
                      setTemplate(normalized)
                      setSelectedElementId(normalized.elements[0]?.id ?? null)
                    }
                  }}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ls-field">
                <span className="ls-field-label">Template name</span>
                <input
                  className="ls-input"
                  type="text"
                  value={template.name}
                  onChange={(e) => updateTemplate({ name: e.target.value })}
                />
              </label>
              <label className="ls-field">
                <span className="ls-field-label">Label roll in printer</span>
                <select
                  className="ls-select"
                  value={template.paperTemplateId}
                  onChange={(e) => updateTemplate({ paperTemplateId: e.target.value })}
                >
                  {DYMO_PAPER_TEMPLATES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.paperName}
                    </option>
                  ))}
                </select>
                <span className="ls-field-hint">Must match the roll loaded in DYMO Connect (usually 30323).</span>
              </label>
              <div className="ls-btn-row">
                <button type="button" className="ls-btn ls-btn-secondary" onClick={handleSaveTemplate}>
                  Save template
                </button>
                <button type="button" className="ls-btn ls-btn-secondary" onClick={handleNewTemplate}>
                  New blank
                </button>
                <button type="button" className="ls-btn ls-btn-secondary" onClick={handleDuplicateTemplate}>
                  Duplicate
                </button>
                <button type="button" className="ls-btn ls-btn-danger" onClick={handleDeleteTemplate}>
                  Delete
                </button>
              </div>
            </div>
          </details>

          <div className="ls-design-tools">
            <span className="ls-field-label">Add to label</span>
            <div className="ls-btn-row">
              <button type="button" className="ls-btn ls-btn-secondary" onClick={addTextElement}>
                + Text line
              </button>
              <button type="button" className="ls-btn ls-btn-secondary" onClick={addBarcodeElement}>
                + Barcode
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={deleteSelectedElement}
                disabled={!selectedElementId}
              >
                Remove selected
              </button>
            </div>
          </div>

          {template.elements.length > 0 && (
            <div className="ls-element-picker" role="tablist" aria-label="Fields on this label">
              {template.elements.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedElementId === el.id}
                  className={`ls-element-chip${selectedElementId === el.id ? ' active' : ''}${isBarcodeElement(el) ? ' barcode' : ''}`}
                  onClick={() => setSelectedElementId(el.id)}
                >
                  {isBarcodeElement(el) ? '▐▌ ' : 'Aa '}
                  {elementSummary(el)}
                </button>
              ))}
            </div>
          )}

          <div
            ref={canvasRef}
            className="label-studio-canvas"
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
          >
            {template.elements.length === 0 && (
              <p className="ls-canvas-empty">Pick a quick-start layout above, or add text / barcode.</p>
            )}
            {template.elements.map((el) => {
              const isBarcode = isBarcodeElement(el)
              const preview = canvasPreviewText(el) || '(empty)'
              return (
                <div
                  key={el.id}
                  className={`label-studio-canvas-element${selectedElementId === el.id ? ' active' : ''}${isBarcode ? ' label-studio-canvas-barcode' : ''}`}
                  style={{
                    left: `${el.xPct}%`,
                    top: `${el.yPct}%`,
                    width: `${el.widthPct}%`,
                    height: `${el.heightPct}%`,
                    ...(isTextElement(el)
                      ? {
                          fontSize: `${Math.max(8, el.fontSize * 0.45)}px`,
                          fontWeight: el.bold ? 700 : 400,
                          textAlign: el.align.toLowerCase() as 'left' | 'center' | 'right',
                        }
                      : {}),
                  }}
                  onPointerDown={(ev) => onCanvasPointerDown(el, ev)}
                >
                  {isBarcode ? (
                    <>
                      <div className="label-studio-barcode-bars" aria-hidden />
                      <span className="label-studio-barcode-caption">{preview}</span>
                    </>
                  ) : (
                    preview
                  )}
                </div>
              )
            })}
          </div>

          <p className="ls-canvas-hint">Drag any box to move it. What you see is a preview — the printer uses your roll size.</p>

          {previewItem && (
            <div className="ls-live-preview">
              <span className="ls-field-label">Sample with “{previewItem.title}”</span>
              <p>{previewTextForTemplate(template.elements, previewItem)}</p>
            </div>
          )}
        </section>

        <aside className="label-studio-panel label-studio-props">
          <div className="ls-panel-head">
            <h2>Edit selected field</h2>
          </div>

          {selectedElement ? (
            <>
              <p className="ls-field-type">
                {isBarcodeElement(selectedElement) ? 'Scannable barcode' : 'Text'}
                {selectedElement.name ? ` · ${selectedElement.name}` : ''}
              </p>

              <label className="ls-field">
                <span className="ls-field-label">What to print</span>
                <textarea
                  className="ls-textarea"
                  value={selectedElement.content}
                  onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                  placeholder="{{item}} or {{barcode}}"
                />
                <span className="ls-field-hint">
                  Type text and/or insert data fields below. Each {'{{name}}'} is filled from the item you
                  selected.
                </span>
              </label>

              <div className="ls-merge-section">
                <span className="ls-field-label">Insert data field</span>
                <div className="label-studio-merge-chips">
                  {LABEL_STUDIO_MERGE_FIELDS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className="ls-merge-chip"
                      title={`Example: ${f.example}`}
                      onClick={() =>
                        updateElement(selectedElement.id, {
                          content: `${selectedElement.content}{{${f.key}}}`,
                        })
                      }
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {isBarcodeElement(selectedElement) ? (
                <div className="ls-prop-group">
                  <h3 className="ls-prop-group-title">Barcode options</h3>
                  <label className="ls-field">
                    <span className="ls-field-label">Barcode format</span>
                    <select
                      className="ls-select"
                      value={selectedElement.barcodeType}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          barcodeType: e.target.value as LabelStudioBarcodeType,
                        })
                      }
                    >
                      <option value="Auto">Auto-detect (recommended)</option>
                      <option value="Code128Auto">Code 128 (most part numbers)</option>
                      <option value="UpcA">UPC-A (12-digit retail)</option>
                      <option value="Ean13">EAN-13 (13-digit retail)</option>
                      <option value="Code39">Code 39</option>
                      <option value="QrCode">QR code</option>
                    </select>
                  </label>
                  <label className="ls-field">
                    <span className="ls-field-label">Barcode height</span>
                    <select
                      className="ls-select"
                      value={selectedElement.size}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          size: e.target.value as typeof selectedElement.size,
                        })
                      }
                    >
                      <option value="Small">Small</option>
                      <option value="Medium">Medium</option>
                      <option value="Large">Large</option>
                      <option value="ExtraLarge">Extra large</option>
                    </select>
                  </label>
                  <label className="ls-field">
                    <span className="ls-field-label">Show numbers under barcode?</span>
                    <select
                      className="ls-select"
                      value={selectedElement.textPosition}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          textPosition: e.target.value as typeof selectedElement.textPosition,
                        })
                      }
                    >
                      <option value="Bottom">Yes, below</option>
                      <option value="Top">Yes, above</option>
                      <option value="None">No, barcode only</option>
                    </select>
                  </label>
                </div>
              ) : isTextElement(selectedElement) ? (
                <div className="ls-prop-group">
                  <h3 className="ls-prop-group-title">Text style</h3>
                  <label className="ls-field">
                    <span className="ls-field-label">Font size</span>
                    <input
                      className="ls-input"
                      type="number"
                      min={8}
                      max={36}
                      value={selectedElement.fontSize}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          fontSize: Number(e.target.value) || 14,
                        })
                      }
                    />
                  </label>
                  <label className="ls-field">
                    <span className="ls-field-label">Alignment</span>
                    <select
                      className="ls-select"
                      value={selectedElement.align}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          align: e.target.value as typeof selectedElement.align,
                        })
                      }
                    >
                      <option value="Left">Left</option>
                      <option value="Center">Center</option>
                      <option value="Right">Right</option>
                    </select>
                  </label>
                  <label className="ls-field ls-field-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedElement.bold}
                      onChange={(e) => updateElement(selectedElement.id, { bold: e.target.checked })}
                    />
                    Bold text
                  </label>
                </div>
              ) : null}

              <details className="ls-advanced">
                <summary>Fine-tune position &amp; size</summary>
                <p className="ls-field-hint">Usually you can just drag on the preview. Use these if you need exact control.</p>
                <label className="ls-field">
                  <span className="ls-field-label">Width on label (%)</span>
                  <input
                    className="ls-input"
                    type="number"
                    min={10}
                    max={100}
                    value={Math.round(selectedElement.widthPct)}
                    onChange={(e) =>
                      updateElement(selectedElement.id, {
                        widthPct: Number(e.target.value) || 80,
                      })
                    }
                  />
                </label>
                <label className="ls-field">
                  <span className="ls-field-label">Height on label (%)</span>
                  <input
                    className="ls-input"
                    type="number"
                    min={10}
                    max={100}
                    value={Math.round(selectedElement.heightPct)}
                    onChange={(e) =>
                      updateElement(selectedElement.id, {
                        heightPct: Number(e.target.value) || 25,
                      })
                    }
                  />
                </label>
                <label className="ls-field">
                  <span className="ls-field-label">Internal name (optional)</span>
                  <input
                    className="ls-input"
                    value={selectedElement.name}
                    onChange={(e) => updateElement(selectedElement.id, { name: e.target.value })}
                  />
                  <span className="ls-field-hint">Only needed for advanced DYMO templates; safe to ignore.</span>
                </label>
              </details>
            </>
          ) : (
            <div className="ls-props-empty">
              <p>Click a box on the label preview, or pick a field from the chips above the preview.</p>
              <p className="ls-field-hint">
                Not sure where to start? Use <strong>Item + barcode</strong> quick start, load inventory on the
                left, check a few rows, and hit Print.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
