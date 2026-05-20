import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import Barcode from 'react-barcode'
import { supabase } from '../lib/supabase'
import {
  aggregatePOBarcodeScans,
  buildCatalogLookupMap,
  lookupCatalogItem,
  normalizeBarcodeValue,
  type AggregatedPOBarcodeRow,
} from '../lib/barcodeCatalogLookup'
import type { POBarcode, PODocument, POCheckinSummary, BarcodeCatalogItem } from '../types/poCheckin'
import type { PoItemLocation, PoJobRef, PoLineItem, PoLabelPrintRow } from '../types/poIpoint'
import {
  aggregateLineItemsForPo,
  displayJobForAggregatedLine,
  formatRequestedQuantityDisplay,
  effectiveRequestedQuantity,
  resolveAggregatedLine,
  type AggregatedPoLineItem,
} from '../lib/poLineAggregate'
import {
  readPoLineCustomerOverrides,
  writePoLineCustomerOverride,
} from '../lib/poLineCustomerOverride'
import PoLineCustomerSelect from './PoLineCustomerSelect'
import {
  buildAggregatedIpointLineDisplayCache,
  buildIpointLocationIndex,
  ipointScannedIdsForAggregatedLines,
} from '../lib/poIpointIndex'
import {
  fetchPoIpointData,
  fetchPoJobRefs,
  invalidatePoIpointCache,
} from '../services/poIpointService'
import {
  jobNameForLine,
  lineItemsForPo,
  locationNamesForLine,
  normalizePoKey,
} from '../lib/poIpointMatch'
import { makeLabelKey, parseLabelKey } from '../lib/labelKey'
import { expandLabelRowsByQuantity } from '../lib/labelPrintExpand'
import { findAggregatedLineForLabelKey } from '../lib/labelPrintSelection'
import { printOrQueueLabels } from '../lib/printOrQueueLabels'
import BarcodeLookupModal from './BarcodeLookupModal'
import IpointLocationsModal from './IpointLocationsModal'
import PoIpointImportPanel from './PoIpointImportPanel'
import './POInfo.css'

const LOCATION_PREVIEW_COUNT = 2

function labelKeysForLine(
  poNumber: string,
  line: AggregatedPoLineItem,
  jobRefs: PoJobRef[],
  itemLocations: PoItemLocation[],
  sourceLines: PoLineItem[],
  activeSourceLineIds?: string[]
): string[] {
  const names = new Set<string>()
  const sourceById = new Map(sourceLines.map((l) => [l.id, l]))
  const ids = activeSourceLineIds ?? line.sourceLineIds
  for (const id of ids) {
    const src = sourceById.get(id)
    if (!src) continue
    for (const name of locationNamesForLine(src, jobRefs, itemLocations)) {
      names.add(name)
    }
  }
  const list = [...names].sort((a, b) => a.localeCompare(b))
  if (list.length === 0) return [makeLabelKey(poNumber, line.id, '')]
  return list.map((name) => makeLabelKey(poNumber, line.id, name))
}

