import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DYMO_PAPER_TEMPLATES,
  labelStudioPaperTemplates,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
} from '../lib/dymoLabelXml'
import { getDymoDiagnostics } from '../lib/dymoLabelPrint'
import {
  fetchLabelStudioItems,
  filterLabelStudioItems,
  searchLabelStudioItems,
  sortLabelStudioItems,
  type LabelStudioInventorySortKey,
  type LabelStudioSortDirection,
} from '../lib/labelStudioItems'
import {
  dymoTwinTurboRollLabel,
  loadDymoTwinTurboRoll,
  resolveStudioTwinTurboRoll,
  saveDymoTwinTurboRoll,
  type DymoTwinTurboRoll,
} from '../lib/dymoPrintParams'
import DymoTwinTurboRollPicker from './DymoTwinTurboRollPicker'
import { fetchUrlAsPreviewDataUrl } from '../lib/labelStudioImage'
import { LABEL_STUDIO_PRINT_GEOMETRY_REV, printStudioLabels } from '../lib/labelStudioPrint'
import {
  DYMO_PRINT_QUALITY_OPTIONS,
  loadLabelStudioPrintQuality,
  loadThermalImageTone,
  saveLabelStudioPrintQuality,
  saveThermalImageTone,
  type DymoPrintQuality,
} from '../lib/labelStudioThermalPrint'
import {
  THERMAL_IMAGE_TONE_OPTIONS,
  thermalToneNeedsProcessing,
  type ThermalImageTone,
} from '../lib/labelStudioThermalImage'
import {
  mergedBarcodeForElement,
  mergedImageUrlForElement,
  previewTextForTemplate,
  resolveMergeTemplate,
  normalizeMergedText,
} from '../lib/labelStudioMerge'
import { previewBarcodeBarsBoxPx } from '../lib/labelStudioBarcodeLayout'
import { linearBarcodePreviewDataUrl } from '../lib/labelStudioBarcodePreview'
import { qrPreviewDataUrl } from '../lib/labelStudioQr'
import type { LabelStudioBarcodePreview } from '../types/labelStudioBarcodePreview'
import {
  deleteLabelStudioTemplate,
  duplicateLabelStudioTemplate,
  isLabelStudioTemplateSaved,
  loadLabelStudioTemplates,
  saveLabelStudioTemplate,
} from '../lib/labelStudioStorage'
import {
  createBlankLabelStudioTemplate,
  createElementId,
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
import {
  alignElement,
  alignElementToReference,
  DEFAULT_GRID_STEP_PCT,
  GRID_STEP_OPTIONS_PCT,
  snapRectToGrid,
  type AlignToReferenceMode,
} from '../lib/labelStudioCanvasGeometry'
import './LabelStudio.css'

const INVENTORY_SOURCE_HINT =
  'Full Supabase items table. Search checks name, part #, manufacturer, barcode, description, and more (not limited to the first 500 rows).'

function itemRowDisplay(item: LabelStudioItem) {
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

function initialStudioState(): { templates: LabelStudioTemplate[]; template: LabelStudioTemplate } {
  const templates = loadLabelStudioTemplates()
  const template = templates[0] ?? createBlankLabelStudioTemplate()
  return { templates, template }
}

export default function LabelStudio() {
  const [templates, setTemplates] = useState<LabelStudioTemplate[]>(
    () => initialStudioState().templates
  )
  const [template, setTemplate] = useState<LabelStudioTemplate>(() => initialStudioState().template)
  const templateIsSaved = isLabelStudioTemplateSaved(template.id)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [items, setItems] = useState<LabelStudioItem[]>([])
  const [inventoryTotal, setInventoryTotal] = useState<number | null>(null)
  const [loadProgress, setLoadProgress] = useState<string | null>(null)
  const fullInventoryRef = useRef<LabelStudioItem[] | null>(null)
  const [barcodePreviewByElementId, setBarcodePreviewByElementId] = useState<
    Record<string, LabelStudioBarcodePreview>
  >({})
  const [printableSizePx, setPrintableSizePx] = useState({ width: 0, height: 0 })
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
  const [showGrid, setShowGrid] = useState(() => localStorage.getItem('ls-show-grid') === '1')
  const [snapToGrid, setSnapToGrid] = useState(() => localStorage.getItem('ls-snap-grid') !== '0')
  const [gridStepPct, setGridStepPct] = useState(() => {
    const n = Number(localStorage.getItem('ls-grid-step'))
    return GRID_STEP_OPTIONS_PCT.includes(n as (typeof GRID_STEP_OPTIONS_PCT)[number])
      ? n
      : DEFAULT_GRID_STEP_PCT
  })
  const [alignReferenceId, setAlignReferenceId] = useState<string>('')
  const [printQuality, setPrintQuality] = useState<DymoPrintQuality>(() => loadLabelStudioPrintQuality())
  const [thermalImageTone, setThermalImageTone] = useState<ThermalImageTone>(() => loadThermalImageTone())
  const [thermalImagePreviewByElementId, setThermalImagePreviewByElementId] = useState<
    Record<string, string>
  >({})
  const [dymoSummary, setDymoSummary] = useState<string | null>(null)

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
  const paperTemplate =
    DYMO_PAPER_TEMPLATES.find((p) => p.id === template.paperTemplateId) ?? DYMO_PAPER_TEMPLATES[1]
  const paperName = paperTemplate.paperName
  const effectiveTwinTurboRoll = resolveStudioTwinTurboRoll(
    template.paperTemplateId,
    twinTurboRoll
  )

  useEffect(() => {
    const paperRoll = paperTemplate.studioTwinTurboRoll
    if (!paperRoll) return
    setTwinTurboRoll((current) => {
      if (current === paperRoll) return current
      saveDymoTwinTurboRoll(paperRoll)
      return paperRoll
    })
  }, [template.paperTemplateId, paperTemplate.studioTwinTurboRoll])

  useEffect(() => {
    if (paperTemplate.id !== 'Durable1933085') return
    setPrintQuality((current) => {
      if (current === 'BarcodeAndGraphics') return current
      saveLabelStudioPrintQuality('BarcodeAndGraphics')
      return 'BarcodeAndGraphics'
    })
  }, [paperTemplate.id, template.paperTemplateId])

  const loadItems = useCallback(async () => {
    setLoadingItems(true)
    setItemsError(null)
    setLoadProgress(null)
    fullInventoryRef.current = null
    try {
      const loaded = await fetchLabelStudioItems((count, total) => {
        setLoadProgress(
          total != null ? `Loading items… ${count.toLocaleString()} / ${total.toLocaleString()}` : null
        )
        if (total != null) setInventoryTotal(total)
      })
      fullInventoryRef.current = loaded
      setInventoryTotal(loaded.length)
      if (!searchTrimmed) setItems(loaded)
      if (loaded.length === 0) {
        setItemsError('No items found. Add items on the Items page first.')
      }
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : 'Failed to load items')
      setItems([])
      fullInventoryRef.current = null
    } finally {
      setLoadingItems(false)
      setLoadProgress(null)
    }
  }, [searchTrimmed])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

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
      void searchLabelStudioItems(q)
        .then((rows) => {
          if (cancelled) return
          setItems(rows)
          if (rows.length === 0) {
            setItemsError(`No items match “${q}”.`)
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
      setBarcodePreviewByElementId({})
      return
    }
    if (printableSizePx.width < 16 || printableSizePx.height < 16) {
      return
    }
    let cancelled = false

    void (async () => {
      const next: Record<string, LabelStudioBarcodePreview> = {}
      for (const el of template.elements) {
        if (!isBarcodeElement(el)) continue
        const text = mergedBarcodeForElement(el.content, previewItem)
        if (!text) continue
        const box = previewBarcodeBarsBoxPx(el, printableSizePx.width, printableSizePx.height)
        if (el.barcodeType === 'QrCode') {
          const dataUrl = await qrPreviewDataUrl(text)
          if (dataUrl) next[el.id] = { format: 'qr', dataUrl }
        } else {
          const dataUrl = linearBarcodePreviewDataUrl(text, el.barcodeType, box.width, box.height)
          if (dataUrl) next[el.id] = { format: 'linear', dataUrl }
        }
      }
      if (!cancelled) setBarcodePreviewByElementId(next)
    })()
    return () => {
      cancelled = true
    }
  }, [previewItem, template.elements, printableSizePx.width, printableSizePx.height])

  useEffect(() => {
    if (!previewItem || !thermalToneNeedsProcessing(thermalImageTone)) {
      setThermalImagePreviewByElementId({})
      return
    }
    if (printableSizePx.width < 16 || printableSizePx.height < 16) return

    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const el of template.elements) {
        if (!isImageElement(el)) continue
        const url = mergedImageUrlForElement(el.content, previewItem)
        if (!url) continue
        const boxW = Math.max(48, Math.round((el.widthPct / 100) * printableSizePx.width))
        const boxH = Math.max(48, Math.round((el.heightPct / 100) * printableSizePx.height))
        const maxPx = Math.max(boxW, boxH, 160)
        const dataUrl = await fetchUrlAsPreviewDataUrl(url, maxPx, { tone: thermalImageTone })
        if (dataUrl) next[el.id] = dataUrl
      }
      if (!cancelled) setThermalImagePreviewByElementId(next)
    })()

    return () => {
      cancelled = true
    }
  }, [previewItem, template.elements, printableSizePx.width, printableSizePx.height, thermalImageTone])

  useEffect(() => {
    void getDymoDiagnostics().then((d) => setDymoSummary(d.summary))
  }, [])

  const updateTemplate = (patch: Partial<LabelStudioTemplate>) => {
    setTemplate((t) => ({ ...t, ...patch }))
  }

  const updateElement = (id: string, patch: Record<string, unknown>) => {
    if ('barcodeType' in patch) {
      setBarcodePreviewByElementId((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
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

  const snapElementNow = () => {
    if (!selectedElement || !snapToGrid || gridStepPct <= 0) return
    updateElementRect(
      selectedElement.id,
      snapRectToGrid(
        {
          xPct: selectedElement.xPct,
          yPct: selectedElement.yPct,
          widthPct: selectedElement.widthPct,
          heightPct: selectedElement.heightPct,
        },
        gridStepPct
      )
    )
  }

  const alignSelectedToReference = (mode: AlignToReferenceMode) => {
    if (!selectedElement || !alignReferenceId) return
    const ref = template.elements.find((e) => e.id === alignReferenceId)
    if (!ref || ref.id === selectedElement.id) return
    const rect = alignElementToReference(
      {
        xPct: selectedElement.xPct,
        yPct: selectedElement.yPct,
        widthPct: selectedElement.widthPct,
        heightPct: selectedElement.heightPct,
      },
      {
        xPct: ref.xPct,
        yPct: ref.yPct,
        widthPct: ref.widthPct,
        heightPct: ref.heightPct,
      },
      mode
    )
    updateElementRect(selectedElement.id, rect)
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
      size: 'Small',
      textPosition: 'Bottom',
      textFontSize: 10,
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
      const nudge = (patch: { xPct?: number; yPct?: number }) => {
        const next = {
          xPct: patch.xPct ?? el.xPct,
          yPct: patch.yPct ?? el.yPct,
          widthPct: el.widthPct,
          heightPct: el.heightPct,
        }
        if (snapToGrid && gridStepPct > 0) {
          updateElementRect(el.id, snapRectToGrid(next, gridStepPct))
        } else {
          updateElement(el.id, patch)
        }
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nudge({ xPct: el.xPct - step })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nudge({ xPct: el.xPct + step })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        nudge({ yPct: el.yPct - step })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        nudge({ yPct: el.yPct + step })
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        duplicateSelectedElement()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedElementId, template.elements, snapToGrid, gridStepPct])

  const handleSaveTemplate = () => {
    const toSave = { ...template, updatedAt: new Date().toISOString() }
    saveLabelStudioTemplate(toSave)
    const next = loadLabelStudioTemplates()
    setTemplates(next)
    setTemplate(normalizeStudioTemplate(toSave))
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
    if (!templateIsSaved) {
      setStatus({ kind: 'info', text: 'This template is not saved yet — nothing to delete.' })
      return
    }
    if (!window.confirm(`Delete saved template “${template.name}”?`)) return
    deleteLabelStudioTemplate(template.id)
    const next = loadLabelStudioTemplates()
    setTemplates(next)
    if (next.length > 0) {
      const picked = normalizeStudioTemplate(next[0])
      setTemplate(picked)
      setSelectedElementId(picked.elements[0]?.id ?? null)
      setStatus({ kind: 'ok', text: `Deleted “${template.name}”.` })
    } else {
      const blank = createBlankLabelStudioTemplate()
      setTemplate(blank)
      setSelectedElementId(null)
      setStatus({ kind: 'ok', text: 'All saved templates deleted. Start a new layout or save when ready.' })
    }
  }

  const toggleItemSelection = (item: LabelStudioItem) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    setSelectedItemsById((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item)
      return next
    })
    setPreviewItemId(item.id)
  }

  const setPreviewOnly = (item: LabelStudioItem) => {
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
    const toPrint = selectedItems
    if (toPrint.length === 0) {
      setStatus({
        kind: 'err',
        text: 'Check one or more items in the list above, then click Print labels.',
      })
      return
    }
    setPrinting(true)
    setStatus({ kind: 'info', text: `Sending ${toPrint.length} label(s) to the printer…` })
    try {
      const result = await printStudioLabels(template, toPrint, {
        twinTurboRoll,
        printQuality,
        thermalImage: { tone: thermalImageTone },
      })
      setStatus({
        kind: 'ok',
        text: `Printed ${result.printed} label${result.printed !== 1 ? 's' : ''} (print layout rev ${LABEL_STUDIO_PRINT_GEOMETRY_REV}, ${result.method}).`,
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
      if (thermalToneNeedsProcessing(thermalImageTone)) {
        return thermalImagePreviewByElementId[el.id] ?? null
      }
      const url = mergedImageUrlForElement(el.content, previewItem)
      return url || null
    },
    [previewItem, thermalImageTone, thermalImagePreviewByElementId]
  )

  const canvasBarcodePreview = useCallback(
    (el: LabelStudioElement): LabelStudioBarcodePreview | null => {
      if (!isBarcodeElement(el)) return null
      const hit = barcodePreviewByElementId[el.id]
      if (!hit) return null
      const wantsQr = el.barcodeType === 'QrCode'
      if (wantsQr && hit.format !== 'qr') return null
      if (!wantsQr && hit.format !== 'linear') return null
      return hit
    },
    [barcodePreviewByElementId]
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

      {status && (
        <div className={`label-studio-status ${status.kind}`} role="status">
          {status.text}
        </div>
      )}

      <div className="ls-print-bar">
        <div className="ls-print-bar-summary">
          <strong>
            {selectedItemIds.size > 0
              ? `${selectedItemIds.size} item${selectedItemIds.size !== 1 ? 's' : ''} selected — one label each`
              : 'No items selected — check rows below to print'}
          </strong>
          <span className="ls-print-bar-meta">
            Template: {template.name} · Paper: {paperName} · Feed:{' '}
            {dymoTwinTurboRollLabel(effectiveTwinTurboRoll)}
            {twinTurboRoll === 'Auto' && paperTemplate.studioTwinTurboRoll
              ? ' (from roll type)'
              : ''}
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
          disabled={printing || selectedItemIds.size === 0}
        >
          {printing
            ? 'Printing…'
            : selectedItemIds.size > 1
              ? `Print ${selectedItemIds.size} labels`
              : 'Print labels'}
        </button>
      </div>

      <div className="ls-thermal-print-bar">
        <span className="ls-field-label">Thermal printer tuning</span>
        <div className="ls-thermal-print-controls">
          <label className="ls-thermal-field">
            <span className="ls-thermal-field-label">Print quality</span>
            <select
              className="ls-select"
              value={printQuality}
              onChange={(e) => {
                const next = e.target.value as DymoPrintQuality
                setPrintQuality(next)
                saveLabelStudioPrintQuality(next)
              }}
            >
              {DYMO_PRINT_QUALITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="ls-field-hint">
              {DYMO_PRINT_QUALITY_OPTIONS.find((o) => o.value === printQuality)?.hint}
              {paperTemplate.id === 'Durable1933085'
                ? ' LW Durable film usually needs Graphics — Text often prints blank.'
                : ''}
            </span>
          </label>
          <label className="ls-thermal-field">
            <span className="ls-thermal-field-label">Product image</span>
            <select
              className="ls-select"
              value={thermalImageTone}
              onChange={(e) => {
                const next = e.target.value as ThermalImageTone
                setThermalImageTone(next)
                saveThermalImageTone(next)
              }}
            >
              {THERMAL_IMAGE_TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="ls-field-hint">
              {THERMAL_IMAGE_TONE_OPTIONS.find((o) => o.value === thermalImageTone)?.hint} Canvas
              preview matches print.
            </span>
          </label>
        </div>
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
            onClick={() => void loadItems()}
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
          placeholder="Search all items (name, part, description…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {searchingItems && <p className="ls-field-hint">Searching items…</p>}

        <div className="ls-item-actions">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={selectAllVisible}>
            Select all shown
          </button>
          <button type="button" className="ls-btn ls-btn-secondary" onClick={clearSelection}>
            Clear
          </button>
        </div>

        {itemsError && <p className="ls-error">{itemsError}</p>}

        <div
          className="label-studio-item-list"
          role="listbox"
          aria-label="Items to print"
          aria-multiselectable="true"
        >
            {filteredItems.map((item) => {
              const row = itemRowDisplay(item)
              const isSelected = selectedItemIds.has(item.id)
              const isPreview = previewItemId === item.id
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`label-studio-item-row${isSelected ? ' selected' : ''}${isPreview ? ' preview' : ''}`}
                  onClick={() => setPreviewOnly(item)}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleItemSelection(item)}
                    onClick={(ev) => ev.stopPropagation()}
                    aria-label={`Select ${row.name} for printing`}
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
                      <dl className="ls-item-details-grid">
                        <div className="ls-item-detail-cell">
                          <dt>Part #</dt>
                          <dd>{row.partNumber}</dd>
                        </div>
                        <div className="ls-item-detail-cell">
                          <dt>Manufacturer</dt>
                          <dd>{row.manufacturer}</dd>
                        </div>
                        <div className="ls-item-detail-cell ls-item-detail-cell-wide">
                          <dt>Barcode</dt>
                          <dd>{row.barcode}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              )
            })}
            {!loadingItems && !searchingItems && filteredItems.length === 0 && (
              <p className="ls-empty">
                {searchTrimmed
                  ? 'No items match your search.'
                  : 'No items loaded yet.'}
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
                  value={templateIsSaved ? template.id : ''}
                  disabled={templates.length === 0}
                  onChange={(e) => {
                    const t = templates.find((x) => x.id === e.target.value)
                    if (t) {
                      const normalized = normalizeStudioTemplate(t)
                      setTemplate(normalized)
                      setSelectedElementId(normalized.elements[0]?.id ?? null)
                    }
                  }}
                >
                  {templates.length === 0 ? (
                    <option value="">No saved templates</option>
                  ) : (
                    templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))
                  )}
                </select>
                {templates.length === 0 && (
                  <span className="ls-field-hint">
                    No saved templates on this browser. Edit the layout below, then click Save template.
                    {!templateIsSaved && template.name ? ` (editing: ${template.name})` : ''}
                  </span>
                )}
                {templates.length > 0 && !templateIsSaved && (
                  <span className="ls-field-hint">
                    Current layout is not saved yet — pick a saved template above or click Save template.
                  </span>
                )}
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
                  {labelStudioPaperTemplates().map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.studioLabel ?? p.paperName}
                    </option>
                  ))}
                </select>
                <span className="ls-field-hint">
                  Must match your loaded roll in DYMO Connect. Preview size is the real sticker face (
                  {paperTemplate.widthMm}×{paperTemplate.heightMm} mm).
                </span>
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
                <button
                  type="button"
                  className="ls-btn ls-btn-danger"
                  onClick={handleDeleteTemplate}
                  disabled={!templateIsSaved}
                  title={templateIsSaved ? 'Remove from saved templates' : 'Save the template first'}
                >
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

          <div className="ls-layout-tools">
            <span className="ls-field-label">Grid &amp; snap</span>
            <div className="ls-btn-row ls-grid-controls">
              <label className="ls-check-label">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => {
                    setShowGrid(e.target.checked)
                    localStorage.setItem('ls-show-grid', e.target.checked ? '1' : '0')
                  }}
                />
                Show grid
              </label>
              <label className="ls-check-label">
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(e) => {
                    setSnapToGrid(e.target.checked)
                    localStorage.setItem('ls-snap-grid', e.target.checked ? '1' : '0')
                  }}
                />
                Snap to grid
              </label>
              <label className="ls-grid-step-label">
                Step
                <select
                  value={gridStepPct}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setGridStepPct(n)
                    localStorage.setItem('ls-grid-step', String(n))
                  }}
                  disabled={!showGrid && !snapToGrid}
                >
                  {GRID_STEP_OPTIONS_PCT.map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={snapElementNow}
                disabled={!selectedElement || !snapToGrid}
                title="Snap selected field to grid now"
              >
                Snap now
              </button>
            </div>
          </div>

          {selectedElement && (
            <div className="ls-layout-tools">
              <span className="ls-field-label">Align on label</span>
              <div className="ls-btn-row">
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('left')} title="Align left edge to label">⬅</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('centerH')} title="Center horizontally on label">↔</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('right')} title="Align right edge to label">➡</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('top')} title="Align top to label">⬆</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('centerV')} title="Center vertically on label">↕</button>
                <button type="button" className="ls-btn ls-btn-secondary ls-btn-icon" onClick={() => alignSelected('bottom')} title="Align bottom to label">⬇</button>
                <button type="button" className="ls-btn ls-btn-secondary" onClick={() => moveElementLayer('up')} title="Bring forward">
                  ↑ Layer
                </button>
                <button type="button" className="ls-btn ls-btn-secondary" onClick={() => moveElementLayer('down')} title="Send backward">
                  ↓ Layer
                </button>
              </div>
              {template.elements.length > 1 && (
                <div className="ls-align-ref-row">
                  <label className="ls-align-ref-label">
                    Align to field
                    <select
                      value={alignReferenceId}
                      onChange={(e) => setAlignReferenceId(e.target.value)}
                    >
                      <option value="">Choose field…</option>
                      {template.elements
                        .filter((e) => e.id !== selectedElement.id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {elementSummary(e)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="ls-btn-row">
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('left')}>
                      Match left
                    </button>
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('centerH')}>
                      Match center
                    </button>
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('right')}>
                      Match right
                    </button>
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('top')}>
                      Match top
                    </button>
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('centerV')}>
                      Match middle
                    </button>
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('matchWidth')}>
                      Same width
                    </button>
                    <button type="button" className="ls-btn ls-btn-secondary" disabled={!alignReferenceId} onClick={() => alignSelectedToReference('matchHeight')}>
                      Same height
                    </button>
                  </div>
                </div>
              )}
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
            paperTemplateId={template.paperTemplateId}
            elements={template.elements}
            selectedElementId={selectedElementId}
            onSelect={setSelectedElementId}
            onUpdateRect={updateElementRect}
            renderPreview={canvasPreviewText}
            imagePreviewUrl={canvasImagePreviewUrl}
            barcodePreview={canvasBarcodePreview}
            onPrintableSizeChange={setPrintableSizePx}
            showGrid={showGrid}
            gridStepPct={gridStepPct}
            snapToGrid={snapToGrid}
          />

          <p className="ls-canvas-hint">
            The preview is the full {paperTemplate.widthMm}×{paperTemplate.heightMm} mm label face
            {paperTemplate.id === 'Durable1933085'
              ? ' — durable print is a WYSIWYG bitmap of this canvas on the full label draw area (30330 envelope).'
              : ' — print uses the same layout on that roll.'}{' '}
            <strong>Move</strong> drag · <strong>Resize</strong> blue handles · <strong>Delete</strong> key removes the
            field. Enable <strong>Snap to grid</strong> to lock fields to the grid when you release a drag or use arrow
            keys.
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
                    Use {'{{picture}}'} for items with images stored in Supabase (Items page).
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
                  {selectedElement.textPosition !== 'None' && (
                    <p className="ls-field-hint">
                      Numbers under or above the code auto-fit inside the barcode box on screen and when
                      printed.
                    </p>
                  )}
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
                <span className="ls-field-label">Position &amp; size on label</span>
                <p className="ls-size-values">
                  {Math.round(selectedElement.xPct)}% from left, {Math.round(selectedElement.yPct)}% from top
                  <br />
                  {Math.round(selectedElement.widthPct)}% wide × {Math.round(selectedElement.heightPct)}% tall
                  <span className="ls-field-hint"> — drag the box on the preview to move or resize</span>
                </p>
              </div>

              <details className="ls-advanced">
                <summary>Type exact position &amp; size (%)</summary>
                <label className="ls-field">
                  <span className="ls-field-label">From left (%)</span>
                  <input
                    className="ls-input"
                    type="number"
                    min={0}
                    max={95}
                    value={Math.round(selectedElement.xPct)}
                    onChange={(e) =>
                      updateElement(selectedElement.id, {
                        xPct: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label className="ls-field">
                  <span className="ls-field-label">From top (%)</span>
                  <input
                    className="ls-input"
                    type="number"
                    min={0}
                    max={95}
                    value={Math.round(selectedElement.yPct)}
                    onChange={(e) =>
                      updateElement(selectedElement.id, {
                        yPct: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
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
                Check items above to print; the label preview uses the row you last clicked.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
