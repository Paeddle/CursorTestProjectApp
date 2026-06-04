import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DYMO_PAPER_TEMPLATES, LABEL_HEIGHT_MM, LABEL_WIDTH_MM } from '../lib/dymoLabelXml'
import { getDymoDiagnostics } from '../lib/dymoLabelPrint'
import {
  fetchLabelStudioInventoryItems,
  filterLabelStudioItems,
  searchLabelStudioInventoryItems,
  sortLabelStudioItems,
  type LabelStudioInventorySortKey,
  type LabelStudioSortDirection,
} from '../lib/labelStudioItems'
import {
  dymoTwinTurboRollLabel,
  loadDymoTwinTurboRoll,
  saveDymoTwinTurboRoll,
  type DymoTwinTurboRoll,
} from '../lib/dymoPrintParams'
import DymoTwinTurboRollPicker from './DymoTwinTurboRollPicker'
import { printStudioLabels } from '../lib/labelStudioPrint'
import {
  mergedBarcodeForElement,
  mergedImageUrlForElement,
  previewTextForTemplate,
  resolveMergeTemplate,
  normalizeMergedText,
} from '../lib/labelStudioMerge'
import { qrPreviewDataUrl } from '../lib/labelStudioQr'
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
  isImageElement,
  isTextElement,
  LABEL_STUDIO_MERGE_FIELDS,
  normalizeStudioTemplate,
  type LabelStudioBarcodeType,
  type LabelStudioElement,
  type LabelStudioItem,
  type LabelStudioTemplate,
} from '../types/labelStudio'
import LabelStudioCanvas from './LabelStudioCanvas'
import { alignElement } from '../lib/labelStudioCanvasGeometry'
import './LabelStudio.css'

const GUIDE_STORAGE_KEY = 'label-studio-guide-dismissed'

const INVENTORY_SOURCE_HINT =
  'Full Supabase inventory. Search checks name, part #, manufacturer, barcode, description, and more (not limited to the first 500 rows).'

function inventoryItemDisplay(item: LabelStudioItem) {
  const f = item.fields
  return {
    name: f.item || '—',
    partNumber: f.part_number || '—',
    manufacturer: f.manufacturer || '—',
    barcode: f.barcode || '—',
    picture: f.picture || null,
  }
}

function elementSummary(el: LabelStudioElement): string {
  const short = el.content.replace(/\{\{|\}\}/g, '').trim() || '(empty)'
  if (isBarcodeElement(el)) return `Barcode: ${short}`
  if (isImageElement(el)) return `Image: ${short}`
  const preview = el.content.length > 28 ? `${el.content.slice(0, 28)}…` : el.content
  return `Text: ${preview}`
}

