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

const SOURCE_LABELS: Record<DataSource, string> = {
  inventory: 'Inventory',
  location: 'Locations',
  barcode: 'Barcodes',
  po_line: 'PO lines',
  excel: 'Excel upload',
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
        setItemsError(`No ${SOURCE_LABELS[source].toLowerCase()} in the database yet.`)
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
    setStatus({ kind: 'ok', text: `Saved template “${toSave.name}”.` })
  }

  const handleNewTemplate = () => {
    const t: LabelStudioTemplate = {
      ...defaultShippingTemplate(),
      id: `tpl-${Date.now().toString(36)}`,
      name: 'New template',
    }
    setTemplate(t)
    setSelectedElementId(t.elements[0]?.id ?? null)
  }

  const handleDuplicateTemplate = () => {
    const copy = duplicateLabelStudioTemplate(template)
    setTemplate(copy)
    saveLabelStudioTemplate(copy)
    setTemplates(loadLabelStudioTemplates())
  }

  const handleDeleteTemplate = () => {
    if (!window.confirm(`Delete template “${template.name}”?`)) return
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

  const selectedItems = filteredItems.filter((i) => selectedItemIds.has(i.id))

  const handlePrint = async () => {
    const toPrint =
      selectedItems.length > 0 ? selectedItems : previewItem ? [previewItem] : []
    if (toPrint.length === 0) {
      setStatus({ kind: 'err', text: 'Select at least one item (or pick one to preview).' })
      return
    }
    setPrinting(true)
    setStatus({ kind: 'info', text: `Printing ${toPrint.length} label(s)…` })
    try {
      const result = await printStudioLabels(template, toPrint)
      setStatus({
        kind: 'ok',
        text: `Printed ${result.printed} label${result.printed !== 1 ? 's' : ''} via ${result.method}.`,
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
      setStatus({ kind: 'ok', text: `Loaded ${parsed.length} items from ${file.name}.` })
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
      return mergedBarcodeForElement(el.content, previewItem) || '(no barcode value)'
    }
    return normalizeMergedText(resolveMergeTemplate(el.content, previewItem.fields))
  }

  return (
    <div className="label-studio">
      <header className="label-studio-header">
        <h1>Label Studio</h1>
        <p>
          Design DYMO labels like Label Live / DYMO Connect, pull item data from your database, and print to your
          LabelWriter 450 Twin Turbo ({LABEL_WIDTH_MM}×{LABEL_HEIGHT_MM} mm). {dymoSummary && <em>{dymoSummary}</em>}
        </p>
      </header>

      <div className="label-studio-toolbar">
        <select
          value={template.id}
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value)
            if (t) {
              const normalized = normalizeStudioTemplate(t)
              setTemplate(normalized)
              setSelectedElementId(normalized.elements[0]?.id ?? null)
            }
          }}
          aria-label="Saved template"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={template.name}
          onChange={(e) => updateTemplate({ name: e.target.value })}
          aria-label="Template name"
          style={{ minWidth: 160 }}
        />
        <select
          value={template.paperTemplateId}
          onChange={(e) => updateTemplate({ paperTemplateId: e.target.value })}
          aria-label="Label roll size"
        >
          {DYMO_PAPER_TEMPLATES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.paperName}
            </option>
          ))}
        </select>
        <button type="button" onClick={addTextElement}>
          + Text
        </button>
        <button type="button" onClick={addBarcodeElement}>
          + Barcode
        </button>
        <button type="button" onClick={deleteSelectedElement} disabled={!selectedElementId}>
          Delete field
        </button>
        <button type="button" onClick={handleSaveTemplate}>
          Save template
        </button>
        <button type="button" onClick={handleNewTemplate}>
          New
        </button>
        <button type="button" onClick={handleDuplicateTemplate}>
          Duplicate
        </button>
        <button type="button" onClick={handleDeleteTemplate}>
          Delete template
        </button>
        <button
          type="button"
          onClick={() => {
            setTemplate(defaultShippingTemplate())
            setSelectedElementId(null)
          }}
        >
          Preset: Job+loc
        </button>
        <button
          type="button"
          onClick={() => {
            setTemplate(defaultInventoryTemplate())
            setSelectedElementId(null)
          }}
        >
          Preset: Item+barcode
        </button>
        <button type="button" className="primary" onClick={() => void handlePrint()} disabled={printing}>
          {printing ? 'Printing…' : 'Print selected'}
        </button>
      </div>

      {status && (
        <div className={`label-studio-status ${status.kind}`} role="status">
          {status.text}
        </div>
      )}

      <div className="label-studio-grid">
        <aside className="label-studio-panel">
          <h2>Items</h2>
          <div className="label-studio-source-tabs" role="tablist">
            {(Object.keys(SOURCE_LABELS) as DataSource[]).map((src) => (
              <button
                key={src}
                type="button"
                role="tab"
                aria-selected={dataSource === src}
                className={dataSource === src ? 'active' : ''}
                onClick={() => setDataSource(src)}
              >
                {SOURCE_LABELS[src]}
              </button>
            ))}
          </div>
          {dataSource !== 'excel' && (
            <button type="button" onClick={() => void loadItemsForSource(dataSource)} disabled={loadingItems}>
              {loadingItems ? 'Loading…' : 'Refresh'}
            </button>
          )}
          <div className="label-studio-excel-row">
            <label>
              Excel item list (Label Live–style)
              <input type="file" accept=".xlsx,.xls" onChange={(e) => void handleExcelUpload(e)} />
            </label>
          </div>
          <input
            className="label-studio-search"
            type="search"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={selectAllVisible}>
              Select all
            </button>
            <button type="button" onClick={clearSelection}>
              Clear
            </button>
            <span style={{ fontSize: '0.85rem', alignSelf: 'center' }}>
              {selectedItemIds.size} selected
            </span>
          </div>
          {itemsError && <p style={{ color: '#b71c1c', fontSize: '0.85rem' }}>{itemsError}</p>}
          <div className="label-studio-item-list" role="listbox" aria-label="Items">
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
                />
                <span>{item.title}</span>
              </div>
            ))}
            {!loadingItems && filteredItems.length === 0 && (
              <p style={{ padding: '0.5rem', fontSize: '0.85rem', color: '#666' }}>No items match.</p>
            )}
          </div>
        </aside>

        <section className="label-studio-panel label-studio-canvas-wrap">
          <h2>Design</h2>
          <div
            ref={canvasRef}
            className="label-studio-canvas"
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
          >
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
          <p style={{ fontSize: '0.85rem', color: '#555', maxWidth: 420, textAlign: 'center' }}>
            Drag fields to position them. Add <strong>+ Barcode</strong> for scannable Code128/UPC/EAN barcodes bound to{' '}
            <code>{'{{barcode}}'}</code> or any merge field.
          </p>
          {previewItem && (
            <p style={{ fontSize: '0.85rem', maxWidth: 420 }}>
              <strong>Preview:</strong> {previewTextForTemplate(template.elements, previewItem)}
            </p>
          )}
        </section>

        <aside className="label-studio-panel label-studio-props">
          <h2>Properties</h2>
          {selectedElement ? (
            <>
              <label>
                DYMO object name
                <input
                  value={selectedElement.name}
                  onChange={(e) => updateElement(selectedElement.id, { name: e.target.value })}
                />
              </label>
              <label>
                Content (merge fields)
                <textarea
                  value={selectedElement.content}
                  onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                />
              </label>
              <p className="label-studio-merge-hints">
                Examples: <code>{'{{item}}'}</code>, <code>{'{{location}}'}</code>,{' '}
                <code>{'{{barcode}}'}</code>. Excel columns become field names automatically.
              </p>
              <div className="label-studio-merge-chips">
                {LABEL_STUDIO_MERGE_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    title={f.example}
                    onClick={() =>
                      updateElement(selectedElement.id, {
                        content: `${selectedElement.content}{{${f.key}}}`,
                      })
                    }
                  >
                    {f.key}
                  </button>
                ))}
              </div>
              {isBarcodeElement(selectedElement) ? (
                <>
                  <label>
                    Barcode type
                    <select
                      value={selectedElement.barcodeType}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          barcodeType: e.target.value as LabelStudioBarcodeType,
                        })
                      }
                    >
                      <option value="Auto">Auto (UPC-12 / EAN-13 / Code128)</option>
                      <option value="Code128Auto">Code 128</option>
                      <option value="UpcA">UPC-A</option>
                      <option value="Ean13">EAN-13</option>
                      <option value="Code39">Code 39</option>
                      <option value="QrCode">QR Code</option>
                    </select>
                  </label>
                  <label>
                    Barcode size
                    <select
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
                  <label>
                    Human-readable text
                    <select
                      value={selectedElement.textPosition}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          textPosition: e.target.value as typeof selectedElement.textPosition,
                        })
                      }
                    >
                      <option value="Bottom">Below barcode</option>
                      <option value="Top">Above barcode</option>
                      <option value="None">Hidden</option>
                    </select>
                  </label>
                </>
              ) : isTextElement(selectedElement) ? (
                <>
                  <label>
                    Font size (pt)
                    <input
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
                  <label>
                    Alignment
                    <select
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
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedElement.bold}
                      onChange={(e) => updateElement(selectedElement.id, { bold: e.target.checked })}
                    />{' '}
                    Bold
                  </label>
                </>
              ) : null}
              <label>
                Width %
                <input
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
              <label>
                Height %
                <input
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
            </>
          ) : (
            <p style={{ fontSize: '0.9rem', color: '#666' }}>
              Click a field on the label to edit it, or add + Text / + Barcode.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
