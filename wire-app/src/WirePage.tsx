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
  activeBoxSummariesForJob,
  buildWireBulkCheckoutInsert,
  buildWireInventoryRows,
  buildWireMaterialsReport,
  buildWireStatusChangeInsert,
  downloadTextFile,
  downloadWireMaterialsReportPdf,
  formatInventoryFtDisplay,
  formatWireJobNameDisplay,
  isBoxInInventory,
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
  /** Active = in warehouse (checked in); inactive = checked out on a job. */
  const [boxListMode, setBoxListMode] = useState<'active' | 'inactive'>('active')
  const [expandedBox, setExpandedBox] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [reportJob, setReportJob] = useState('')
  const [reportRows, setReportRows] = useState<WireReportRow[] | null>(null)
  const [pdfWorking, setPdfWorking] = useState(false)
  const [countEmptyBoxes, setCountEmptyBoxes] = useState(false)
  const [savedReports, setSavedReports] = useState<SavedMaterialsReport[]>([])
  const [savedReportsLoading, setSavedReportsLoading] = useState(false)
  const [reportWorking, setReportWorking] = useState(false)
  const [boxesMenuOpen, setBoxesMenuOpen] = useState(false)
  const [statusWorking, setStatusWorking] = useState(false)
  const [selectedBoxKeys, setSelectedBoxKeys] = useState<Set<string>>(() => new Set())
  const boxesMenuRef = useRef<HTMLDivElement | null>(null)
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
    if (!boxesMenuOpen) return
    const onDoc = (e: Event) => {
      const el = boxesMenuRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setBoxesMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [boxesMenuOpen])

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

  const handleHideWireType = async (preset: WireTypePreset) => {
    if (
      !window.confirm(
        `Hide “${preset.label}” from the dropdown? Existing boxes keep their history.`,
      )
    ) {
      return
    }
    setWireTypesWorking(true)
    setWireTypesMessage(null)
    setError(null)
    try {
      await deactivateWireType(preset.id)
      setWireTypesMessage(`Hidden “${preset.label}”.`)
      await reloadWireTypes()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not hide wire type')
    } finally {
      setWireTypesWorking(false)
    }
  }

  useEffect(() => {
    if (reportJob && !jobOptions.includes(reportJob)) {
      setReportJob('')
      setReportRows(null)
    }
  }, [jobOptions, reportJob])

  useEffect(() => {
    if (!reportJob.trim()) return
    setReportRows((prev) =>
      prev === null
        ? null
        : buildWireMaterialsReport(reportJob.trim(), allScans, {
            countEmptyTossedBoxes: countEmptyBoxes,
          })
    )
  }, [countEmptyBoxes, allScans, reportJob])

  const activeBoxCount = useMemo(
    () => summaries.filter((s) => isBoxInInventory(s.scans)).length,
    [summaries],
  )
  const inactiveBoxCount = useMemo(
    () => summaries.length - activeBoxCount,
    [summaries, activeBoxCount],
  )

  const filtered = useMemo(() => {
    const byStatus = summaries.filter((s) => {
      const active = isBoxInInventory(s.scans)
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
      } catch (saveErr: unknown) {
        setError(
          saveErr instanceof Error
            ? saveErr.message
            : 'Report created but could not save to history.',
        )
      }

      if (countEmptyBoxes) {
        const toDeactivate = activeBoxSummariesForJob(summaries, job)
        if (toDeactivate.length > 0) {
          const payloads = toDeactivate
            .map((s) =>
              buildWireStatusChangeInsert(s, 'inactive', {
                jobName: job,
                footageOverride: '0',
              }),
            )
            .filter((r): r is WireStatusChangeInsertRow => r != null)
            .map((r) => toSupabaseWireInsert({ ...r, scanned_at: new Date().toISOString() }))

          if (payloads.length > 0) {
            const ok = window.confirm(
              `Count empty boxes is on. Mark ${payloads.length} active box${payloads.length !== 1 ? 'es' : ''} used on “${job}” as inactive (checked out at 0 ft)?`,
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
    setReportJob(report.job_name)
    setCountEmptyBoxes(report.count_empty_boxes)
    setReportRows(report.rows)
  }

  const handleDeleteSavedReport = async (id: string) => {
    if (!window.confirm('Delete this saved report?')) return
    setError(null)
    try {
      await deleteMaterialsReport(id)
      setSavedReports((prev) => prev.filter((r) => r.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete saved report')
    }
  }

  const applyBoxStatus = async (
    target: 'active' | 'inactive',
    boxSummaries: WireBoxSummary[],
    options?: { jobName?: string; footageOverride?: string; confirmMessage?: string }
  ) => {
    const payloads: Record<string, string>[] = []
    const skips: string[] = []
    for (const s of boxSummaries) {
      const built = buildWireStatusChangeInsert(s, target, {
        jobName: options?.jobName,
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
          ? `No boxes to update (already ${target}${skips.length ? `: ${skips.slice(0, 5).join(', ')}` : ''}).`
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
    const active = isBoxInInventory(summary.scans)
    const target = active ? 'inactive' : 'active'
    await applyBoxStatus(target, [summary], {
      jobName: active ? reportJob.trim() || undefined : undefined,
      confirmMessage: active
        ? `Mark ${summary.box_id} inactive (check out)?`
        : `Mark ${summary.box_id} active (check in to warehouse)?`,
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
      confirmMessage: 'Set {n} selected box(es) to active (check in to warehouse)?',
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
      jobName: bulkCheckoutJob.trim() || reportJob.trim() || undefined,
      confirmMessage: 'Set {n} selected box(es) to inactive (check out)?',
    })
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
      await loadManagedJobs()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete job')
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
          <h1>Wire Tracker</h1>
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
          <h1>Wire Tracker</h1>
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
          </div>
          {managedJobs.length === 0 ? (
            <div className="wire-jobs-empty">No ongoing jobs added yet.</div>
          ) : (
            <div className="wire-jobs-list">
              {managedJobs.map((job) => (
                <div key={job} className="wire-jobs-item">
                  <span>{job}</span>
                  <button
                    type="button"
                    className="wire-delete-scan"
                    disabled={loading || jobsWorking}
                    onClick={() => void handleDeleteManagedJob(job)}
                  >
                    Delete
                  </button>
                </div>
              ))}
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
                  setReportJob(e.target.value)
                  setReportRows(null)
                }}
                disabled={loading || jobOptions.length === 0}
              >
                <option value="">Select a job…</option>
                {jobOptions.map((j) => (
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
        {reportRows && (
          <div className="wire-report-preview">
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

        <div className="wire-saved-reports" aria-label="Saved materials reports">
          <h3 className="wire-saved-reports-title">Saved reports</h3>
          {savedReportsLoading ? (
            <p className="wire-saved-reports-empty">Loading saved reports…</p>
          ) : savedReports.length === 0 ? (
            <p className="wire-saved-reports-empty">
              No saved reports yet. Create a report to store it here.
            </p>
          ) : (
            <ul className="wire-saved-reports-list">
              {savedReports.map((report) => (
                <li key={report.id} className="wire-saved-reports-item">
                  <div className="wire-saved-reports-meta">
                    <strong>{report.job_name}</strong>
                    <span className="wire-saved-reports-date">
                      {formatDateTime(report.created_at)}
                      {report.count_empty_boxes ? ' · Count empty boxes' : ''}
                    </span>
                  </div>
                  <div className="wire-saved-reports-actions">
                    <button
                      type="button"
                      className="wire-report-secondary"
                      onClick={() => handleOpenSavedReport(report)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="wire-delete-scan"
                      onClick={() => void handleDeleteSavedReport(report.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="wire-types-section" aria-labelledby="wire-types-heading">
        <h2 id="wire-types-heading" className="wire-types-section-title">
          Wire types
        </h2>
        <p className="wire-types-hint">
          Add or hide types shown in the scanner dropdown and the box editor. Hide keeps history on
          boxes already scanned.
        </p>
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
        </div>
        {wireTypesMessage && <div className="wire-types-msg">{wireTypesMessage}</div>}
        {wireTypes.length === 0 ? (
          <div className="wire-jobs-empty">No active wire types.</div>
        ) : (
          <div className="wire-jobs-list">
            {wireTypes.map((preset) => (
              <div key={preset.id} className="wire-jobs-item">
                <span>
                  {preset.label}
                  <span className="wire-types-cap"> · {preset.defaultCapacityFt} ft</span>
                </span>
                <button
                  type="button"
                  className="wire-delete-scan"
                  disabled={loading || wireTypesWorking}
                  onClick={() => void handleHideWireType(preset)}
                >
                  Hide
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="wire-inventory-section" aria-labelledby="wire-inventory-heading">
        <h2 id="wire-inventory-heading" className="wire-inventory-title">
          Wire inventory
        </h2>
        <p className="wire-inventory-hint">
          All boxes currently in the warehouse (checked in). Bars are remaining footage by type; the
          table lists box counts and totals. Check-out removes a box from this stock until it is
          checked back in.
        </p>
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

        {boxListMode === 'active' && (
        <div className="wire-boxes-bulk-bar" role="region" aria-label="Bulk check-out">
          <label className="wire-bulk-checkout-job-label">
            <span>Check out to job</span>
            <select
              className="wire-bulk-checkout-job-select"
              value={bulkCheckoutJob}
              onChange={(e) => setBulkCheckoutJob(e.target.value)}
              disabled={loading || bulkCheckoutWorking || allJobNameSuggestions.length === 0}
            >
              <option value="">Select a job…</option>
              {allJobNameSuggestions.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="wire-bulk-checkout-submit"
            disabled={
              loading ||
              bulkCheckoutWorking ||
              selectedBoxKeys.size === 0 ||
              !bulkCheckoutJob.trim()
            }
            onClick={() => void handleBulkCheckout()}
          >
            {bulkCheckoutWorking
              ? 'Checking out…'
              : `Check out selected (${selectedBoxKeys.size})`}
          </button>
        </div>
        )}

      <div className="wire-controls">
        <input
          type="text"
          className="wire-search"
          placeholder="Filter by box, job, or wire type…"
          value={searchBox}
          onChange={(e) => setSearchBox(e.target.value)}
        />
        <button
          type="button"
          className="wire-toolbar-btn"
          onClick={() => load()}
          disabled={loading}
          title="Reload wire box data from the server"
        >
          Search
        </button>
        {filtered.length > 0 && (
          <button
            type="button"
            className="wire-toolbar-btn"
            onClick={areAllFilteredExpanded ? collapseAllFiltered : expandAllFiltered}
          >
            {areAllFilteredExpanded ? 'Collapse all boxes' : 'Expand all boxes'}
          </button>
        )}
        <div className="wire-boxes-menu" ref={boxesMenuRef}>
          <button
            type="button"
            className="wire-boxes-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={boxesMenuOpen}
            aria-label="Box actions menu"
            disabled={statusWorking || deleting}
            onClick={() => setBoxesMenuOpen((v) => !v)}
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
                Set active
              </button>
              <button
                type="button"
                role="menuitem"
                className="wire-boxes-menu-item"
                disabled={statusWorking || selectedBoxKeys.size === 0}
                onClick={() => void handleMenuSetInactive()}
              >
                Set inactive
              </button>
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
                ? 'No active boxes in the warehouse. Check boxes in with the scanner, or switch to Inactive.'
                : 'No inactive boxes. Checked-out boxes will appear here.'}
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
              const inInventory = isBoxInInventory(summary.scans)
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
                        aria-label={`${summary.box_id}, ${inInventory ? 'active' : 'inactive'}, ${headerWire}, default ${headerDefault}, ${nScans} scan${nScans !== 1 ? 's' : ''}`}
                      >
                      <span
                        className={`wire-box-status-bubble ${inInventory ? 'wire-box-status-active' : 'wire-box-status-inactive'}`}
                        title={inInventory ? 'Active — in warehouse' : 'Inactive — checked out'}
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
                    <button
                      type="button"
                      className={`wire-box-status-toggle ${inInventory ? 'is-active' : 'is-inactive'}`}
                      title={
                        inInventory
                          ? 'Mark inactive (check out)'
                          : 'Mark active (check in to warehouse)'
                      }
                      disabled={deleting || statusWorking}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleToggleBoxStatus(summary)
                      }}
                    >
                      {inInventory ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      type="button"
                      className="wire-delete-box"
                      title="Delete this box and all its scans"
                      disabled={deleting || statusWorking}
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteBox(summary.box_id, summary.scans.length)
                      }}
                    >
                      Delete box
                    </button>
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