export default function LabelStudio() {
  const [templates, setTemplates] = useState<LabelStudioTemplate[]>(() => loadLabelStudioTemplates())
  const [template, setTemplate] = useState<LabelStudioTemplate>(() => loadLabelStudioTemplates()[0])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [items, setItems] = useState<LabelStudioItem[]>([])
  const [inventoryTotal, setInventoryTotal] = useState<number | null>(null)
  const [loadProgress, setLoadProgress] = useState<string | null>(null)
  const fullInventoryRef = useRef<LabelStudioItem[] | null>(null)
  const [qrPreviewByElementId, setQrPreviewByElementId] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<LabelStudioInventorySortKey>('name')
  const [sortDir, setSortDir] = useState<LabelStudioSortDirection>('asc')
  const [twinTurboRoll, setTwinTurboRoll] = useState<DymoTwinTurboRoll>(() => loadDymoTwinTurboRoll())
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [selectedItemsById, setSelectedItemsById] = useState<Map<string, LabelStudioItem>>(new Map())
  const [previewItemId, setPreviewItemId] = useState<string | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [searchingItems, setSearchingItems] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [printing, setPrinting] = useState(false)
  const [dymoSummary, setDymoSummary] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(
    () => localStorage.getItem(GUIDE_STORAGE_KEY) !== '1'
  )

  const searchTrimmed = search.trim()
  const filteredItems = useMemo(() => {
    const matched = searchTrimmed ? items : filterLabelStudioItems(items, search)
    return sortLabelStudioItems(matched, sortKey, sortDir)
  }, [items, search, searchTrimmed, sortKey, sortDir])

  const previewItem = useMemo(() => {
    const id = previewItemId ?? [...selectedItemIds][0] ?? filteredItems[0]?.id
    return filteredItems.find((i) => i.id === id) ?? null
  }, [filteredItems, previewItemId, selectedItemIds])

  const selectedElement = template.elements.find((e) => e.id === selectedElementId) ?? null
  const selectedItems = useMemo(
    () =>
      [...selectedItemIds]
        .map((id) => selectedItemsById.get(id))
        .filter((i): i is LabelStudioItem => Boolean(i)),
    [selectedItemIds, selectedItemsById]
  )
  const paperName =
    DYMO_PAPER_TEMPLATES.find((p) => p.id === template.paperTemplateId)?.paperName ?? '30323 Shipping'

  const loadInventoryItems = useCallback(async () => {
    setLoadingItems(true)
    setItemsError(null)
    setLoadProgress(null)
    fullInventoryRef.current = null
    try {
      const loaded = await fetchLabelStudioInventoryItems((count, total) => {
        setLoadProgress(
          total != null ? `Loading inventory… ${count.toLocaleString()} / ${total.toLocaleString()}` : null
        )
        if (total != null) setInventoryTotal(total)
      })
      fullInventoryRef.current = loaded
      setInventoryTotal(loaded.length)
      if (!searchTrimmed) setItems(loaded)
      if (loaded.length === 0) {
        setItemsError('No inventory rows found. Add items on the Inventory page first.')
      }
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : 'Failed to load inventory')
      setItems([])
      fullInventoryRef.current = null
    } finally {
      setLoadingItems(false)
      setLoadProgress(null)
    }
  }, [searchTrimmed])

  useEffect(() => {
    void loadInventoryItems()
  }, [loadInventoryItems])

  useEffect(() => {
    const q = searchTrimmed
    if (!q) {
      if (fullInventoryRef.current) setItems(fullInventoryRef.current)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearchingItems(true)
      setItemsError(null)
      void searchLabelStudioInventoryItems(q)
        .then((rows) => {
          if (cancelled) return
          setItems(rows)
          if (rows.length === 0) {
            setItemsError(`No inventory rows match “${q}”.`)
          }
        })
        .catch((e) => {
          if (cancelled) return
          setItemsError(e instanceof Error ? e.message : 'Search failed')
          setItems([])
        })
        .finally(() => {
          if (!cancelled) setSearchingItems(false)
        })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchTrimmed])

  useEffect(() => {
    if (!previewItem) {
      setQrPreviewByElementId({})
      return
    }
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const el of template.elements) {
        if (!isBarcodeElement(el) || el.barcodeType !== 'QrCode') continue
        const text = mergedBarcodeForElement(el.content, previewItem)
        if (!text) continue
        const url = await qrPreviewDataUrl(text)
        if (url) next[el.id] = url
      }
      if (!cancelled) setQrPreviewByElementId(next)
    })()
    return () => {
      cancelled = true
    }
  }, [previewItem, template.elements])

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

  const updateElementRect = (id: string, rect: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => {
    updateElement(id, rect)
  }

  const duplicateSelectedElement = () => {
    if (!selectedElement) return
    const copy = {
      ...selectedElement,
      id: createElementId(),
      name: `${selectedElement.name}_2`,
      xPct: Math.min(92, selectedElement.xPct + 3),
      yPct: Math.min(92, selectedElement.yPct + 3),
    } as LabelStudioElement
    setTemplate((t) => ({ ...t, elements: [...t.elements, copy] }))
    setSelectedElementId(copy.id)
  }

  const moveElementLayer = (direction: 'up' | 'down') => {
    if (!selectedElementId) return
    setTemplate((t) => {
      const idx = t.elements.findIndex((e) => e.id === selectedElementId)
      if (idx < 0) return t
      const next = [...t.elements]
      const swap = direction === 'up' ? idx + 1 : idx - 1
      if (swap < 0 || swap >= next.length) return t
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return { ...t, elements: next }
    })
  }

  const alignSelected = (align: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
    if (!selectedElement) return
    const rect = alignElement(
      {
        xPct: selectedElement.xPct,
        yPct: selectedElement.yPct,
        widthPct: selectedElement.widthPct,
        heightPct: selectedElement.heightPct,
      },
      align
    )
    updateElementRect(selectedElement.id, rect)
  }

  const applyPreset = (preset: 'inventory' | 'shipping') => {
    const next = preset === 'inventory' ? defaultInventoryTemplate() : defaultShippingTemplate()
    setTemplate(next)
    setSelectedElementId(next.elements[0]?.id ?? null)
    setStatus({
      kind: 'ok',
      text:
        preset === 'inventory'
          ? 'Loaded “image + item + barcode” layout. Store images on the Inventory page, then print.'
          : 'Loaded “job + location” layout. Pick inventory rows on the left, then print.',
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
      textFitMode: 'ShrinkToFit',
    }
    setTemplate((t) => ({ ...t, elements: [...t.elements, el] }))
    setSelectedElementId(el.id)
  }

  const addImageElement = () => {
    const el: LabelStudioElement = {
      kind: 'image',
      id: createElementId(),
      name: 'PICTURE',
      content: '{{picture}}',
      xPct: 4,
      yPct: 8,
      widthPct: 30,
      heightPct: 84,
      scaleMode: 'Uniform',
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedElementId) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const el = template.elements.find((x) => x.id === selectedElementId)
      if (!el) return

      const step = e.shiftKey ? 2 : 0.8
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelectedElement()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        updateElement(el.id, { xPct: el.xPct - step })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        updateElement(el.id, { xPct: el.xPct + step })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        updateElement(el.id, { yPct: el.yPct - step })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        updateElement(el.id, { yPct: el.yPct + step })
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        duplicateSelectedElement()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedElementId, template.elements])

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

  const toggleItemSelection = (item: LabelStudioItem, multi: boolean) => {
    setSelectedItemIds((prev) => {
      const next = new Set(multi ? prev : [])
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    setSelectedItemsById((prev) => {
      const next = new Map(multi ? prev : [])
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item)
      return next
    })
    setPreviewItemId(item.id)
  }

  const selectAllVisible = () => {
    setSelectedItemIds(new Set(filteredItems.map((i) => i.id)))
    setSelectedItemsById((prev) => {
      const next = new Map(prev)
      for (const item of filteredItems) next.set(item.id, item)
      return next
    })
  }

  const clearSelection = () => {
    setSelectedItemIds(new Set())
    setSelectedItemsById(new Map())
  }

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
      const result = await printStudioLabels(template, toPrint, { twinTurboRoll })
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

  const canvasImagePreviewUrl = useCallback(
    (el: LabelStudioElement): string | null => {
      if (!isImageElement(el) || !previewItem) return null
      const url = mergedImageUrlForElement(el.content, previewItem)
      return url || null
    },
    [previewItem]
  )

  const canvasBarcodePreviewUrl = useCallback(
    (el: LabelStudioElement): string | null => {
      if (!isBarcodeElement(el) || el.barcodeType !== 'QrCode') return null
      return qrPreviewByElementId[el.id] ?? null
    },
    [qrPreviewByElementId]
  )

  const canvasPreviewText = (el: LabelStudioElement): string => {
    if (!previewItem) return el.content.replace(/\{\{[^}]+\}\}/g, '…')
    if (isBarcodeElement(el)) {
      return mergedBarcodeForElement(el.content, previewItem) || '(no value)'
    }
    return normalizeMergedText(resolveMergeTemplate(el.content, previewItem.fields))
  }

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
                <strong>Choose what to print</strong> — search and check inventory rows above the layout
                (name, part #, manufacturer, barcode, picture).
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
            Placeholders like <code>{'{{item}}'}</code> are filled from each row you check. On the label preview,
            drag to move, drag the blue handles to resize (like Label Live), and use arrow keys to nudge.
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
            Template: {template.name} · Paper: {paperName} · Feed: {dymoTwinTurboRollLabel(twinTurboRoll)}
          </span>
        </div>
        <DymoTwinTurboRollPicker
          className="ls-print-bar-roll"
          value={twinTurboRoll}
          onChange={(roll) => {
            setTwinTurboRoll(roll)
            saveDymoTwinTurboRoll(roll)
          }}
        />
        <button
          type="button"
          className="ls-btn ls-btn-primary ls-btn-print"
          onClick={() => void handlePrint()}
          disabled={printing}
        >
          {printing ? 'Printing…' : 'Print labels'}
        </button>
      </div>

      <section className="label-studio-panel ls-panel-items ls-panel-items-top">
        <div className="ls-panel-head">
          <h2>Choose items to print</h2>
        </div>

        <p className="ls-field-hint ls-inventory-source-hint">{INVENTORY_SOURCE_HINT}</p>

        <div className="ls-items-toolbar">
          <button
            type="button"
            className="ls-btn ls-btn-secondary"
            onClick={() => void loadInventoryItems()}
            disabled={loadingItems || searchingItems}
          >
            {loadProgress ?? (loadingItems ? 'Loading…' : 'Reload')}
          </button>

          {inventoryTotal != null && !searchTrimmed && !loadingItems && (
            <span className="ls-inventory-count">
              {inventoryTotal.toLocaleString()} loaded
            </span>
          )}

          <label className="ls-sort-field">
            <span className="ls-field-label">Sort by</span>
            <select
              className="ls-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as LabelStudioInventorySortKey)}
            >
              <option value="name">Name</option>
              <option value="part_number">Part number</option>
              <option value="manufacturer">Manufacturer</option>
            </select>
          </label>

          <label className="ls-sort-field">
            <span className="ls-field-label">Order</span>
            <select
              className="ls-select"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as LabelStudioSortDirection)}
            >
              <option value="asc">A → Z</option>
              <option value="desc">Z → A</option>
            </select>
          </label>
        </div>

        <input
          className="label-studio-search"
          type="search"
          placeholder="Search entire inventory (name, part, description…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {searchingItems && <p className="ls-field-hint">Searching inventory…</p>}

        <div className="ls-item-actions">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={selectAllVisible}>
            Select all shown
          </button>
          <button type="button" className="ls-btn ls-btn-secondary" onClick={clearSelection}>
            Clear
          </button>
        </div>

        {itemsError && <p className="ls-error">{itemsError}</p>}

        <div className="label-studio-item-list" role="listbox" aria-label="Inventory items to print">
            {filteredItems.map((item) => {
              const row = inventoryItemDisplay(item)
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={selectedItemIds.has(item.id)}
                  className={`label-studio-item-row${selectedItemIds.has(item.id) ? ' selected' : ''}`}
                  onClick={(ev) => toggleItemSelection(item, ev.ctrlKey || ev.metaKey)}
                >
                  <input
                    type="checkbox"
                    checked={selectedItemIds.has(item.id)}
                    onChange={() => toggleItemSelection(item, false)}
                    onClick={(ev) => ev.stopPropagation()}
                    aria-label={`Print ${row.name}`}
                  />
                  <div className="ls-item-row-body">
                    {row.picture ? (
                      <img className="ls-item-thumb" src={row.picture} alt="" />
                    ) : (
                      <span className="ls-item-thumb ls-item-thumb-empty" aria-hidden>
                        —
                      </span>
                    )}
                    <div className="ls-item-meta">
                      <div className="ls-item-name">{row.name}</div>
                      <div className="ls-item-detail">
                        <span className="ls-item-label">Part</span> {row.partNumber}
                      </div>
                      <div className="ls-item-detail">
                        <span className="ls-item-label">Mfg</span> {row.manufacturer}
                      </div>
                      <div className="ls-item-detail">
                        <span className="ls-item-label">Barcode</span> {row.barcode}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {!loadingItems && !searchingItems && filteredItems.length === 0 && (
              <p className="ls-empty">
                {searchTrimmed
                  ? 'No inventory rows match your search.'
                  : 'No inventory rows loaded yet.'}
              </p>
            )}
        </div>
      </section>

      <div className="label-studio-design-row">
        <section className="label-studio-panel label-studio-canvas-wrap">
          <div className="ls-panel-head">
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
                + Text
              </button>
              <button type="button" className="ls-btn ls-btn-secondary" onClick={addImageElement}>
                + Image
              </button>
              <button type="button" className="ls-btn ls-btn-secondary" onClick={addBarcodeElement}>
                + Barcode
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={duplicateSelectedElement}
                disabled={!selectedElementId}
                title="Ctrl+D"
              >
                Duplicate
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={deleteSelectedElement}
                disabled={!selectedElementId}
                title="Delete"
              >
                Delete
              </button>
            </div>
          </div>

          {selectedElement && (
            <div className="ls-layout-tools">
              <span className="ls-field-label">Align on label</span>
              <div className="ls-btn-row">
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('left')} title="Align left">⬅</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('centerH')} title="Center horizontally">↔</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('right')} title="Align right">➡</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('top')} title="Align top">⬆</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('centerV')} title="Center vertically">↕</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('bottom')} title="Align bottom">⬇</button>
                <button type="button" className="ls-btn ls-btn-secondary" onClick={() => moveElementLayer('up')} title="Bring forward">
                  ↑ Layer
                </button>
                <button type="button" className="ls-btn ls-btn-secondary" onClick={() => moveElementLayer('down')} title="Send backward">
                  ↓ Layer
                </button>
              </div>
            </div>
          )}

          {template.elements.length > 0 && (
            <div className="ls-element-picker" role="tablist" aria-label="Fields on this label">
              {template.elements.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedElementId === el.id}
                  className={`ls-element-chip${selectedElementId === el.id ? ' active' : ''}${isBarcodeElement(el) ? ' barcode' : ''}${isImageElement(el) ? ' image' : ''}`}
                  onClick={() => setSelectedElementId(el.id)}
                >
                  {isBarcodeElement(el) ? '▐▌ ' : isImageElement(el) ? '🖼 ' : 'Aa '}
                  {elementSummary(el)}
                </button>
              ))}
            </div>
          )}

          <LabelStudioCanvas
            elements={template.elements}
            selectedElementId={selectedElementId}
            onSelect={setSelectedElementId}
            onUpdateRect={updateElementRect}
            renderPreview={canvasPreviewText}
            imagePreviewUrl={canvasImagePreviewUrl}
            barcodePreviewUrl={canvasBarcodePreviewUrl}
          />

          <p className="ls-canvas-hint">
            <strong>Move:</strong> drag the box. <strong>Resize:</strong> drag the blue corner/edge handles (Shift =
            keep proportions). <strong>Nudge:</strong> arrow keys. <strong>Delete</strong> key removes the selected
            field.
          </p>

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
                {isBarcodeElement(selectedElement)
                  ? 'Scannable barcode'
                  : isImageElement(selectedElement)
                    ? 'Product image'
                    : 'Text'}
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

              {isImageElement(selectedElement) ? (
                <div className="ls-prop-group">
                  <h3 className="ls-prop-group-title">Image options</h3>
                  <p className="ls-field-hint">
                    Use {'{{picture}}'} for inventory items with images stored in Supabase (Inventory page).
                  </p>
                  <label className="ls-field">
                    <span className="ls-field-label">Scale</span>
                    <select
                      className="ls-select"
                      value={selectedElement.scaleMode}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          scaleMode: e.target.value as typeof selectedElement.scaleMode,
                        })
                      }
                    >
                      <option value="Uniform">Fit inside box (keep proportions)</option>
                      <option value="Fill">Fill box (may crop)</option>
                    </select>
                  </label>
                </div>
              ) : isBarcodeElement(selectedElement) ? (
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
                    {selectedElement.barcodeType === 'QrCode' && (
                      <p className="ls-field-hint">
                        QR encodes the full merged text from the field above (any characters), not only
                        numeric UPC/EAN.
                      </p>
                    )}
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
                    <span className="ls-field-label">Text sizing</span>
                    <select
                      className="ls-select"
                      value={selectedElement.textFitMode ?? 'ShrinkToFit'}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          textFitMode: e.target.value,
                        })
                      }
                    >
                      <option value="ShrinkToFit">Auto fit (shrink to box) — like Label Live</option>
                      <option value="None">Fixed font size</option>
                    </select>
                  </label>
                  <label className="ls-field">
                    <span className="ls-field-label">Font size (when fixed)</span>
                    <input
                      className="ls-input"
                      type="number"
                      min={8}
                      max={36}
                      value={selectedElement.fontSize}
                      disabled={selectedElement.textFitMode === 'ShrinkToFit'}
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

              <div className="ls-size-readout">
                <span className="ls-field-label">Size on label</span>
                <p className="ls-size-values">
                  {Math.round(selectedElement.widthPct)}% wide × {Math.round(selectedElement.heightPct)}% tall
                  <span className="ls-field-hint"> — drag handles on preview to change</span>
                </p>
              </div>

              <details className="ls-advanced">
                <summary>Type exact position &amp; size (%)</summary>
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
                Not sure where to start? Use <strong>Item + barcode</strong> quick start, pick inventory rows
                above, and hit Print.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