function locationNamesForAggregatedLine(
  line: AggregatedPoLineItem,
  sourceLines: PoLineItem[],
  jobRefs: PoJobRef[],
  itemLocations: PoItemLocation[],
  activeSourceLineIds?: string[]
): string[] {
  const sourceById = new Map(sourceLines.map((l) => [l.id, l]))
  const ids = activeSourceLineIds ?? line.sourceLineIds
  const names = new Set<string>()
  for (const id of ids) {
    const src = sourceById.get(id)
    if (!src) continue
    for (const name of locationNamesForLine(src, jobRefs, itemLocations)) {
      names.add(name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

function allLabelKeysForPo(
  poNumber: string,
  lines: AggregatedPoLineItem[],
  jobRefs: PoJobRef[],
  itemLocations: PoItemLocation[],
  sourceLines: PoLineItem[]
): string[] {
  return lines.flatMap((line) =>
    labelKeysForLine(poNumber, line, jobRefs, itemLocations, sourceLines)
  )
}

type IpointLocationCellProps = {
  locationNames: string[]
  onViewAll: () => void
}

function IpointLocationCell({ locationNames, onViewAll }: IpointLocationCellProps) {
  if (locationNames.length === 0) return <>—</>

  if (locationNames.length <= LOCATION_PREVIEW_COUNT) {
    return <span className="po-info-ipoint-loc-preview">{locationNames.join(' · ')}</span>
  }

  const preview = locationNames.slice(0, LOCATION_PREVIEW_COUNT).join(' · ')
  const moreCount = locationNames.length - LOCATION_PREVIEW_COUNT

  return (
    <span className="po-info-ipoint-loc-preview">
      {preview}
      {' · '}
      <button type="button" className="po-info-ipoint-loc-more-btn" onClick={onViewAll}>
        +{moreCount} more ({locationNames.length} total)
      </button>
    </span>
  )
}

type IpointPrintCheckboxProps = {
  checked: boolean
  indeterminate: boolean
  ariaLabel: string
  onChange: () => void
}

function IpointPrintCheckbox({ checked, indeterminate, ariaLabel, onChange }: IpointPrintCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      className="po-info-scan-checkin-input"
      checked={checked}
      aria-label={ariaLabel}
      onChange={onChange}
    />
  )
}

const STORAGE_BUCKET = 'po-documents'

function isConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.length > 0 && typeof key === 'string' && key.length > 0
}

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function documentTypeLabel(type: string) {
  const t = (type || '').toLowerCase()
  if (t === 'packing_slip') return 'Packing slip'
  if (t === 'paperwork') return 'Paperwork'
  return type || 'Document'
}

const BARCODE_SUMMARY_COLUMNS = 'id,po_number,barcode_value,scanned_at,created_at'
const DOCUMENT_SUMMARY_COLUMNS =
  'id,po_number,file_url,document_type,name,scanned_at,created_at'
const CATALOG_COLUMNS = 'id,barcode_value,manufacturer,part_number,item_name,created_at,updated_at'

async function loadSummaries(): Promise<POCheckinSummary[]> {
  const [barcodesRes, docsRes] = await Promise.all([
    supabase
      .from('po_barcodes')
      .select(BARCODE_SUMMARY_COLUMNS)
      .order('scanned_at', { ascending: false }),
    supabase
      .from('po_documents')
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .order('scanned_at', { ascending: false }),
  ])
  if (barcodesRes.error) throw new Error(barcodesRes.error.message)
  if (docsRes.error) throw new Error(docsRes.error.message)
  const barcodes = (barcodesRes.data ?? []) as POBarcode[]
  const documents = (docsRes.data ?? []) as PODocument[]
  const byPo = new Map<string, POCheckinSummary>()
  for (const b of barcodes) {
    const po = (b.po_number || '').trim()
    if (!po) continue
    const key = normalizePoKey(po)
    if (!byPo.has(key)) byPo.set(key, { po_number: po, barcodes: [], documents: [] })
    byPo.get(key)!.barcodes.push(b)
  }
  for (const d of documents) {
    const po = (d.po_number || '').trim()
    if (!po) continue
    const key = normalizePoKey(po)
    if (!byPo.has(key)) byPo.set(key, { po_number: po, barcodes: [], documents: [] })
    byPo.get(key)!.documents.push(d)
  }
  return Array.from(byPo.values()).sort((a, b) =>
    a.po_number.localeCompare(b.po_number, undefined, { numeric: true })
  )
}

function pathFromStorageUrl(fileUrl: string, bucketId: string): string | null {
  const marker = `/object/public/${bucketId}/`
  const i = fileUrl.indexOf(marker)
  if (i === -1) return null
  return fileUrl.slice(i + marker.length)
}

function makeQtyEditKey(poNumber: string, barcodeValue: string): string {
  return `${poNumber}\u0000${barcodeValue}`
}

function makeCheckinMapKey(poNumber: string, barcodeValue: string): string {
  return `${poNumber.trim().toLowerCase()}\u0000${normalizeBarcodeValue(barcodeValue)}`
}

type PoScanSortColumn = 'item' | 'partNumber' | 'qty' | 'lastScan'
type PoScanSortState = { column: PoScanSortColumn; asc: boolean }
type CatalogSortColumn = 'item' | 'partNumber' | 'manufacturer'

function sortKeyItemName(catalogMap: Map<string, BarcodeCatalogItem>, barcode: string): string {
  const cat = lookupCatalogItem(catalogMap, barcode)
  const name = (cat?.item_name || '').trim().toLowerCase()
  return name || '\uFFFF'
}

function sortKeyPartNumber(catalogMap: Map<string, BarcodeCatalogItem>, barcode: string): string {
  const cat = lookupCatalogItem(catalogMap, barcode)
  const p = (cat?.part_number || '').trim().toLowerCase()
  return p || '\uFFFF'
}

function sortAggregatedRows(
  rows: AggregatedPOBarcodeRow[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  column: PoScanSortColumn,
  asc: boolean
): AggregatedPOBarcodeRow[] {
  const mult = asc ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    if (column === 'item') {
      const ka = sortKeyItemName(catalogMap, a.barcode_value)
      const kb = sortKeyItemName(catalogMap, b.barcode_value)
      return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    }
    if (column === 'partNumber') {
      const ka = sortKeyPartNumber(catalogMap, a.barcode_value)
      const kb = sortKeyPartNumber(catalogMap, b.barcode_value)
      return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    }
    if (column === 'qty') {
      return mult * (a.quantity - b.quantity)
    }
    const ta = new Date(a.last_scanned_at).getTime()
    const tb = new Date(b.last_scanned_at).getTime()
    return mult * (ta - tb)
  })
  return copy
}

function sortCatalogRows(
  items: BarcodeCatalogItem[],
  column: CatalogSortColumn,
  asc: boolean
): BarcodeCatalogItem[] {
  const mult = asc ? 1 : -1
  const copy = [...items]
  copy.sort((a, b) => {
    if (column === 'item') {
      const ka = ((a.item_name || '').trim() || '\uFFFF').toLowerCase()
      const kb = ((b.item_name || '').trim() || '\uFFFF').toLowerCase()
      return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    }
    if (column === 'partNumber') {
      const ka = ((a.part_number || '').trim() || '\uFFFF').toLowerCase()
      const kb = ((b.part_number || '').trim() || '\uFFFF').toLowerCase()
      return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
    }
    const ka = ((a.manufacturer || '').trim() || '\uFFFF').toLowerCase()
    const kb = ((b.manufacturer || '').trim() || '\uFFFF').toLowerCase()
    return mult * ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' })
  })
  return copy
}

function defaultAscForPoScanColumn(column: PoScanSortColumn): boolean {
  return column === 'item' || column === 'partNumber'
}

function POInfo() {
  const [summaries, setSummaries] = useState<POCheckinSummary[]>([])
  const [catalog, setCatalog] = useState<BarcodeCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchPo, setSearchPo] = useState('')
  const [expandedPo, setExpandedPo] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [lookupOpen, setLookupOpen] = useState<{
    barcode: string
    catalogSeed: BarcodeCatalogItem | null
    openCatalogEditor: boolean
  } | null>(null)
  const [qtyEditKey, setQtyEditKey] = useState<string | null>(null)
  const [qtyDraft, setQtyDraft] = useState('')
  const [qtySaving, setQtySaving] = useState(false)
  const qtyInputRef = useRef<HTMLInputElement>(null)
  const [poScanSortByKey, setPoScanSortByKey] = useState<Record<string, PoScanSortState>>({})
  const [catalogSort, setCatalogSort] = useState<{ column: CatalogSortColumn; asc: boolean }>({
    column: 'item',
    asc: true,
  })
  const [checkedInMap, setCheckedInMap] = useState<Record<string, boolean>>({})
  const [checkinSavingKey, setCheckinSavingKey] = useState<string | null>(null)
  const [bulkCheckinPoKey, setBulkCheckinPoKey] = useState<string | null>(null)
  const [jobRefs, setJobRefs] = useState<PoJobRef[]>([])
  const [lineItems, setLineItems] = useState<PoLineItem[]>([])
  const [itemLocations, setItemLocations] = useState<PoItemLocation[]>([])
  const [ipointLoading, setIpointLoading] = useState(true)
  const [labelSelected, setLabelSelected] = useState<Set<string>>(new Set())
  const [customerOverrides, setCustomerOverrides] = useState<Record<string, string>>(() =>
    readPoLineCustomerOverrides()
  )
  const [printingPoKey, setPrintingPoKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [locationModal, setLocationModal] = useState<{
    poNumber: string
    line: PoLineItem
    jobName: string | null
    locations: string[]
  } | null>(null)

  const catalogMap = useMemo(() => buildCatalogLookupMap(catalog), [catalog])

  const ipointLocationIndex = useMemo(
    () => buildIpointLocationIndex(itemLocations),
    [itemLocations]
  )

  const sortedCatalog = useMemo(
    () => sortCatalogRows(catalog, catalogSort.column, catalogSort.asc),
    [catalog, catalogSort]
  )

  const togglePoScanSort = useCallback((poKey: string, column: PoScanSortColumn) => {
    setPoScanSortByKey((prev) => {
      const cur = prev[poKey]
      if (cur?.column === column) {
        return { ...prev, [poKey]: { column, asc: !cur.asc } }
      }
      return { ...prev, [poKey]: { column, asc: defaultAscForPoScanColumn(column) } }
    })
  }, [])

  const toggleCatalogSort = useCallback((column: CatalogSortColumn) => {
    setCatalogSort((cur) =>
      cur.column === column ? { column, asc: !cur.asc } : { column, asc: true }
    )
  }, [])

  useLayoutEffect(() => {
    if (!qtyEditKey) return
    qtyInputRef.current?.focus()
    qtyInputRef.current?.select()
  }, [qtyEditKey])

  const load = useCallback(async (options?: { force?: boolean }) => {
    setLoading(true)
    setIpointLoading(true)
    setError(null)
    try {
      const [list, catRes, chkRes, refs] = await Promise.all([
        loadSummaries(),
        supabase
          .from('barcode_catalog')
          .select(CATALOG_COLUMNS)
          .order('item_name', { ascending: true }),
        supabase.from('po_barcode_checkin').select('po_number, barcode_value, checked_in'),
        fetchPoJobRefs().catch(() => [] as PoJobRef[]),
      ])
      if (catRes.error) throw new Error(catRes.error.message)
      if (chkRes.error) throw new Error(chkRes.error.message)
      setSummaries(list)
      setCatalog((catRes.data ?? []) as BarcodeCatalogItem[])
      setJobRefs(refs)
      const nextChecked: Record<string, boolean> = {}
      for (const r of chkRes.data ?? []) {
        const row = r as { po_number: string; barcode_value: string; checked_in: boolean }
        if (row.checked_in) {
          nextChecked[makeCheckinMapKey(row.po_number, row.barcode_value)] = true
        }
      }
      setCheckedInMap(nextChecked)
      setLoading(false)

      if (options?.force) invalidatePoIpointCache()
      const bundle = await fetchPoIpointData({ useCache: !options?.force })
      setLineItems(bundle.lineItems)
      setItemLocations(bundle.itemLocations)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load PO check-in data')
    } finally {
      setLoading(false)
      setIpointLoading(false)
    }
  }, [])

  const handleIpointDataChanged = useCallback(() => {
    setLabelSelected(new Set())
    void load({ force: true })
  }, [load])

  useEffect(() => {
    if (!isConfigured()) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
      setLoading(false)
      return
    }
    load()
  }, [load])

  const displaySummaries = useMemo(() => {
    const byKey = new Map<string, POCheckinSummary>()
    for (const s of summaries) {
      byKey.set(normalizePoKey(s.po_number), s)
    }
    for (const item of lineItems) {
      const k = normalizePoKey(item.po_number)
      if (!byKey.has(k)) {
        byKey.set(k, { po_number: item.po_number, barcodes: [], documents: [] })
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.po_number.localeCompare(b.po_number, undefined, { numeric: true })
    )
  }, [summaries, lineItems])

  const filtered = searchPo.trim()
    ? displaySummaries.filter((s) =>
        s.po_number.toLowerCase().includes(searchPo.trim().toLowerCase())
      )
    : displaySummaries

  const expandedIpointByPoKey = useMemo(() => {
    const map = new Map<
      string,
      {
        lines: AggregatedPoLineItem[]
        scanned: Set<string>
        labelKeys: string[]
        lineDisplay: ReturnType<typeof buildAggregatedIpointLineDisplayCache>
      }
    >()
    if (ipointLocationIndex.all.length === 0) return map

    for (const summary of filtered) {
      const poKey = summary.po_number.toLowerCase()
      if (!expandedPo.has(poKey)) continue

      const sourceLines = lineItemsForPo(summary.po_number, lineItems)
      if (sourceLines.length === 0) continue

      const lines = aggregateLineItemsForPo(summary.po_number, lineItems)
      const lineDisplay = buildAggregatedIpointLineDisplayCache(
        summary.po_number,
        lines,
        sourceLines,
        jobRefs,
        ipointLocationIndex,
        makeLabelKey
      )
      const labelKeys = lines.flatMap((line) => lineDisplay.get(line.id)?.labelKeys ?? [])
      const scanned = ipointScannedIdsForAggregatedLines(
        lines,
        sourceLines,
        summary.barcodes,
        catalogMap,
        ipointLocationIndex,
        jobRefs
      )

      map.set(poKey, { lines, scanned, labelKeys, lineDisplay })
    }
    return map
  }, [filtered, expandedPo, lineItems, jobRefs, ipointLocationIndex, catalogMap])

  const buildLabelRowsForPo = useCallback(
    (poNumber: string): PoLabelPrintRow[] => {
      const poKey = normalizePoKey(poNumber)
      const poLines = aggregateLineItemsForPo(poNumber, lineItems)
      const sourceLinesForPo = lineItemsForPo(poNumber, lineItems)
      const rows: PoLabelPrintRow[] = []
      const quantityByLineId = new Map<string, number>()

      for (const key of labelSelected) {
        const parsed = parseLabelKey(key)
        if (!parsed || parsed.poKey !== poKey) continue
        const line = findAggregatedLineForLabelKey(
          key,
          poNumber,
          poLines,
          jobRefs,
          itemLocations,
          sourceLinesForPo,
          customerOverrides
        )
        if (!line) continue
        if (!quantityByLineId.has(line.id)) {
          const resolved = resolveAggregatedLine(line, customerOverrides, sourceLinesForPo)
          quantityByLineId.set(line.id, effectiveRequestedQuantity(line, resolved))
        }
        rows.push({
          key,
          po_number: poNumber,
          item_name: line.item_name,
          job_name: displayJobForAggregatedLine(line, customerOverrides),
          location_name: parsed.locationName || null,
        })
      }
      return expandLabelRowsByQuantity(rows, quantityByLineId)
    },
    [lineItems, jobRefs, itemLocations, labelSelected, customerOverrides]
  )

  const handleCustomerSelect = (poNumber: string, itemName: string, jobOrCustomer: string) => {
    setCustomerOverrides(writePoLineCustomerOverride(poNumber, itemName, jobOrCustomer))
  }

  const printLabelRows = async (poNumber: string, rows: PoLabelPrintRow[]) => {
    if (rows.length === 0) {
      setError('Select at least one location to print.')
      return
    }
    const poKey = normalizePoKey(poNumber)
    setPrintingPoKey(poKey)
    setError(null)
    setNotice(null)
    try {
      const result = await printOrQueueLabels(rows)
      setNotice(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Label print failed')
    } finally {
      setPrintingPoKey(null)
    }
  }

  const handlePrintLabels = async (poNumber: string) => {
    const poKey = normalizePoKey(poNumber)
    const rows = buildLabelRowsForPo(poNumber)
    if (rows.length === 0) {
      const hasStaleForPo = [...labelSelected].some((k) => parseLabelKey(k)?.poKey === poKey)
      if (hasStaleForPo) {
        setLabelSelected((prev) => {
          const next = new Set(prev)
          for (const k of prev) {
            if (parseLabelKey(k)?.poKey === poKey) next.delete(k)
          }
          return next
        })
        setError(
          'Print selections are out of date (for example after a PO Line re-import). Re-check the Print boxes, then click Print selected labels again.'
        )
      } else {
        setError('Select at least one iPoint line or location to print.')
      }
      return
    }
    await printLabelRows(poNumber, rows)
  }

  const toggleLabelKey = (key: string) => {
    setLabelSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleLabelSelect = (poNumber: string, line: AggregatedPoLineItem) => {
    const sourceLines = lineItemsForPo(poNumber, lineItems)
    const resolved = resolveAggregatedLine(line, customerOverrides, sourceLines)
    const keys = labelKeysForLine(
      poNumber,
      line,
      jobRefs,
      itemLocations,
      sourceLines,
      resolved.activeSourceLineIds
    )
    const allOn = keys.every((k) => labelSelected.has(k))
    setLabelSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (allOn) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  const toggleAllLabelsForPo = (poNumber: string, lines: AggregatedPoLineItem[]) => {
    const sourceLines = lineItemsForPo(poNumber, lineItems)
    const keys = allLabelKeysForPo(poNumber, lines, jobRefs, itemLocations, sourceLines)
    const allOn = keys.length > 0 && keys.every((k) => labelSelected.has(k))
    setLabelSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (allOn) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  const openLocationModal = (
    poNumber: string,
    line: PoLineItem,
    jobName: string | null,
    locations: string[]
  ) => {
    setLocationModal({ poNumber, line, jobName, locations })
  }

  const closeLocationModal = () => setLocationModal(null)

  const handleLocationModalToggle = (locationName: string) => {
    if (!locationModal) return
    toggleLabelKey(makeLabelKey(locationModal.poNumber, locationModal.line.id, locationName))
  }

  const handleLocationModalToggleAll = (selectAll: boolean) => {
    if (!locationModal) return
    const { poNumber, line, locations } = locationModal
    setLabelSelected((prev) => {
      const next = new Set(prev)
      for (const loc of locations) {
        const k = makeLabelKey(poNumber, line.id, loc)
        if (selectAll) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const handlePrintFromLocationModal = async () => {
    if (!locationModal) return
    const { poNumber, line, jobName, locations } = locationModal
    const baseRows: PoLabelPrintRow[] = locations
      .filter((loc) => labelSelected.has(makeLabelKey(poNumber, line.id, loc)))
      .map((loc) => ({
        key: makeLabelKey(poNumber, line.id, loc),
        po_number: poNumber,
        item_name: line.item_name,
        job_name: jobName,
        location_name: loc,
      }))
    const agg = aggregateLineItemsForPo(poNumber, lineItems).find((l) => l.id === line.id)
    const qty =
      agg != null
        ? effectiveRequestedQuantity(
            agg,
            resolveAggregatedLine(agg, customerOverrides, lineItemsForPo(poNumber, lineItems))
          )
        : 1
    const rows = expandLabelRowsByQuantity(baseRows, new Map([[line.id, qty]]))
    await printLabelRows(poNumber, rows)
  }

  const toggleExpanded = (poNumber: string) => {
    const key = poNumber.toLowerCase()
    setExpandedPo((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleQtyCommit = async (
    poNumber: string,
    barcodeValue: string,
    allBarcodes: POBarcode[],
    currentQty: number,
    draftStr: string
  ) => {
    const n = Math.floor(Number(draftStr))
    if (!Number.isFinite(n) || n < 1) {
      setError('Quantity must be a whole number of at least 1.')
      setQtyEditKey(null)
      return
    }
    if (n === currentQty) {
      setQtyEditKey(null)
      return
    }
    setQtySaving(true)
    setError(null)
    try {
      const po = poNumber.trim()
      const v = barcodeValue.trim()
      const rows = allBarcodes
        .filter((b) => (b.po_number || '').trim() === po && (b.barcode_value || '').trim() === v)
        .sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime())
      if (rows.length !== currentQty) {
        throw new Error('Scan list changed; refresh and try again.')
      }
      if (n < currentQty) {
        const remove = currentQty - n
        const ids = rows.slice(0, remove).map((b) => b.id)
        const { error: e } = await supabase.from('po_barcodes').delete().in('id', ids)
        if (e) throw new Error(e.message)
      } else {
        const add = n - currentQty
        const scanned_at = new Date().toISOString()
        const inserts = Array.from({ length: add }, () => ({
          po_number: po,
          barcode_value: v,
          scanned_at,
        }))
        const { error: e } = await supabase.from('po_barcodes').insert(inserts)
        if (e) throw new Error(e.message)
      }
      setQtyEditKey(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quantity')
    } finally {
      setQtySaving(false)
    }
  }

  const handleDeleteBarcodeIds = async (poNumber: string, barcodeValue: string, ids: string[]) => {
    if (deletingId || ids.length === 0) return
    setDeletingId(ids[0])
    try {
      const { error: e } = await supabase.from('po_barcodes').delete().in('id', ids)
      if (e) throw new Error(e.message)
      const po = poNumber.trim()
      const v = barcodeValue.trim()
      await supabase.from('po_barcode_checkin').delete().match({ po_number: po, barcode_value: v })
      setCheckedInMap((prev) => {
        const next = { ...prev }
        delete next[makeCheckinMapKey(poNumber, barcodeValue)]
        return next
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete barcode')
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleCheckIn = async (poNumber: string, barcodeValue: string, checked: boolean) => {
    const k = makeCheckinMapKey(poNumber, barcodeValue)
    const po = poNumber.trim()
    const v = barcodeValue.trim()
    setCheckinSavingKey(k)
    setError(null)
    try {
      const { error } = await supabase.from('po_barcode_checkin').upsert(
        {
          po_number: po,
          barcode_value: v,
          checked_in: checked,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'po_number,barcode_value' }
      )
      if (error) throw new Error(error.message)
      setCheckedInMap((prev) => {
        const next = { ...prev }
        if (checked) next[k] = true
        else delete next[k]
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update checked-in state')
    } finally {
      setCheckinSavingKey(null)
    }
  }

  const handleToggleAllCheckIn = useCallback(
    async (poNumber: string, rows: AggregatedPOBarcodeRow[]) => {
      const poKey = poNumber.trim().toLowerCase()
      if (rows.length === 0) return
      const allOn = rows.every((r) => Boolean(checkedInMap[makeCheckinMapKey(poNumber, r.barcode_value)]))
      const next = !allOn
      const po = poNumber.trim()
      setBulkCheckinPoKey(poKey)
      setError(null)
      try {
        const results = await Promise.all(
          rows.map((r) =>
            supabase.from('po_barcode_checkin').upsert(
              {
                po_number: po,
                barcode_value: r.barcode_value.trim(),
                checked_in: next,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'po_number,barcode_value' }
            )
          )
        )
        const firstErr = results.find((res) => res.error)?.error
        if (firstErr) throw new Error(firstErr.message)
        setCheckedInMap((prev) => {
          const out = { ...prev }
          for (const r of rows) {
            const k = makeCheckinMapKey(poNumber, r.barcode_value)
            if (next) out[k] = true
            else delete out[k]
          }
          return out
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update checked-in state')
      } finally {
        setBulkCheckinPoKey(null)
      }
    },
    [checkedInMap]
  )

  const handleDeleteDocument = async (doc: PODocument) => {
    if (deletingId) return
    setDeletingId(doc.id)
    try {
      const path = pathFromStorageUrl(doc.file_url, STORAGE_BUCKET)
      if (path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([path])
      }
      const { error: e } = await supabase.from('po_documents').delete().eq('id', doc.id)
      if (e) throw new Error(e.message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteEntirePo = async (poNumber: string) => {
    if (deletingId || !window.confirm(`Delete all barcodes and documents for PO ${poNumber}? This cannot be undone.`)) return
    const key = poNumber.toLowerCase()
    setDeletingId(key)
    try {
      const { error: eb } = await supabase.from('po_barcodes').delete().eq('po_number', poNumber)
      if (eb) throw new Error(eb.message)
      const { error: ec } = await supabase.from('po_barcode_checkin').delete().eq('po_number', poNumber)
      if (ec) throw new Error(ec.message)
      const summary = summaries.find((s) => s.po_number.toLowerCase() === key)
      if (summary) {
        for (const doc of summary.documents) {
          const path = pathFromStorageUrl(doc.file_url, STORAGE_BUCKET)
          if (path) await supabase.storage.from(STORAGE_BUCKET).remove([path])
        }
      }
      const { error: ed } = await supabase.from('po_documents').delete().eq('po_number', poNumber)
      if (ed) throw new Error(ed.message)
      await load()
      setExpandedPo((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete PO')
    } finally {
      setDeletingId(null)
    }
  }

  const openBarcodeLookup = (barcode: string, catalogSeed: BarcodeCatalogItem | null, openCatalogEditor = false) => {
    setLookupOpen({ barcode, catalogSeed, openCatalogEditor })
  }

  const closeBarcodeLookup = () => {
    setLookupOpen(null)
  }

  if (!isConfigured()) {
    return (
      <div className="po-info-page">
        <header className="po-info-header">
          <h1>PO Info</h1>
          <p className="po-info-subtitle">Check-in data from the scanning web app (Supabase)</p>
        </header>
        <div className="po-info-setup">
          <p>Configure Supabase in your <code>.env</code>:</p>
          <pre>{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}</pre>
          <p>Run <code>supabase/schema.sql</code> in the Supabase SQL Editor to create tables.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="po-info-page">
      <header className="po-info-header">
        <h1>PO Info</h1>
        <p className="po-info-subtitle">
          Barcode scans, iPoint file imports, room locations, and Dymo labels per PO. On a tablet, tap{' '}
          <strong>Print selected labels</strong> to queue jobs. On the laptop with the printer, open{' '}
          <Link to="/print-station" className="po-info-inline-link">
            Print Station
          </Link>{' '}
          in this app (same website) and click <strong>Connect printer</strong> once.
        </p>
      </header>

      <PoIpointImportPanel
        jobRefs={jobRefs}
        itemLocations={itemLocations}
        lineItemCount={lineItems.length}
        locationCount={itemLocations.length}
        ipointLoading={ipointLoading}
        onDataChanged={handleIpointDataChanged}
        onError={(msg) => setError(msg || null)}
      />

      <div className="po-info-controls">
        <input
          type="text"
          className="po-info-search"
          placeholder="Filter by PO number..."
          value={searchPo}
          onChange={(e) => setSearchPo(e.target.value)}
        />
        <button
          type="button"
          className="po-info-refresh"
          onClick={() => void load({ force: true })}
          disabled={loading || ipointLoading}
        >
          Refresh
        </button>
      </div>

      {notice && <div className="po-info-notice">{notice}</div>}
      {error && <div className="po-info-error">{error}</div>}

      {ipointLoading && !loading && (
        <p className="po-info-ipoint-loading-banner">
          Loading room locations and PO line report data in the background…
        </p>
      )}

      {loading ? (
        <div className="po-info-loading">Loading PO check-in data…</div>
      ) : filtered.length === 0 ? (
        <div className="po-info-empty">
          <p>
            {searchPo.trim()
              ? 'No POs match your filter.'
              : 'No PO data yet. Import a PO Line Report above, or check in packages with the scanner app.'}
          </p>
        </div>
      ) : (
        <div className="po-info-list">
          {filtered.map((summary) => {
            const key = summary.po_number.toLowerCase()
            const isExpanded = expandedPo.has(key)
            const ipointBundle = expandedIpointByPoKey.get(key)
            const poIpointLines =
              ipointBundle?.lines ?? aggregateLineItemsForPo(summary.po_number, lineItems)
            const ipointScanned = ipointBundle?.scanned ?? new Set<string>()
            const total = summary.barcodes.length + summary.documents.length
            const agg = aggregatePOBarcodeScans(summary.barcodes)
            const ipointLabelKeys =
              ipointBundle?.labelKeys ??
              (isExpanded && ipointLocationIndex.all.length > 0
                ? allLabelKeysForPo(
                    summary.po_number,
                    poIpointLines,
                    jobRefs,
                    itemLocations,
                    lineItemsForPo(summary.po_number, lineItems)
                  )
                : [])
            const allIpointLabelsSelected =
              ipointLabelKeys.length > 0 && ipointLabelKeys.every((k) => labelSelected.has(k))
            const scanSort = poScanSortByKey[key] ?? { column: 'lastScan' as const, asc: false }
            const aggSorted = sortAggregatedRows(agg, catalogMap, scanSort.column, scanSort.asc)
            const scanTotal = summary.barcodes.length
            const unique = agg.length
            const allScanLinesCheckedIn =
              aggSorted.length > 0 &&
              aggSorted.every((r) => checkedInMap[makeCheckinMapKey(summary.po_number, r.barcode_value)])
            const scanTableBusy =
              bulkCheckinPoKey === key ||
              aggSorted.some((r) => r.scan_ids.some((id) => id === deletingId))

            return (
              <div key={key} className="po-info-card">
                <div className="po-info-card-header-row">
                  <button
                    type="button"
                    className="po-info-card-header"
                    onClick={() => toggleExpanded(summary.po_number)}
                    aria-expanded={isExpanded}
                  >
                    <span className="po-info-card-title">PO {summary.po_number}</span>
                    <span className="po-info-card-badge">
                      {[
                        poIpointLines.length > 0 &&
                          `${poIpointLines.length} iPoint line${poIpointLines.length !== 1 ? 's' : ''}`,
                        scanTotal > 0 &&
                          `${unique} barcode${unique !== 1 ? 's' : ''}${
                            scanTotal !== unique ? ` · ${scanTotal} scans` : ''
                          }`,
                        summary.documents.length > 0 &&
                          `${summary.documents.length} doc${summary.documents.length !== 1 ? 's' : ''}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No items'}
                    </span>
                    <span className="po-info-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                  </button>
                  <button
                    type="button"
                    className="po-info-delete-po"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteEntirePo(summary.po_number)
                    }}
                    disabled={!!deletingId}
                    title="Delete entire PO"
                  >
                    {deletingId === key ? '…' : 'Delete PO'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="po-info-card-body">
                    {poIpointLines.length > 0 && (
                      <section className="po-info-section">
                        <div className="po-info-ipoint-lines-header">
                          <h4>iPoint line items</h4>
                          <button
                            type="button"
                            className="po-info-print-labels-btn"
                            disabled={printingPoKey === normalizePoKey(summary.po_number)}
                            onClick={() => void handlePrintLabels(summary.po_number)}
                          >
                            {printingPoKey === normalizePoKey(summary.po_number)
                              ? 'Printing…'
                              : 'Print selected labels'}
                          </button>
                        </div>
                        <p className="po-info-section-desc">
                          From PO Line Report. Req. is the requested quantity for the selected customer (per
                          PDF Req. column). When an item has multiple customers, use the dropdown to pick
                          one. Job/customer shows the PO Line Report name; blank customer means stock.
                          Locations come from the ref
                          spreadsheets (e.g. 4152.xlsx) matched by JobRef + item name. Long location lists show a “+N more” link to
                          open all rooms and pick which labels to print. Printing uses the Req. count (e.g.
                          Req. 3 prints three labels, cycling room names when several locations are selected).
                          On this device with DYMO Connect, labels print here; otherwise they are queued for the
                          Print Station on your laptop.
                        </p>
                        <div className="po-info-scan-table-wrap">
                          <table className="po-info-scan-table po-info-ipoint-table">
                            <thead>
                              <tr>
                                <th scope="col" className="po-info-scan-th-checkin">
                                  <button
                                    type="button"
                                    className="po-info-sort-btn po-info-scan-th-checkin-btn"
                                    title={
                                      allIpointLabelsSelected
                                        ? 'Deselect all for printing'
                                        : 'Select all for printing'
                                    }
                                    onClick={() =>
                                      toggleAllLabelsForPo(summary.po_number, poIpointLines)
                                    }
                                  >
                                    Print
                                  </button>
                                </th>
                                <th scope="col">Item</th>
                                <th scope="col" className="po-info-ipoint-th-scanned">
                                  Scan status
                                </th>
                                <th scope="col">Job / customer</th>
                                <th scope="col">Location</th>
                                <th scope="col" title="Quantity requested (Req. from PO Line Report)">
                                  Req.
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {poIpointLines.map((line) => {
                                const sourceLinesForPo = lineItemsForPo(
                                  summary.po_number,
                                  lineItems
                                )
                                const resolved = resolveAggregatedLine(
                                  line,
                                  customerOverrides,
                                  sourceLinesForPo
                                )
                                const jobDisplay = displayJobForAggregatedLine(
                                  line,
                                  customerOverrides
                                )
                                const sourceById = new Map(
                                  sourceLinesForPo.map((l) => [l.id, l])
                                )
                                const primarySource = resolved.activeSourceLineIds[0]
                                  ? sourceById.get(resolved.activeSourceLineIds[0])
                                  : null
                                const jobRef = primarySource
                                  ? jobNameForLine(primarySource, jobRefs)
                                  : jobNameForLine(line, jobRefs)
                                const lineCached = ipointBundle?.lineDisplay.get(line.id)
                                const lineLocationNames =
                                  resolved.isMultiCustomer && !resolved.selectedCustomer
                                    ? []
                                    : resolved.isMultiCustomer || resolved.selectedCustomer
                                      ? locationNamesForAggregatedLine(
                                          line,
                                          sourceLinesForPo,
                                          jobRefs,
                                          itemLocations,
                                          resolved.activeSourceLineIds
                                        )
                                      : (lineCached?.locationNames ??
                                        (ipointLoading ? [] : []))
                                const lineLabelKeys =
                                  resolved.isMultiCustomer && !resolved.selectedCustomer
                                    ? []
                                    : labelKeysForLine(
                                        summary.po_number,
                                        line,
                                        jobRefs,
                                        itemLocations,
                                        sourceLinesForPo,
                                        resolved.activeSourceLineIds.length > 0
                                          ? resolved.activeSourceLineIds
                                          : undefined
                                      )
                                const selectedCount = lineLabelKeys.filter((k: string) =>
                                  labelSelected.has(k)
                                ).length
                                const allLineLabelsSelected =
                                  lineLabelKeys.length > 0 &&
                                  selectedCount === lineLabelKeys.length
                                const someLineLabelsSelected =
                                  selectedCount > 0 && !allLineLabelsSelected
                                const isScanned = ipointScanned.has(line.id)
                                return (
                                  <tr
                                    key={line.id}
                                    className={
                                      isScanned ? undefined : 'po-info-ipoint-row-not-scanned'
                                    }
                                  >
                                    <td className="po-info-scan-checkin-cell">
                                      <IpointPrintCheckbox
                                        checked={allLineLabelsSelected}
                                        indeterminate={someLineLabelsSelected}
                                        ariaLabel={`Print labels for ${line.item_name}`}
                                        onChange={() =>
                                          toggleLabelSelect(summary.po_number, line)
                                        }
                                      />
                                    </td>
                                    <td className="po-info-scan-item-name">{line.item_name}</td>
                                    <td className="po-info-ipoint-scanned-cell">
                                      {isScanned ? (
                                        <span
                                          className="po-info-ipoint-scanned-yes"
                                          title="A barcode for this item was scanned on this PO"
                                          aria-label="Scanned"
                                        >
                                          ✓ Scanned
                                        </span>
                                      ) : (
                                        <span className="po-info-ipoint-scanned-no">
                                          Not scanned
                                        </span>
                                      )}
                                    </td>
                                    <td className="po-info-meta">
                                      {resolved.isMultiCustomer ? (
                                        <PoLineCustomerSelect
                                          breakdown={line.customerBreakdown}
                                          selectedCustomer={resolved.selectedCustomer}
                                          onSelect={(job) =>
                                            handleCustomerSelect(
                                              summary.po_number,
                                              line.item_name,
                                              job
                                            )
                                          }
                                        />
                                      ) : (
                                        jobDisplay
                                      )}
                                      {jobRef && jobRef !== jobDisplay ? (
                                        <span
                                          className="po-info-jobref-linked"
                                          title="Linked job ref (locations use this when matched)"
                                        >
                                          {' '}
                                          → {jobRef}
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="po-info-meta po-info-ipoint-loc-cell">
                                      <IpointLocationCell
                                        locationNames={lineLocationNames}
                                        onViewAll={() =>
                                          openLocationModal(
                                            summary.po_number,
                                            line,
                                            jobDisplay,
                                            lineLocationNames
                                          )
                                        }
                                      />
                                    </td>
                                    <td className="po-info-meta po-info-ipoint-qty-cell">
                                      {formatRequestedQuantityDisplay(
                                        effectiveRequestedQuantity(line, resolved)
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                    {agg.length > 0 && (
                      <section className="po-info-section">
                        <h4>Barcode scans</h4>
                        <p className="po-info-section-desc">
                          Quantities are stored as separate scans. Click a quantity to add or remove rows for
                          that barcode on this PO.
                        </p>
                        <div className="po-info-scan-table-wrap">
                          <table className="po-info-scan-table">
                            <thead>
                              <tr>
                                <th scope="col">Barcode</th>
                                <th
                                  scope="col"
                                  aria-sort={
                                    scanSort.column === 'item'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'item')}
                                  >
                                    Item
                                    {scanSort.column === 'item' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  aria-sort={
                                    scanSort.column === 'partNumber'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'partNumber')}
                                  >
                                    Part number
                                    {scanSort.column === 'partNumber' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="po-info-scan-th-narrow"
                                  aria-sort={
                                    scanSort.column === 'qty'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'qty')}
                                  >
                                    Qty
                                    {scanSort.column === 'qty' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  aria-sort={
                                    scanSort.column === 'lastScan'
                                      ? scanSort.asc
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className="po-info-sort-btn"
                                    onClick={() => togglePoScanSort(key, 'lastScan')}
                                  >
                                    Last scan
                                    {scanSort.column === 'lastScan' ? (
                                      <span className="po-info-sort-indicator" aria-hidden>
                                        {scanSort.asc ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </th>
                                <th scope="col" className="po-info-scan-th-checkin">
                                  <button
                                    type="button"
                                    className="po-info-sort-btn po-info-scan-th-checkin-btn"
                                    title={
                                      allScanLinesCheckedIn
                                        ? 'Uncheck all lines on this PO'
                                        : 'Check all lines on this PO'
                                    }
                                    disabled={scanTableBusy}
                                    onClick={() => void handleToggleAllCheckIn(summary.po_number, aggSorted)}
                                  >
                                    Checked in
                                  </button>
                                </th>
                                <th scope="col" className="po-info-scan-th-actions" />
                              </tr>
                            </thead>
                            <tbody>
                              {aggSorted.map((row) => {
                                const cat = lookupCatalogItem(catalogMap, row.barcode_value)
                                const deletingRow = row.scan_ids.some((id) => deletingId === id)
                                const qKey = makeQtyEditKey(summary.po_number, row.barcode_value)
                                const editingQty = qtyEditKey === qKey
                                const checkinKey = makeCheckinMapKey(summary.po_number, row.barcode_value)
                                const isCheckedIn = Boolean(checkedInMap[checkinKey])
                                return (
                                  <tr
                                    key={row.barcode_value}
                                    className={isCheckedIn ? 'po-info-scan-row-checked-in' : undefined}
                                  >
                                    <td>
                                      <button
                                        type="button"
                                        className="po-info-scan-barcode-cell po-info-scan-item-clickable"
                                        onClick={() => openBarcodeLookup(row.barcode_value, cat ?? null, false)}
                                        title="Look up or edit catalog"
                                      >
                                        <div className="po-info-barcode-wrap po-info-barcode-wrap--compact">
                                          <Barcode
                                            value={row.barcode_value}
                                            format="CODE128"
                                            displayValue={false}
                                            width={1}
                                            height={22}
                                            margin={0}
                                            background="#fff"
                                            lineColor="#000"
                                          />
                                        </div>
                                        <code className="po-info-scan-code-text">{row.barcode_value}</code>
                                      </button>
                                    </td>
                                    <td className="po-info-scan-item-name">
                                      {cat ? (
                                        <span className="po-info-catalog-name">{cat.item_name}</span>
                                      ) : (
                                        <span className="po-info-no-catalog">—</span>
                                      )}
                                    </td>
                                    <td className="po-info-scan-part-number">
                                      {cat?.part_number?.trim() ? (
                                        <span className="po-info-catalog-part">{cat.part_number}</span>
                                      ) : (
                                        <span className="po-info-no-catalog">—</span>
                                      )}
                                    </td>
                                    <td className="po-info-scan-qty">
                                      {editingQty ? (
                                        <input
                                          ref={qtyInputRef}
                                          type="number"
                                          min={1}
                                          className="po-info-qty-input"
                                          value={qtyDraft}
                                          disabled={qtySaving}
                                          onChange={(e) => setQtyDraft(e.target.value)}
                                          onBlur={(e) =>
                                            void handleQtyCommit(
                                              summary.po_number,
                                              row.barcode_value,
                                              summary.barcodes,
                                              row.quantity,
                                              e.currentTarget.value
                                            )
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              ;(e.target as HTMLInputElement).blur()
                                            }
                                            if (e.key === 'Escape') {
                                              e.preventDefault()
                                              setQtyEditKey(null)
                                            }
                                          }}
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          className="po-info-qty-button"
                                          disabled={!!deletingId || qtySaving}
                                          title="Edit quantity"
                                          onClick={() => {
                                            setQtyEditKey(qKey)
                                            setQtyDraft(String(row.quantity))
                                          }}
                                        >
                                          {row.quantity}
                                        </button>
                                      )}
                                    </td>
                                    <td className="po-info-meta">{formatDateTime(row.last_scanned_at)}</td>
                                    <td className="po-info-scan-checkin-cell">
                                      <input
                                        type="checkbox"
                                        className="po-info-scan-checkin-input"
                                        checked={isCheckedIn}
                                        disabled={
                                          checkinSavingKey === checkinKey ||
                                          deletingRow ||
                                          bulkCheckinPoKey === key
                                        }
                                        aria-label={`Checked in ${row.barcode_value}`}
                                        onChange={(e) =>
                                          void handleToggleCheckIn(
                                            summary.po_number,
                                            row.barcode_value,
                                            e.target.checked
                                          )
                                        }
                                      />
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="po-info-delete-item"
                                        onClick={() =>
                                          handleDeleteBarcodeIds(
                                            summary.po_number,
                                            row.barcode_value,
                                            row.scan_ids
                                          )
                                        }
                                        disabled={!!deletingId}
                                        title="Remove all scans of this barcode for this PO"
                                      >
                                        {deletingRow ? '…' : '✕'}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                    {summary.documents.length > 0 && (
                      <section className="po-info-section">
                        <h4>Documents</h4>
                        <p className="po-info-section-desc">
                          Files from the scanner app. Delete removes the database row and the file from
                          storage when the link points at this project&apos;s bucket.
                        </p>
                        <ul className="po-info-doc-list">
                          {summary.documents.map((d) => (
                            <li key={d.id} className="po-info-doc-item">
                              <a
                                href={d.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="po-info-doc-link"
                              >
                                {d.name || documentTypeLabel(d.document_type)}
                              </a>
                              <span className="po-info-meta">
                                {documentTypeLabel(d.document_type)} · {formatDateTime(d.scanned_at)}
                              </span>
                              <button
                                type="button"
                                className="po-info-delete-item"
                                onClick={() => handleDeleteDocument(d)}
                                disabled={!!deletingId}
                                title="Delete document"
                              >
                                {deletingId === d.id ? '…' : '✕'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {total === 0 && (
                      <p className="po-info-no-items">No scans or documents for this PO yet.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && (
        <section className="po-info-catalog-section">
          <h2 className="po-info-catalog-section-title">Barcode catalog</h2>
          <p className="po-info-section-desc po-info-catalog-section-desc">
            Items you have saved for lookups. Edit opens the same catalog form as from a PO scan.
          </p>
          {catalog.length === 0 ? (
            <p className="po-info-catalog-empty">No catalog entries yet. Look up a barcode from a PO and use &quot;Add to your Catalog&quot;.</p>
          ) : (
            <div className="po-info-catalog-table-wrap">
              <table className="po-info-catalog-table">
                <thead>
                  <tr>
                    <th scope="col">Barcode</th>
                    <th
                      scope="col"
                      aria-sort={
                        catalogSort.column === 'item'
                          ? catalogSort.asc
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="po-info-sort-btn"
                        onClick={() => toggleCatalogSort('item')}
                      >
                        Item
                        {catalogSort.column === 'item' ? (
                          <span className="po-info-sort-indicator" aria-hidden>
                            {catalogSort.asc ? ' ▲' : ' ▼'}
                          </span>
                        ) : null}
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={
                        catalogSort.column === 'partNumber'
                          ? catalogSort.asc
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="po-info-sort-btn"
                        onClick={() => toggleCatalogSort('partNumber')}
                      >
                        Part number
                        {catalogSort.column === 'partNumber' ? (
                          <span className="po-info-sort-indicator" aria-hidden>
                            {catalogSort.asc ? ' ▲' : ' ▼'}
                          </span>
                        ) : null}
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={
                        catalogSort.column === 'manufacturer'
                          ? catalogSort.asc
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="po-info-sort-btn"
                        onClick={() => toggleCatalogSort('manufacturer')}
                      >
                        Manufacturer
                        {catalogSort.column === 'manufacturer' ? (
                          <span className="po-info-sort-indicator" aria-hidden>
                            {catalogSort.asc ? ' ▲' : ' ▼'}
                          </span>
                        ) : null}
                      </button>
                    </th>
                    <th scope="col" className="po-info-catalog-th-actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedCatalog.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code className="po-info-catalog-code">{row.barcode_value}</code>
                      </td>
                      <td className="po-info-catalog-item-cell">{row.item_name}</td>
                      <td className="po-info-catalog-part-cell">
                        {row.part_number?.trim() ? row.part_number : '—'}
                      </td>
                      <td className="po-info-meta">{row.manufacturer || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="po-info-catalog-edit-btn"
                          onClick={() => openBarcodeLookup(row.barcode_value, row, true)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {lookupOpen && (
        <BarcodeLookupModal
          barcodeValue={lookupOpen.barcode}
          catalogSeed={lookupOpen.catalogSeed}
          openCatalogEditor={lookupOpen.openCatalogEditor}
          onClose={closeBarcodeLookup}
          onCatalogSaved={() => void load()}
        />
      )}

      {locationModal && (
        <IpointLocationsModal
          poNumber={locationModal.poNumber}
          line={locationModal.line}
          jobName={locationModal.jobName}
          locations={locationModal.locations}
          selectedLocations={
            new Set(
              locationModal.locations.filter((loc) =>
                labelSelected.has(
                  makeLabelKey(locationModal.poNumber, locationModal.line.id, loc)
                )
              )
            )
          }
          onToggleLocation={handleLocationModalToggle}
          onToggleAll={handleLocationModalToggleAll}
          onPrintSelected={() => void handlePrintFromLocationModal()}
          onClose={closeLocationModal}
          printing={printingPoKey === normalizePoKey(locationModal.poNumber)}
        />
      )}
    </div>
  )
}

export default POInfo
