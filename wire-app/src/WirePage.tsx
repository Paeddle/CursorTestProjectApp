import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from 'react'
import { supabase } from './lib/supabase'
import type { WireBoxScan, WireBoxSummary } from './types/wireBox'

function wireScannerHref(): string {
  const configured = import.meta.env.VITE_WIRE_SCANNER_URL?.trim()
  if (configured) return configured.replace(/\/?$/, '/')
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/wire-scanner/`
  }
  return '/wire-scanner/'
}
import {
  buildWireBulkCheckoutInsert,
  buildWireInventoryRows,
  buildWireMaterialsReport,
  buildWireStatusChangeInsert,
  describeRestoreActiveLocation,
  downloadTextFile,
  downloadWireMaterialsReportPdf,
  emptyBoxesToRetireForJob,
  formatInventoryFtDisplay,
  formatWireJobNameDisplay,
  isBoxActive,
  isBoxInInventory,
  isBoxRetired,
  scanIdsToDeleteToRestoreActive,
  isSelectableWireJobName,
  parseFootage,
  reportRowsToCsv,
  reportRowsToHtmlDocument,
  uniqueJobNamesForMaterialsReport,
  uniqueJobNamesFromScans,
  wireTypeIdToLabel,
  wireTypeIdToDefaultFt,
  type WireBulkCheckoutInsertRow,
  type WireReportRow,
  type WireStatusChangeInsertRow,
} from './wireReport'
import { WIRE_TYPE_PRESETS, getWireTypePreset, type WireTypePreset } from './wireTypePresets'
import {
  addWireType,
  deactivateWireType,
  fetchActiveWireTypes,
} from './services/wireTypesService'
import {
  deleteMaterialsReport,
  fetchSavedMaterialsReports,
  saveMaterialsReport,
  type SavedMaterialsReport,
} from './services/materialsReportsService'
import './WirePage.css'

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

function formatCheckType(raw: string | undefined): string {
  if (raw === 'check_out') return 'Check out'
  return 'In warehouse'
}

function normalizeJobNameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function scanTimeMs(scan: WireBoxScan): number {
  return new Date(scan.scanned_at).getTime()
}

/** Chronologically first scan in this box (initial intake). */
function oldestScanInBox(scans: WireBoxScan[]): WireBoxScan | null {
  if (!scans.length) return null
  return scans.reduce((a, b) => (scanTimeMs(a) <= scanTimeMs(b) ? a : b))
}

function isIntakeScan(scan: WireBoxScan, boxScans: WireBoxScan[]): boolean {
  const first = oldestScanInBox(boxScans)
  if (!first) return false
  if (scan.id && first.id) return scan.id === first.id
  return scan.scanned_at === first.scanned_at
}

function formatFootageCell(scan: WireBoxScan): string {
  const cur = parseFootage(scan.current_footage)
  if (cur !== null) return `${cur} ft`
  return (scan.current_footage || '').trim() || '—'
}

function formatWireTypeDisplay(scan: WireBoxScan): string {
  const label = (scan.wire_type_label || '').trim()
  if (label) return label
  return wireTypeIdToLabel(scan.wire_type)
}

/** Newest-first scans: first row with wire type or label wins (box profile). */
function boxHeaderProfileScan(scans: WireBoxScan[]): WireBoxScan | undefined {
  for (const scan of scans) {
    const label = (scan.wire_type_label || '').trim()
    const wt = String(scan.wire_type ?? '').trim()
    if (label || wt) return scan
  }
  return undefined
}

function boxHeaderWireType(scans: WireBoxScan[]): string {
  const s = boxHeaderProfileScan(scans)
  return s ? formatWireTypeDisplay(s) : '—'
}

function boxHeaderDefaultWireDisplay(scans: WireBoxScan[]): string {
  const s = boxHeaderProfileScan(scans)
  if (!s) return '—'
  const raw = (s.spool_capacity_ft || '').trim()
  if (raw) return /ft\.?/i.test(raw) ? raw : `${raw} ft`
  const fromCatalog = wireTypeIdToDefaultFt(s.wire_type)
  if (fromCatalog) return `${fromCatalog} ft`
  return '—'
}

function boxHeaderRemainingFootage(scans: WireBoxScan[]): string {
  if (!scans.length) return '—'
  const newest = scans[0]
  if (!newest) return '—'
  return formatFootageCell(newest)
}

function summaryMatchesWireTypeQuery(summary: WireBoxSummary, q: string): boolean {
  const header = boxHeaderWireType(summary.scans).toLowerCase()
  if (header !== '—' && header.includes(q)) return true
  return summary.scans.some((scan) => {
    const label = (scan.wire_type_label || '').trim().toLowerCase()
    if (label.includes(q)) return true
    const preset = String(scan.wire_type ?? '').trim().toLowerCase()
    if (preset.includes(q)) return true
    const resolved = wireTypeIdToLabel(scan.wire_type).toLowerCase()
    if (resolved !== '—' && resolved.includes(q)) return true
    return false
  })
}

async function fetchAllScans(): Promise<WireBoxScan[]> {
  const { data, error } = await supabase
    .from('wire_box_scans')
    .select('*')
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WireBoxScan[]
}

function toSupabaseWireInsert(
  row: (WireBulkCheckoutInsertRow | WireStatusChangeInsertRow) & { scanned_at: string }
): Record<string, string> {
  const o: Record<string, string> = {
    box_id: row.box_id,
    job_name: row.job_name,
    current_footage: row.current_footage,
    check_type: row.check_type,
    scanned_at: row.scanned_at,
  }
  if (row.wire_type) o.wire_type = row.wire_type
  if (row.wire_type_label) o.wire_type_label = row.wire_type_label
  if (row.spool_capacity_ft) o.spool_capacity_ft = row.spool_capacity_ft
  return o
}

function scansToSummaries(rows: WireBoxScan[]): WireBoxSummary[] {
  const byBox = new Map<string, WireBoxScan[]>()
  for (const row of rows) {
    const box = (row.box_id || '').trim()
    if (!box) continue
    const key = box.toLowerCase()
    if (!byBox.has(key)) byBox.set(key, [])
    byBox.get(key)!.push(row)
  }
  return Array.from(byBox.entries())
    .map(([, scans]) => ({
      box_id: scans[0]!.box_id,
      scans: scans.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()),
    }))
    .sort((a, b) => a.box_id.localeCompare(b.box_id, undefined, { numeric: true }))
}

export function WirePage() {
  const [summaries, setSummaries] = useState<WireBoxSummary[]>([])
  const [allScans, setAllScans] = useState<WireBoxScan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchBox, setSearchBox] = useState('')
  /** Active = warehouse or checked out on a job; inactive = Retired. */
  const [boxListMode, setBoxListMode] = useState<'active' | 'inactive'>('active')
  const [expandedBox, setExpandedBox] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [reportJob, setReportJob] = useState('')
  const [reportRows, setReportRows] = useState<WireReportRow[] | null>(null)
  const [pdfWorking, setPdfWorking] = useState(false)
  const [countEmptyBoxes, setCountEmptyBoxes] = useState(false)
  const [savedReports, setSavedReports] = useState<SavedMaterialsReport[]>([])
  const [savedReportsLoading, setSavedReportsLoading] = useState(false)
  const [savedReportQuery, setSavedReportQuery] = useState('')
  const [openedSavedReportId, setOpenedSavedReportId] = useState<string | null>(null)
  const reportPreviewRef = useRef<HTMLDivElement | null>(null)
  const [reportWorking, setReportWorking] = useState(false)
  const [boxesMenuOpen, setBoxesMenuOpen] = useState(false)
  const [boxesMenuCheckoutOpen, setBoxesMenuCheckoutOpen] = useState(false)
  const [statusWorking, setStatusWorking] = useState(false)
  const [selectedBoxKeys, setSelectedBoxKeys] = useState<Set<string>>(() => new Set())
  const [selectedWireTypeIds, setSelectedWireTypeIds] = useState<Set<string>>(() => new Set())
  const [wireTypesMenuOpen, setWireTypesMenuOpen] = useState(false)
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(() => new Set())
  const [reportsMenuOpen, setReportsMenuOpen] = useState(false)
  const [selectedManagedJobs, setSelectedManagedJobs] = useState<Set<string>>(() => new Set())
  const [jobsMenuOpen, setJobsMenuOpen] = useState(false)
  const [jobSearchOpen, setJobSearchOpen] = useState(false)
  const boxesMenuRef = useRef<HTMLDivElement | null>(null)
  const wireTypesMenuRef = useRef<HTMLDivElement | null>(null)
  const reportsMenuRef = useRef<HTMLDivElement | null>(null)
  const jobsMenuRef = useRef<HTMLDivElement | null>(null)
  const jobSearchRef = useRef<HTMLDivElement | null>(null)
  const [bulkCheckoutJob, setBulkCheckoutJob] = useState('')
  const [bulkCheckoutWorking, setBulkCheckoutWorking] = useState(false)
  const [managedJobs, setManagedJobs] = useState<string[]>([])
  const [newManagedJob, setNewManagedJob] = useState('')
  const [jobsWorking, setJobsWorking] = useState(false)
  const [editingTypeBoxKey, setEditingTypeBoxKey] = useState<string | null>(null)
  const [updatingTypeBoxKey, setUpdatingTypeBoxKey] = useState<string | null>(null)
  const [wireTypes, setWireTypes] = useState<WireTypePreset[]>(() =>
    [...WIRE_TYPE_PRESETS].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    ),
  )
  const [wireTypesWorking, setWireTypesWorking] = useState(false)
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [newTypeCapacity, setNewTypeCapacity] = useState('1000')
  const [wireTypesMessage, setWireTypesMessage] = useState<string | null>(null)
  const selectionAnchorIndexRef = useRef<number | null>(null)

  const jobOptions = useMemo(() => uniqueJobNamesForMaterialsReport(allScans), [allScans])
  const reportJobSelectOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const add = (name: string) => {
      const t = name.trim()
      if (!t) return
      const key = t.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push(t)
    }
    for (const j of jobOptions) add(j)
    if (reportJob) add(reportJob)
    for (const r of savedReports) add(r.job_name)
    return out
  }, [jobOptions, reportJob, savedReports])
  const filteredSavedReports = useMemo(() => {
    const q = savedReportQuery.trim().toLowerCase()
    if (!q) return savedReports
    return savedReports.filter((report) => {
      const hay = [
        report.job_name,
        formatDateTime(report.created_at),
        report.count_empty_boxes ? 'count empty boxes' : '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [savedReports, savedReportQuery])
  const openedSavedReport = useMemo(
    () => savedReports.find((r) => r.id === openedSavedReportId) ?? null,
    [savedReports, openedSavedReportId],
  )
  const allJobNameSuggestions = useMemo(() => {
    const merged = new Set<string>()
    for (const j of managedJobs) {
      if (isSelectableWireJobName(j)) merged.add(j)
    }
    for (const j of uniqueJobNamesFromScans(allScans)) {
      if (isSelectableWireJobName(j)) merged.add(j)
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b))
  }, [allScans, managedJobs])

  const inventoryRows = useMemo(() => buildWireInventoryRows(summaries), [summaries])

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true)
    }
    setError(null)
    try {
      const rows = await fetchAllScans()
      setAllScans(rows)
      setSummaries(scansToSummaries(rows))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load wire box data')
    } finally {
      if (!opts?.silent) {
        setLoading(false)
      }
    }
  }, [])

  const loadManagedJobs = useCallback(async () => {
    try {
      const { data, error: qErr } = await supabase
        .from('wire_jobs')
        .select('name, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (qErr) throw qErr
      const names = (data ?? [])
        .map((r) => (typeof r.name === 'string' ? r.name.trim() : ''))
        .filter(isSelectableWireJobName)
      setManagedJobs(names)
    } catch {
      setManagedJobs([])
    }
  }, [])

  const loadSavedReports = useCallback(async () => {
    setSavedReportsLoading(true)
    try {
      const list = await fetchSavedMaterialsReports()
      setSavedReports(list)
    } catch (e: unknown) {
      console.warn(e)
      setSavedReports([])
    } finally {
      setSavedReportsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isConfigured()) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
      setLoading(false)
      return
    }
    load()
  }, [load])

  useEffect(() => {
    if (!isConfigured()) return
    void loadManagedJobs()
  }, [loadManagedJobs])

  useEffect(() => {
    if (!isConfigured()) return
    void loadSavedReports()
  }, [loadSavedReports])

  useEffect(() => {
    if (!boxesMenuOpen && !wireTypesMenuOpen && !reportsMenuOpen && !jobsMenuOpen && !jobSearchOpen) {
      return
    }
    const onDoc = (e: Event) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (boxesMenuOpen && boxesMenuRef.current && !boxesMenuRef.current.contains(t)) {
        setBoxesMenuOpen(false)
        setBoxesMenuCheckoutOpen(false)
      }
      if (wireTypesMenuOpen && wireTypesMenuRef.current && !wireTypesMenuRef.current.contains(t)) {
        setWireTypesMenuOpen(false)
      }
      if (reportsMenuOpen && reportsMenuRef.current && !reportsMenuRef.current.contains(t)) {
        setReportsMenuOpen(false)
      }
      if (jobsMenuOpen && jobsMenuRef.current && !jobsMenuRef.current.contains(t)) {
        setJobsMenuOpen(false)
      }
      if (jobSearchOpen && jobSearchRef.current && !jobSearchRef.current.contains(t)) {
        setJobSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [boxesMenuOpen, wireTypesMenuOpen, reportsMenuOpen, jobsMenuOpen, jobSearchOpen])

  useEffect(() => {
    if (!isConfigured()) return
    let cancelled = false
    ;(async () => {
      const list = await fetchActiveWireTypes()
      if (!cancelled) setWireTypes(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const reloadWireTypes = useCallback(async () => {
    const list = await fetchActiveWireTypes()
    setWireTypes(list)
  }, [])

  const handleAddWireType = async () => {
    setWireTypesWorking(true)
    setWireTypesMessage(null)
    setError(null)
    try {
      const capacity = Number(String(newTypeCapacity).replace(/,/g, '').trim())
      const created = await addWireType({
        label: newTypeLabel,
        defaultCapacityFt: capacity,
      })
      setNewTypeLabel('')
      setNewTypeCapacity('1000')
      setWireTypesMessage(`Added “${created.label}”.`)
      await reloadWireTypes()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add wire type')
    } finally {
      setWireTypesWorking(false)
    }
  }

  const handleHideSelectedWireTypes = async () => {
    const selected = wireTypes.filter((p) => selectedWireTypeIds.has(p.id))
    if (selected.length === 0) {
      setError('Select one or more wire types to hide.')
      setWireTypesMenuOpen(false)
      return
    }
    if (
      !window.confirm(
        `Hide ${selected.length} wire type${selected.length !== 1 ? 's' : ''} from the dropdown? Existing boxes keep their history.`,
      )
    ) {
      return
    }
    setWireTypesWorking(true)
    setWireTypesMessage(null)
    setError(null)
    setWireTypesMenuOpen(false)
    try {
      for (const preset of selected) {
        await deactivateWireType(preset.id)
      }
      setWireTypesMessage(
        selected.length === 1
          ? `Hidden “${selected[0]!.label}”.`
          : `Hidden ${selected.length} wire types.`,
      )
      setSelectedWireTypeIds(new Set())
      await reloadWireTypes()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not hide wire type')
    } finally {
      setWireTypesWorking(false)
    }
  }

  useEffect(() => {
    if (!reportJob) return
    if (openedSavedReportId) return
    if (reportJobSelectOptions.includes(reportJob)) return
    setReportJob('')
    setReportRows(null)
  }, [reportJob, reportJobSelectOptions, openedSavedReportId])

  useEffect(() => {
    if (openedSavedReportId) return
    if (!reportJob.trim()) return
    setReportRows((prev) =>
      prev === null
        ? null
        : buildWireMaterialsReport(reportJob.trim(), allScans, {
            countEmptyTossedBoxes: countEmptyBoxes,
          }),
    )
  }, [countEmptyBoxes, allScans, reportJob, openedSavedReportId])

  const activeBoxCount = useMemo(
    () => summaries.filter((s) => isBoxActive(s.scans)).length,
    [summaries],
  )
  const inactiveBoxCount = useMemo(
    () => summaries.filter((s) => isBoxRetired(s.scans)).length,
    [summaries],
  )

  const jobSearchSuggestions = useMemo(() => {
    const q = searchBox.trim().toLowerCase()
    const list = allJobNameSuggestions
    if (!q) return list.slice(0, 12)
    return list.filter((j) => j.toLowerCase().includes(q)).slice(0, 12)
  }, [allJobNameSuggestions, searchBox])

  const filtered = useMemo(() => {
    const byStatus = summaries.filter((s) => {
      const active = isBoxActive(s.scans)
      return boxListMode === 'active' ? active : !active
    })
    const q = searchBox.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter((s) => {
      if (s.box_id.toLowerCase().includes(q)) return true
      if (s.scans.some((scan) => {
        const job = (scan.job_name || '').toLowerCase()
        if (job.includes(q)) return true
        return formatWireJobNameDisplay(scan.job_name).toLowerCase().includes(q)
      })) return true
      if (summaryMatchesWireTypeQuery(s, q)) return true
      return false
    })
  }, [summaries, searchBox, boxListMode])

  const filteredBoxKeys = useMemo(
    () => filtered.map((s) => s.box_id.toLowerCase()),
    [filtered]
  )
  const areAllFilteredExpanded = useMemo(
    () => filteredBoxKeys.length > 0 && filteredBoxKeys.every((k) => expandedBox.has(k)),
    [filteredBoxKeys, expandedBox]
  )

  useEffect(() => {
    const allowed = new Set(filtered.map((s) => s.box_id.toLowerCase()))
    setSelectedBoxKeys((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const k of prev) {
        if (allowed.has(k)) next.add(k)
        else changed = true
      }
      if (!changed && next.size === prev.size) return prev
      return next
    })
  }, [filtered])

  const toggleExpanded = (boxId: string) => {
    const key = boxId.toLowerCase()
    setExpandedBox((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandAllFiltered = () => {
    setExpandedBox((prev) => {
      const next = new Set(prev)
      for (const key of filteredBoxKeys) next.add(key)
      return next
    })
  }

  const collapseAllFiltered = () => {
    setExpandedBox((prev) => {
      const next = new Set(prev)
      for (const key of filteredBoxKeys) next.delete(key)
      return next
    })
  }

  const deleteScan = async (scan: WireBoxScan) => {
    if (
      !window.confirm(
        `Delete this scan for ${scan.box_id} (${formatCheckType(scan.check_type)}, ${formatWireJobNameDisplay(scan.job_name)})?`
      )
    ) {
      return
    }
    if (!scan.id) {
      setError('Cannot delete: this row has no id. Refresh and try again.')
      return
    }
    setDeleting(true)
    setError(null)
    try {
      const { data, error: delErr } = await supabase
        .from('wire_box_scans')
        .delete()
        .eq('id', scan.id)
        .select('id')
      if (delErr) throw new Error(delErr.message)
      if (!data?.length) {
        throw new Error(
          'No row was deleted. In Supabase, run supabase/fix-wire-box-scans-delete-rls.sql (RLS must allow delete for your JWT role).'
        )
      }
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete scan')
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateReport = async () => {
    const job = reportJob.trim()
    if (!job) return
    setReportWorking(true)
    setError(null)
    try {
      const rows = buildWireMaterialsReport(job, allScans, {
        countEmptyTossedBoxes: countEmptyBoxes,
      })
      setReportRows(rows)

      try {
        const saved = await saveMaterialsReport({
          jobName: job,
          countEmptyBoxes,
          rows,
        })
        setSavedReports((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)])
        setOpenedSavedReportId(saved.id)
      } catch (saveErr: unknown) {
        setError(
          saveErr instanceof Error
            ? saveErr.message
            : 'Report created but could not save to history.',
        )
      }

      if (countEmptyBoxes) {
        const toRetire = emptyBoxesToRetireForJob(summaries, job)
        if (toRetire.length > 0) {
          const payloads = toRetire
            .map((s) =>
              buildWireStatusChangeInsert(s, 'inactive', {
                footageOverride: '0',
              }),
            )
            .filter((r): r is WireStatusChangeInsertRow => r != null)
            .map((r) => toSupabaseWireInsert({ ...r, scanned_at: new Date().toISOString() }))

          if (payloads.length > 0) {
            const ok = window.confirm(
              `Count empty boxes is on. Move ${payloads.length} emptied box${payloads.length !== 1 ? 'es' : ''} from “${job}” to Retired (inactive)?`,
            )
            if (ok) {
              const { error: insErr } = await supabase.from('wire_box_scans').insert(payloads)
              if (insErr) throw new Error(insErr.message)
              setSelectedBoxKeys(new Set())
              await load({ silent: true })
            }
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create report')
    } finally {
      setReportWorking(false)
    }
  }

  const handleOpenSavedReport = (report: SavedMaterialsReport) => {
    setOpenedSavedReportId(report.id)
    setReportJob(report.job_name)
    setCountEmptyBoxes(report.count_empty_boxes)
    setReportRows(report.rows)
    window.setTimeout(() => {
      reportPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 0)
  }

  const handleDeleteSavedReports = async (ids: string[]) => {
    if (ids.length === 0) {
      setError('Select one or more saved reports to delete.')
      setReportsMenuOpen(false)
      return
    }
    if (
      !window.confirm(
        `Delete ${ids.length} saved report${ids.length !== 1 ? 's' : ''}? This cannot be undone.`,
      )
    ) {
      return
    }
    setError(null)
    setReportsMenuOpen(false)
    try {
      for (const id of ids) {
        await deleteMaterialsReport(id)
      }
      setSavedReports((prev) => prev.filter((r) => !ids.includes(r.id)))
      setSelectedReportIds(new Set())
      if (openedSavedReportId && ids.includes(openedSavedReportId)) {
        setOpenedSavedReportId(null)
        setReportRows(null)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete saved report')
    }
  }

  const applyBoxStatus = async (
    target: 'active' | 'inactive',
    boxSummaries: WireBoxSummary[],
    options?: { footageOverride?: string; confirmMessage?: string }
  ) => {
    if (target === 'active') {
      const scanIds: string[] = []
      const skips: string[] = []
      let restoreCount = 0
      for (const s of boxSummaries) {
        const ids = scanIdsToDeleteToRestoreActive(s.scans)
        if (ids.length === 0) {
          skips.push(s.box_id)
          continue
        }
        restoreCount += 1
        scanIds.push(...ids)
      }
      if (scanIds.length === 0) {
        setError(
          skips.length
            ? `No boxes to restore (already active: ${skips.slice(0, 5).join(', ')}).`
            : 'No boxes to restore to Active.',
        )
        return
      }
      if (
        options?.confirmMessage &&
        !window.confirm(options.confirmMessage.replace('{n}', String(restoreCount)))
      ) {
        return
      }
      setStatusWorking(true)
      setError(null)
      setBoxesMenuOpen(false)
      setBoxesMenuCheckoutOpen(false)
      try {
        const { data, error: delErr } = await supabase
          .from('wire_box_scans')
          .delete()
          .in('id', scanIds)
          .select('id')
        if (delErr) throw new Error(delErr.message)
        if (!data?.length) {
          throw new Error(
            'No Retired scans were deleted. Check RLS delete policy (supabase/fix-wire-box-scans-delete-rls.sql).',
          )
        }
        setSelectedBoxKeys(new Set())
        selectionAnchorIndexRef.current = null
        await load({ silent: true })
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to restore boxes to Active')
      } finally {
        setStatusWorking(false)
      }
      return
    }

    const payloads: Record<string, string>[] = []
    const skips: string[] = []
    for (const s of boxSummaries) {
      const built = buildWireStatusChangeInsert(s, target, {
        footageOverride: options?.footageOverride,
      })
      if (!built) {
        skips.push(s.box_id)
        continue
      }
      payloads.push(toSupabaseWireInsert({ ...built, scanned_at: new Date().toISOString() }))
    }
    if (payloads.length === 0) {
      setError(
        skips.length
          ? `No boxes to update (already ${target}: ${skips.slice(0, 5).join(', ')}).`
          : `No boxes to mark ${target}.`,
      )
      return
    }
    if (
      options?.confirmMessage &&
      !window.confirm(options.confirmMessage.replace('{n}', String(payloads.length)))
    ) {
      return
    }
    setStatusWorking(true)
    setError(null)
    setBoxesMenuOpen(false)
    setBoxesMenuCheckoutOpen(false)
    try {
      const { error: insErr } = await supabase.from('wire_box_scans').insert(payloads)
      if (insErr) throw new Error(insErr.message)
      setSelectedBoxKeys(new Set())
      selectionAnchorIndexRef.current = null
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Failed to set boxes ${target}`)
    } finally {
      setStatusWorking(false)
    }
  }

  const handleToggleBoxStatus = async (summary: WireBoxSummary) => {
    const active = isBoxActive(summary.scans)
    const target = active ? 'inactive' : 'active'
    await applyBoxStatus(target, [summary], {
      footageOverride: active ? '0' : undefined,
      confirmMessage: active
        ? `Retire ${summary.box_id} (move to Inactive / Retired)?`
        : `Restore ${summary.box_id} to Active by undoing Retired (back to ${describeRestoreActiveLocation(summary.scans)})?`,
    })
  }

  const handleMenuSetActive = async () => {
    const selected = summaries.filter((s) => selectedBoxKeys.has(s.box_id.toLowerCase()))
    if (selected.length === 0) {
      setError('Select one or more boxes first.')
      setBoxesMenuOpen(false)
      return
    }
    await applyBoxStatus('active', selected, {
      confirmMessage:
        'Restore {n} selected box(es) to Active by undoing Retired (back to each box\'s last check-in or check-out)?',
    })
  }

  const handleMenuSetInactive = async () => {
    const selected = summaries.filter((s) => selectedBoxKeys.has(s.box_id.toLowerCase()))
    if (selected.length === 0) {
      setError('Select one or more boxes first.')
      setBoxesMenuOpen(false)
      return
    }
    await applyBoxStatus('inactive', selected, {
      footageOverride: '0',
      confirmMessage: 'Retire {n} selected box(es) to Inactive?',
    })
  }

  const handleMenuDeleteBoxes = async () => {
    const selected = summaries.filter((s) => selectedBoxKeys.has(s.box_id.toLowerCase()))
    if (selected.length === 0) {
      setError('Select one or more boxes to delete.')
      setBoxesMenuOpen(false)
      return
    }
    const totalScans = selected.reduce((n, s) => n + s.scans.length, 0)
    if (
      !window.confirm(
        `Delete ${selected.length} box${selected.length !== 1 ? 'es' : ''} and ${totalScans} scan${totalScans !== 1 ? 's' : ''}? This cannot be undone.`,
      )
    ) {
      setBoxesMenuOpen(false)
      return
    }
    setDeleting(true)
    setError(null)
    setBoxesMenuOpen(false)
    try {
      for (const s of selected) {
        const { data, error: delErr } = await supabase
          .from('wire_box_scans')
          .delete()
          .eq('box_id', s.box_id)
          .select('id')
        if (delErr) throw new Error(delErr.message)
        if (!data?.length) {
          throw new Error(
            `No rows deleted for ${s.box_id}. Check RLS delete policy (supabase/fix-wire-box-scans-delete-rls.sql).`,
          )
        }
      }
      setSelectedBoxKeys(new Set())
      selectionAnchorIndexRef.current = null
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete boxes')
    } finally {
      setDeleting(false)
    }
  }

  const handleMenuCheckoutToJob = async (jobName: string) => {
    const job = jobName.trim()
    if (!job) return
    const selectedSummaries = summaries.filter(
      (s) => selectedBoxKeys.has(s.box_id.toLowerCase()) && isBoxInInventory(s.scans),
    )
    if (selectedSummaries.length === 0) {
      setError('Select at least one warehouse (checked-in) box to check out.')
      setBoxesMenuOpen(false)
      setBoxesMenuCheckoutOpen(false)
      return
    }
    setBulkCheckoutJob(job)
    const skips: string[] = []
    const payloads: Record<string, string>[] = []
    for (const s of selectedSummaries) {
      const built = buildWireBulkCheckoutInsert(s, job)
      if (!built) {
        skips.push(s.box_id)
        continue
      }
      payloads.push(toSupabaseWireInsert({ ...built, scanned_at: new Date().toISOString() }))
    }
    if (skips.length > 0) {
      setError(
        `Cannot check out: ${skips.join(', ')} — each box must be in the warehouse with footage on its latest scan.`,
      )
      return
    }
    if (
      !window.confirm(
        `Check out ${payloads.length} box${payloads.length !== 1 ? 'es' : ''} to “${job}”?`,
      )
    ) {
      return
    }
    setBulkCheckoutWorking(true)
    setError(null)
    setBoxesMenuOpen(false)
    setBoxesMenuCheckoutOpen(false)
    try {
      const { error: insErr } = await supabase.from('wire_box_scans').insert(payloads)
      if (insErr) throw new Error(insErr.message)
      const jobKey = normalizeJobNameKey(job)
      const { error: jobErr } = await supabase.from('wire_jobs').upsert(
        { name: job, name_key: jobKey, is_active: true },
        { onConflict: 'name_key' },
      )
      if (jobErr) throw new Error(jobErr.message)
      setSelectedBoxKeys(new Set())
      selectionAnchorIndexRef.current = null
      await loadManagedJobs()
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bulk check out failed')
    } finally {
      setBulkCheckoutWorking(false)
    }
  }

  const selectAllFilteredBoxes = () => {
    setSelectedBoxKeys(new Set(filteredBoxKeys))
  }

  const clearSelectedBoxes = () => {
    setSelectedBoxKeys(new Set())
    selectionAnchorIndexRef.current = null
  }

  const safeReportFileStem = () =>
    reportJob.trim().replace(/[^\w\- ./()]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'job'

  const handleDownloadCsv = () => {
    if (!reportRows || !reportJob.trim()) return
    const csv = reportRowsToCsv(reportJob.trim(), reportRows)
    downloadTextFile(`wire-materials-${safeReportFileStem()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const handleDownloadHtml = () => {
    if (!reportRows || !reportJob.trim()) return
    const html = reportRowsToHtmlDocument(reportJob.trim(), reportRows)
    downloadTextFile(`wire-materials-${safeReportFileStem()}.html`, html, 'text/html;charset=utf-8')
  }

  const handleDownloadPdf = async () => {
    if (!reportRows || !reportJob.trim()) return
    setPdfWorking(true)
    setError(null)
    try {
      await downloadWireMaterialsReportPdf(reportJob.trim(), reportRows, safeReportFileStem())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create PDF')
    } finally {
      setPdfWorking(false)
    }
  }

  const deleteBox = async (boxId: string, scanCount: number) => {
    if (
      !window.confirm(
        `Delete box ${boxId} and all ${scanCount} scan${scanCount !== 1 ? 's' : ''}? This cannot be undone.`
      )
    ) {
      return
    }
    setDeleting(true)
    setError(null)
    try {
      const { data, error: delErr } = await supabase
        .from('wire_box_scans')
        .delete()
        .eq('box_id', boxId)
        .select('id')
      if (delErr) throw new Error(delErr.message)
      if (!data?.length) {
        throw new Error(
          'No rows were deleted. In Supabase, run supabase/fix-wire-box-scans-delete-rls.sql (RLS must allow delete for your JWT role), or check the box ID matches.'
        )
      }
      setExpandedBox((prev) => {
        const next = new Set(prev)
        next.delete(boxId.toLowerCase())
        return next
      })
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete box')
    } finally {
      setDeleting(false)
    }
  }

  const handleBoxCheckboxClick = (
    e: MouseEvent<HTMLButtonElement>,
    indexInFiltered: number,
    boxKey: string,
    canSelect: boolean
  ) => {
    if (!canSelect) return
    e.preventDefault()
    e.stopPropagation()
    if (e.shiftKey && selectionAnchorIndexRef.current !== null) {
      const anchor = selectionAnchorIndexRef.current
      const lo = Math.min(anchor, indexInFiltered)
      const hi = Math.max(anchor, indexInFiltered)
      setSelectedBoxKeys((prev) => {
        const next = new Set(prev)
        for (let i = lo; i <= hi; i++) {
          const s = filtered[i]
          if (s) next.add(s.box_id.toLowerCase())
        }
        return next
      })
    } else {
      setSelectedBoxKeys((prev) => {
        const next = new Set(prev)
        if (next.has(boxKey)) next.delete(boxKey)
        else next.add(boxKey)
        return next
      })
    }
    selectionAnchorIndexRef.current = indexInFiltered
  }

  const handleBulkCheckout = async () => {
    const job = bulkCheckoutJob.trim()
    if (!job || selectedBoxKeys.size === 0) return
    const selectedSummaries = summaries.filter(
      (s) => selectedBoxKeys.has(s.box_id.toLowerCase()) && isBoxInInventory(s.scans),
    )
    if (selectedSummaries.length === 0) {
      setError('Select at least one active (in warehouse) box to check out.')
      return
    }
    const skips: string[] = []
    const payloads: Record<string, string>[] = []
    for (const s of selectedSummaries) {
      const built = buildWireBulkCheckoutInsert(s, job)
      if (!built) {
        skips.push(s.box_id)
        continue
      }
      payloads.push(
        toSupabaseWireInsert({ ...built, scanned_at: new Date().toISOString() })
      )
    }
    if (skips.length > 0) {
      setError(
        `Cannot check out: ${skips.join(', ')} — each box must be in the warehouse (checked in) and have footage on its latest scan.`
      )
      return
    }
    if (
      !window.confirm(
        `Check out ${payloads.length} box${payloads.length !== 1 ? 'es' : ''} to “${job}” using each box’s latest on-hand footage?`
      )
    ) {
      return
    }
    setBulkCheckoutWorking(true)
    setError(null)
    try {
      const { error: insErr } = await supabase.from('wire_box_scans').insert(payloads)
      if (insErr) throw new Error(insErr.message)
      const jobKey = normalizeJobNameKey(job)
      const { error: jobErr } = await supabase.from('wire_jobs').upsert(
        { name: job, name_key: jobKey, is_active: true },
        { onConflict: 'name_key' }
      )
      if (jobErr) throw new Error(jobErr.message)
      setSelectedBoxKeys(new Set())
      selectionAnchorIndexRef.current = null
      await loadManagedJobs()
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bulk check out failed')
    } finally {
      setBulkCheckoutWorking(false)
    }
  }

  const handleAddManagedJob = async () => {
    const name = newManagedJob.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (!isSelectableWireJobName(name)) {
      setError('“Inventory / Warehouse” is reserved for stock and cannot be added as a job.')
      return
    }
    setJobsWorking(true)
    setError(null)
    try {
      const key = normalizeJobNameKey(name)
      const { error: insErr } = await supabase.from('wire_jobs').upsert(
        { name, name_key: key, is_active: true },
        { onConflict: 'name_key' }
      )
      if (insErr) throw new Error(insErr.message)
      setNewManagedJob('')
      await loadManagedJobs()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add job')
    } finally {
      setJobsWorking(false)
    }
  }

  const handleDeleteManagedJob = async (name: string) => {
    const key = normalizeJobNameKey(name)
    if (!window.confirm(`Delete job “${name}”?`)) return
    setJobsWorking(true)
    setError(null)
    try {
      const { error: delErr } = await supabase.from('wire_jobs').delete().eq('name_key', key)
      if (delErr) throw new Error(delErr.message)
      if (reportJob === name) {
        setReportJob('')
        setReportRows(null)
      }
      if (bulkCheckoutJob.trim() === name) setBulkCheckoutJob('')
      setSelectedManagedJobs((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
      await loadManagedJobs()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete job')
    } finally {
      setJobsWorking(false)
    }
  }

  const handleDeleteSelectedManagedJobs = async () => {
    const names = [...selectedManagedJobs]
    if (names.length === 0) {
      setError('Select one or more jobs to delete.')
      setJobsMenuOpen(false)
      return
    }
    if (
      !window.confirm(
        `Delete ${names.length} job${names.length !== 1 ? 's' : ''}? This removes them from the jobs list.`,
      )
    ) {
      return
    }
    setJobsWorking(true)
    setError(null)
    setJobsMenuOpen(false)
    try {
      for (const name of names) {
        const key = normalizeJobNameKey(name)
        const { error: delErr } = await supabase.from('wire_jobs').delete().eq('name_key', key)
        if (delErr) throw new Error(delErr.message)
        if (reportJob === name) {
          setReportJob('')
          setReportRows(null)
        }
        if (bulkCheckoutJob.trim() === name) setBulkCheckoutJob('')
      }
      setSelectedManagedJobs(new Set())
      await loadManagedJobs()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete jobs')
    } finally {
      setJobsWorking(false)
    }
  }

  const handleUpdateBoxWireType = async (summary: WireBoxSummary, presetId: string) => {
    const key = summary.box_id.toLowerCase()
    const trimmedId = presetId.trim()
    if (!trimmedId) return

    const preset = getWireTypePreset(trimmedId, wireTypes)
    if (!preset) {
      setError('Unknown wire type selected.')
      return
    }

    const boxId = summary.box_id.trim()
    if (!boxId) return

    setUpdatingTypeBoxKey(key)
    setError(null)
    try {
      const { data, error: upErr } = await supabase
        .from('wire_box_scans')
        .update({
          wire_type: preset.id,
          wire_type_label: preset.label,
          spool_capacity_ft: String(preset.defaultCapacityFt),
        })
        .eq('box_id', boxId)
        .select('id')

      if (upErr) throw new Error(upErr.message)
      if (!data?.length) {
        throw new Error(
          'Wire type was not saved (no rows updated). Supabase may be missing an UPDATE policy on wire_box_scans. Run supabase/fix-wire-box-scans-update-rls.sql in the SQL Editor, then try again.'
        )
      }

      setEditingTypeBoxKey(null)
      await load({ silent: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update wire type')
    } finally {
      setUpdatingTypeBoxKey(null)
    }
  }

  if (!isConfigured()) {
    return (
      <div className="wire-page">
        <header className="wire-header">
          <h1><a href="/" className="home-title-link">Wire Tracker</a></h1>
        </header>
        <div className="wire-setup">
          <p>Configure Supabase in your <code>.env</code> and run <code>supabase/add-wire-box-scans.sql</code>.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wire-page">
      <header className="wire-header">
        <div className="wire-header-row">
          <h1><a href="/" className="home-title-link">Wire Tracker</a></h1>
          <a className="wire-scanner-link" href={wireScannerHref()} target="_blank" rel="noopener noreferrer">
            Open box scanner
          </a>
        </div>
      </header>

      <section className="wire-report-section" aria-labelledby="wire-report-heading">
        <h2 id="wire-report-heading" className="wire-report-title">
          Materials used report
        </h2>
        <div className="wire-jobs-manager" role="region" aria-label="Existing jobs">
          <div className="wire-jobs-header">Existing Jobs</div>
          <div className="wire-jobs-toolbar">
            <input
              type="text"
              className="wire-jobs-input"
              value={newManagedJob}
              onChange={(e) => setNewManagedJob(e.target.value)}
              placeholder="Add job name…"
              disabled={loading || jobsWorking}
            />
            <button
              type="button"
              className="wire-report-secondary"
              disabled={loading || jobsWorking || !newManagedJob.trim()}
              onClick={() => void handleAddManagedJob()}
            >
              Add job
            </button>
            <div className="wire-section-menu" ref={jobsMenuRef}>
              <button
                type="button"
                className="wire-boxes-menu-trigger"
                aria-haspopup="menu"
                aria-expanded={jobsMenuOpen}
                aria-label="Jobs actions"
                disabled={jobsWorking}
                onClick={() => setJobsMenuOpen((v) => !v)}
              >
                ⋯
              </button>
              {jobsMenuOpen && (
                <div className="wire-boxes-menu-dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="wire-boxes-menu-item"
                    disabled={selectedManagedJobs.size === 0 || jobsWorking}
                    onClick={() => void handleDeleteSelectedManagedJobs()}
                  >
                    Delete Selected
                  </button>
                </div>
              )}
            </div>
          </div>
          {managedJobs.length === 0 ? (
            <div className="wire-jobs-empty">No ongoing jobs added yet.</div>
          ) : (
            <div className="wire-jobs-list">
              {managedJobs.map((job) => {
                const checked = selectedManagedJobs.has(job)
                const disabled = loading || jobsWorking
                return (
                  <div key={job} className="wire-jobs-item wire-inline-select wire-inline-select--end">
                    <span className="wire-jobs-item-label">{job}</span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Select job ${job}`}
                      className={[
                        'wire-card-select',
                        checked ? 'wire-card-select--on' : '',
                        disabled ? 'wire-card-select-disabled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={disabled}
                      onClick={() => {
                        setSelectedManagedJobs((prev) => {
                          const next = new Set(prev)
                          if (next.has(job)) next.delete(job)
                          else next.add(job)
                          return next
                        })
                      }}
                    >
                      <span className="wire-card-select-face" aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="wire-report-toolbar">
          <div className="wire-report-toolbar-main">
            <label className="wire-report-job-label">
              <span>Job</span>
              <select
                className="wire-report-select"
                value={reportJob}
                onChange={(e) => {
                  setOpenedSavedReportId(null)
                  setReportJob(e.target.value)
                  setReportRows(null)
                }}
                disabled={loading || reportJobSelectOptions.length === 0}
              >
                <option value="">Select a job…</option>
                {reportJobSelectOptions.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="wire-report-primary"
              disabled={!reportJob.trim() || loading || reportWorking}
              onClick={() => void handleCreateReport()}
            >
              {reportWorking ? 'Saving…' : 'Create report'}
            </button>
            <button
              type="button"
              className={countEmptyBoxes ? 'wire-report-primary' : 'wire-report-secondary'}
              disabled={loading}
              aria-pressed={countEmptyBoxes}
              onClick={() => setCountEmptyBoxes((v) => !v)}
            >
              Count empty boxes
            </button>
          </div>
          <div className="wire-report-toolbar-downloads">
            <button
              type="button"
              className="wire-report-secondary"
              disabled={!reportRows}
              onClick={handleDownloadCsv}
            >
              Download CSV
            </button>
            <button
              type="button"
              className="wire-report-secondary"
              disabled={!reportRows}
              onClick={handleDownloadHtml}
            >
              Download HTML
            </button>
            <button
              type="button"
              className="wire-report-secondary"
              disabled={!reportRows || pdfWorking}
              onClick={() => void handleDownloadPdf()}
            >
              {pdfWorking ? 'Preparing PDF…' : 'Download PDF'}
            </button>
          </div>
        </div>
        <div className="wire-saved-reports" aria-label="Saved materials reports">
          <div className="wire-section-toolbar">
            <h3 className="wire-saved-reports-title">Saved reports</h3>
            <div className="wire-section-menu" ref={reportsMenuRef}>
              <button
                type="button"
                className="wire-boxes-menu-trigger"
                aria-haspopup="menu"
                aria-expanded={reportsMenuOpen}
                aria-label="Saved reports actions"
                onClick={() => setReportsMenuOpen((v) => !v)}
              >
                ⋯
              </button>
              {reportsMenuOpen && (
                <div className="wire-boxes-menu-dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="wire-boxes-menu-item"
                    disabled={selectedReportIds.size === 0}
                    onClick={() => void handleDeleteSavedReports([...selectedReportIds])}
                  >
                    Delete Selected
                  </button>
                </div>
              )}
            </div>
          </div>
          {savedReportsLoading ? (
            <p className="wire-saved-reports-empty">Loading saved reports…</p>
          ) : savedReports.length === 0 ? (
            <p className="wire-saved-reports-empty">
              No saved reports yet. Create a report to store it here.
            </p>
          ) : (
            <>
              <input
                type="search"
                className="wire-saved-reports-search"
                placeholder="Search saved reports…"
                value={savedReportQuery}
                onChange={(e) => setSavedReportQuery(e.target.value)}
                aria-label="Search saved reports"
              />
              {filteredSavedReports.length === 0 ? (
                <p className="wire-saved-reports-empty">No saved reports match that search.</p>
              ) : (
                <ul className="wire-saved-reports-list">
                  {filteredSavedReports.map((report) => {
                    const checked = selectedReportIds.has(report.id)
                    const isOpen = openedSavedReportId === report.id
                    return (
                      <li
                        key={report.id}
                        className={`wire-saved-reports-item${isOpen ? ' is-open' : ''}`}
                      >
                        <div className="wire-inline-select">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            aria-label={`Select report ${report.job_name}`}
                            className={[
                              'wire-card-select',
                              checked ? 'wire-card-select--on' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => {
                              setSelectedReportIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(report.id)) next.delete(report.id)
                                else next.add(report.id)
                                return next
                              })
                            }}
                          >
                            <span className="wire-card-select-face" aria-hidden="true" />
                          </button>
                          <span className="wire-saved-reports-meta">
                            <strong>{report.job_name}</strong>
                            <span className="wire-saved-reports-date">
                              {formatDateTime(report.created_at)}
                              {report.count_empty_boxes ? ' · Empty' : ''}
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="wire-saved-reports-open"
                          onClick={() => handleOpenSavedReport(report)}
                        >
                          Open
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        {reportRows && (
          <div className="wire-report-preview" ref={reportPreviewRef} id="wire-report-preview">
            {openedSavedReport && (
              <div className="wire-report-preview-caption">
                Opened saved report · {openedSavedReport.job_name} ·{' '}
                {formatDateTime(openedSavedReport.created_at)}
              </div>
            )}
            <table className="wire-report-table">
              <thead>
                <tr>
                  <th>Wire type</th>
                  <th>Start (ft)</th>
                  <th>End (ft)</th>
                  <th>Total used (ft)</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row, i) => (
                  <tr key={`${row.wireType}-${i}`}>
                    <td>{row.wireType}</td>
                    <td className="wire-report-num">{row.startFt === null ? '—' : row.startFt}</td>
                    <td className="wire-report-num">{row.endFt === null ? '—' : row.endFt}</td>
                    <td className="wire-report-num">{row.usedFt === null ? '—' : row.usedFt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="wire-inventory-section" aria-labelledby="wire-inventory-heading">
        <h2 id="wire-inventory-heading" className="wire-inventory-title">
          Wire inventory
        </h2>
        {loading ? (
          <div className="wire-inventory-loading">Loading inventory…</div>
        ) : inventoryRows.length === 0 ? (
          <div className="wire-inventory-empty">No boxes in the warehouse right now.</div>
        ) : (
          <>
            <div
              className="wire-inventory-chart"
              role="img"
              aria-label="Bar chart of remaining footage by wire type"
            >
              {(() => {
                const maxFt = Math.max(...inventoryRows.map((r) => r.totalRemainingFt), 1)
                return inventoryRows.map((row) => {
                  const pct =
                    row.boxesWithUnknownFootage === row.boxCount && row.totalRemainingFt <= 0
                      ? 0
                      : Math.max(2, Math.round((row.totalRemainingFt / maxFt) * 100))
                  return (
                    <div className="wire-inventory-bar-row" key={row.wireType}>
                      <div className="wire-inventory-bar-label" title={row.wireType}>
                        {row.wireType}
                      </div>
                      <div className="wire-inventory-bar-track">
                        <div
                          className="wire-inventory-bar-fill"
                          style={{ width: `${pct}%` }}
                          title={`${formatInventoryFtDisplay(row.totalRemainingFt)} ft`}
                        />
                      </div>
                      <div className="wire-inventory-bar-value">
                        {row.boxesWithUnknownFootage === row.boxCount && row.totalRemainingFt <= 0
                          ? '—'
                          : `${formatInventoryFtDisplay(row.totalRemainingFt)} ft`}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
            <div className="wire-inventory-table-wrap wire-inventory-table-wrap--compact">
              <table className="wire-inventory-table wire-inventory-table--compact">
                <thead>
                  <tr>
                    <th>Wire type</th>
                    <th className="wire-inventory-num">Boxes</th>
                    <th className="wire-inventory-num">Total footage</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((row) => (
                    <tr key={row.wireType}>
                      <td>{row.wireType}</td>
                      <td className="wire-inventory-num">{row.boxCount}</td>
                      <td className="wire-inventory-num wire-inventory-ft-cell">
                        {row.boxesWithUnknownFootage === row.boxCount ? (
                          '—'
                        ) : (
                          <>
                            {formatInventoryFtDisplay(row.totalRemainingFt)} ft
                            {row.boxesWithUnknownFootage > 0 ? (
                              <span
                                className="wire-inventory-ft-gap"
                                title="Footage missing on latest scan"
                              >
                                {' '}
                                (+{row.boxesWithUnknownFootage} no ft)
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="wire-types-section" aria-labelledby="wire-types-heading">
        <h2 id="wire-types-heading" className="wire-types-section-title">
          Wire types
        </h2>
        <div className="wire-types-toolbar">
          <input
            type="text"
            className="wire-jobs-input"
            value={newTypeLabel}
            onChange={(e) => setNewTypeLabel(e.target.value)}
            placeholder="New wire type name…"
            disabled={loading || wireTypesWorking}
          />
          <input
            type="text"
            className="wire-types-capacity-input"
            value={newTypeCapacity}
            onChange={(e) => setNewTypeCapacity(e.target.value)}
            placeholder="Default ft"
            inputMode="numeric"
            disabled={loading || wireTypesWorking}
            aria-label="Default spool feet"
          />
          <button
            type="button"
            className="wire-report-secondary"
            disabled={loading || wireTypesWorking || !newTypeLabel.trim()}
            onClick={() => void handleAddWireType()}
          >
            Add type
          </button>
          <div className="wire-section-menu" ref={wireTypesMenuRef}>
            <button
              type="button"
              className="wire-boxes-menu-trigger"
              aria-haspopup="menu"
              aria-expanded={wireTypesMenuOpen}
              aria-label="Wire types actions"
              disabled={wireTypesWorking}
              onClick={() => setWireTypesMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {wireTypesMenuOpen && (
              <div className="wire-boxes-menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="wire-boxes-menu-item"
                  disabled={selectedWireTypeIds.size === 0 || wireTypesWorking}
                  onClick={() => void handleHideSelectedWireTypes()}
                >
                  Hide Selected
                </button>
              </div>
            )}
          </div>
        </div>
        {wireTypesMessage && <div className="wire-types-msg">{wireTypesMessage}</div>}
        {wireTypes.length === 0 ? (
          <div className="wire-jobs-empty">No active wire types.</div>
        ) : (
          <div className="wire-jobs-list">
            {wireTypes.map((preset) => {
              const checked = selectedWireTypeIds.has(preset.id)
              const disabled = loading || wireTypesWorking
              return (
                <div key={preset.id} className="wire-jobs-item wire-inline-select wire-inline-select--end">
                  <span className="wire-jobs-item-label">
                    {preset.label}
                    <span className="wire-types-cap"> · {preset.defaultCapacityFt} ft</span>
                  </span>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`Select ${preset.label}`}
                    className={[
                      'wire-card-select',
                      checked ? 'wire-card-select--on' : '',
                      disabled ? 'wire-card-select-disabled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={disabled}
                    onClick={() => {
                      setSelectedWireTypeIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(preset.id)) next.delete(preset.id)
                        else next.add(preset.id)
                        return next
                      })
                    }}
                  >
                    <span className="wire-card-select-face" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="wire-boxes-section" aria-labelledby="wire-boxes-heading">
        <div className="wire-boxes-section-nav">
          <h2 id="wire-boxes-heading" className="wire-boxes-section-title">
            Boxes
          </h2>
          <div className="wire-boxes-mode-toggle" role="tablist" aria-label="Box status">
            <button
              type="button"
              role="tab"
              aria-selected={boxListMode === 'active'}
              className={`wire-boxes-mode-btn${boxListMode === 'active' ? ' active' : ''}`}
              onClick={() => setBoxListMode('active')}
            >
              Active
              <span className="wire-boxes-mode-count">{activeBoxCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boxListMode === 'inactive'}
              className={`wire-boxes-mode-btn${boxListMode === 'inactive' ? ' active' : ''}`}
              onClick={() => setBoxListMode('inactive')}
            >
              Inactive
              <span className="wire-boxes-mode-count">{inactiveBoxCount}</span>
            </button>
          </div>
        </div>

        <div className="wire-controls">
          <div className="wire-search-wrap" ref={jobSearchRef}>
            <input
              type="text"
              className="wire-search"
              placeholder="Filter by box, job, or wire type…"
              value={searchBox}
              onChange={(e) => {
                setSearchBox(e.target.value)
                setJobSearchOpen(true)
              }}
              onFocus={() => setJobSearchOpen(true)}
              aria-autocomplete="list"
              aria-expanded={jobSearchOpen}
            />
            <button
              type="button"
              className="wire-search-chevron"
              aria-label="Show job suggestions"
              onClick={() => setJobSearchOpen((v) => !v)}
            >
              ▾
            </button>
            {jobSearchOpen && jobSearchSuggestions.length > 0 && (
              <ul className="wire-search-suggestions" role="listbox">
                {jobSearchSuggestions.map((job) => (
                  <li key={job}>
                    <button
                      type="button"
                      className="wire-search-suggestion"
                      onClick={() => {
                        setSearchBox(job)
                        setJobSearchOpen(false)
                      }}
                    >
                      {job}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="wire-toolbar-btn"
            onClick={() => load()}
            disabled={loading}
            title="Reload wire box data from the server"
          >
            Search
          </button>
          <button
            type="button"
            className="wire-toolbar-btn"
            disabled={filtered.length === 0}
            onClick={selectAllFilteredBoxes}
          >
            Select all
          </button>
          {selectedBoxKeys.size > 0 && (
            <button type="button" className="wire-toolbar-btn" onClick={clearSelectedBoxes}>
              Clear ({selectedBoxKeys.size})
            </button>
          )}
          {filtered.length > 0 && (
            <button
              type="button"
              className="wire-toolbar-btn"
              onClick={areAllFilteredExpanded ? collapseAllFiltered : expandAllFiltered}
            >
              {areAllFilteredExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
          <div className="wire-boxes-menu" ref={boxesMenuRef}>
            <button
              type="button"
              className="wire-boxes-menu-trigger"
              aria-haspopup="menu"
              aria-expanded={boxesMenuOpen}
              aria-label="Box actions menu"
              disabled={statusWorking || deleting || bulkCheckoutWorking}
              onClick={() => {
                setBoxesMenuOpen((v) => !v)
                setBoxesMenuCheckoutOpen(false)
              }}
            >
              ⋯
            </button>
            {boxesMenuOpen && (
              <div className="wire-boxes-menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="wire-boxes-menu-item"
                  disabled={statusWorking || selectedBoxKeys.size === 0}
                  onClick={() => void handleMenuSetActive()}
                >
                  Set Active
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="wire-boxes-menu-item"
                  disabled={statusWorking || selectedBoxKeys.size === 0}
                  onClick={() => void handleMenuSetInactive()}
                >
                  Set Inactive
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="wire-boxes-menu-item wire-boxes-menu-item-danger"
                  disabled={deleting || selectedBoxKeys.size === 0}
                  onClick={() => void handleMenuDeleteBoxes()}
                >
                  Delete Boxes
                </button>
                <div className="wire-boxes-menu-submenu">
                  <button
                    type="button"
                    role="menuitem"
                    className="wire-boxes-menu-item"
                    disabled={
                      bulkCheckoutWorking ||
                      selectedBoxKeys.size === 0 ||
                      allJobNameSuggestions.length === 0
                    }
                    onClick={() => setBoxesMenuCheckoutOpen((v) => !v)}
                  >
                    Check Out To Job ▸
                  </button>
                  {boxesMenuCheckoutOpen && (
                    <div className="wire-boxes-menu-nested" role="menu">
                      {allJobNameSuggestions.map((job) => (
                        <button
                          key={job}
                          type="button"
                          role="menuitem"
                          className="wire-boxes-menu-item"
                          onClick={() => void handleMenuCheckoutToJob(job)}
                        >
                          {job.replace(/\b\w/g, (c) => c.toUpperCase())}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      {error && <div className="wire-error">{error}</div>}

      {loading ? (
        <div className="wire-loading">Loading wire box data…</div>
      ) : filtered.length === 0 ? (
        <div className="wire-empty">
          <p>
            {searchBox.trim()
              ? 'No boxes match your filter.'
              : boxListMode === 'active'
                ? 'No active boxes. Active includes warehouse stock and boxes checked out to jobs.'
                : 'No retired (inactive) boxes yet. Use Set inactive, or Count empty boxes when creating a report.'}
          </p>
        </div>
      ) : (
        <div
          className="wire-list-scroll"
          role="region"
          aria-label={boxListMode === 'active' ? 'Active wire boxes' : 'Inactive wire boxes'}
        >
          <div className="wire-list">
            {filtered.map((summary, indexInFiltered) => {
              const key = summary.box_id.toLowerCase()
              const isExpanded = expandedBox.has(key)
              const profile = boxHeaderProfileScan(summary.scans)
              const currentWireTypeId = String(profile?.wire_type ?? '').trim()
              const showTypeEditor = editingTypeBoxKey === key
              const headerWire = boxHeaderWireType(summary.scans)
              const headerDefault = boxHeaderDefaultWireDisplay(summary.scans)
              const headerRemaining = boxHeaderRemainingFootage(summary.scans)
              const nScans = summary.scans.length
              const boxActive = isBoxActive(summary.scans)
              const inWarehouse = isBoxInInventory(summary.scans)
              return (
                <div key={key} className="wire-card">
                  <div className="wire-card-header-row">
                    <div className="wire-card-header-main">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selectedBoxKeys.has(key)}
                        aria-label={`Select ${summary.box_id}`}
                        className={[
                          'wire-card-select',
                          selectedBoxKeys.has(key) ? 'wire-card-select--on' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title="Select for bulk actions. Shift+click another row to select a range."
                        disabled={deleting || statusWorking}
                        onClick={(e) =>
                          handleBoxCheckboxClick(e, indexInFiltered, key, !(deleting || statusWorking))
                        }
                      >
                        <span className="wire-card-select-face" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="wire-card-header"
                        onClick={() => toggleExpanded(summary.box_id)}
                        aria-expanded={isExpanded}
                        aria-label={`${summary.box_id}, ${boxActive ? 'active' : 'inactive'}, ${headerWire}, default ${headerDefault}, ${nScans} scan${nScans !== 1 ? 's' : ''}`}
                      >
                      <span
                        className={`wire-box-status-bubble ${boxActive ? 'wire-box-status-active' : 'wire-box-status-inactive'}`}
                        title={
                          boxActive
                            ? inWarehouse
                              ? 'Active — in warehouse'
                              : 'Active — checked out to a job'
                            : 'Inactive — retired'
                        }
                        aria-hidden
                      />
                      <span className="wire-card-title-block">
                        <span className="wire-card-title">{summary.box_id}</span>
                        <span className="wire-card-meta-sep" aria-hidden>
                          ·
                        </span>
                        <span className="wire-card-meta">
                          <span
                            className="wire-card-wire-type wire-card-wire-type-editable"
                            role="button"
                            tabIndex={0}
                            title="Click to change wire type"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setEditingTypeBoxKey((prev) => (prev === key ? null : key))
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return
                              e.preventDefault()
                              e.stopPropagation()
                              setEditingTypeBoxKey((prev) => (prev === key ? null : key))
                            }}
                          >
                            {headerWire}
                          </span>
                          <span className="wire-card-meta-sep" aria-hidden>
                            ·
                          </span>
                          <span className="wire-card-default-cap">Default {headerDefault}</span>
                          <span className="wire-card-meta-sep" aria-hidden>
                            ·
                          </span>
                          <span className="wire-card-default-cap">Remaining {headerRemaining}</span>
                          <span className="wire-card-meta-sep" aria-hidden>
                            ·
                          </span>
                          <span className="wire-card-badge">
                            {nScans} scan{nScans !== 1 ? 's' : ''}
                          </span>
                        </span>
                      </span>
                      <span className="wire-card-chevron">{isExpanded ? '▾' : '▸'}</span>
                    </button>
                    </div>
                  </div>
                  {showTypeEditor && (
                    <div className="wire-type-inline-editor">
                      <label className="wire-type-inline-label" htmlFor={`wire-type-edit-${key}`}>
                        Wire type
                      </label>
                      <select
                        id={`wire-type-edit-${key}`}
                        className="wire-type-inline-select"
                        value={currentWireTypeId}
                        disabled={updatingTypeBoxKey === key}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void handleUpdateBoxWireType(summary, e.target.value)}
                      >
                        <option value="">Select wire type…</option>
                        {currentWireTypeId &&
                          !wireTypes.some((p) => p.id === currentWireTypeId) && (
                            <option value={currentWireTypeId}>
                              {headerWire || currentWireTypeId} (hidden from catalog)
                            </option>
                          )}
                        {wireTypes.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {isExpanded && (
                    <div className="wire-card-body">
                      <table className="wire-scans-table">
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>Job / location</th>
                            <th>Footage left</th>
                            <th>Scanned at</th>
                            <th className="wire-actions-col"> </th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.scans.map((scan) => (
                            <tr key={scan.id}>
                              <td>
                                {isIntakeScan(scan, summary.scans) ? (
                                  <span className="wire-check-badge wire-check-intake">Intake</span>
                                ) : (
                                  <span
                                    className={
                                      scan.check_type === 'check_out'
                                        ? 'wire-check-badge wire-check-out'
                                        : 'wire-check-badge wire-check-in'
                                    }
                                  >
                                    {formatCheckType(scan.check_type)}
                                  </span>
                                )}
                              </td>
                              <td>{formatWireJobNameDisplay(scan.job_name)}</td>
                              <td>{formatFootageCell(scan)}</td>
                              <td>{formatDateTime(scan.scanned_at)}</td>
                              <td className="wire-actions-col">
                                <button
                                  type="button"
                                  className="wire-delete-scan"
                                  title="Delete this scan"
                                  disabled={deleting}
                                  onClick={() => deleteScan(scan)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      </section>
    </div>
  )
}
