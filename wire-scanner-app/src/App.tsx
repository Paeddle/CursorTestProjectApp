import { useState, useCallback, useEffect } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import QRScanner from './components/QRScanner'
import {
  WIRE_TYPE_PRESETS,
  getWireTypePreset,
  parseFootageNumber,
  resolveWireTypePreset,
  type WireTypePreset,
} from './wireTypePresets'
import { fetchActiveWireTypes } from './services/wireTypesService'
import './App.css'

/** Same as Tracker warehouse stock: every check-in is stored under this job name. */
const WAREHOUSE_JOB_NAME = 'Inventory'
/** Show the "footage is off" checkbox only for readings above a full spool. */
const FOOTAGE_OFF_ABOVE_FT = 1000
/** Same as Tracker: inactive / retired boxes use this job name and cannot be scanned. */
const RETIRED_JOB_NAME = 'Retired'

function normalizeBoxId(raw: string): string {
  return raw.trim()
}

/** Wire box labels on QR stickers, e.g. BX-0001. */
const BOX_ID_PATTERN = /\b(BX-\d+)\b/i

/**
 * Early sample stickers all encode this same placeholder ID.
 * Scanning many physical boxes with them only ever updates one shared BX-0000 row.
 */
const PLACEHOLDER_BOX_ID = 'BX-0000'
const PLACEHOLDER_STICKER_MESSAGE =
  'This is an old sample sticker (BX-0000). Every one of these stickers uses the same ID, so they do not create real boxes on the Boxes tab. Use a real printed sticker (BX-0001 or higher).'

/** Stickers in rotation use shswebapp.site and/or the DigitalOcean app URL (same ?box= payload). */
const ALLOWED_SCANNER_HOSTS = new Set([
  'shswebapp.site',
  'www.shswebapp.site',
  'cursor-test-project-app-4w9pp.ondigitalocean.app',
])

function isPlaceholderBoxId(id: string): boolean {
  return normalizeBoxId(id).toUpperCase() === PLACEHOLDER_BOX_ID
}

function stripScanValuePrefixes(raw: string): string {
  // Some camera / barcode UIs prepend "URL:" before the decoded payload.
  return raw.trim().replace(/^(URL|URI)\s*:\s*/i, '').trim()
}

function findBoxIdInText(text: string): string | null {
  const match = text.match(BOX_ID_PATTERN)
  if (!match) return null
  // Canonical display form: BX-0001 (keeps digit padding from the QR).
  return `BX-${match[1].slice(3)}`
}

function escapeIlikeExact(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function normalizeJobNameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function isWarehouseJobName(name: string): boolean {
  return normalizeJobNameKey(name) === normalizeJobNameKey(WAREHOUSE_JOB_NAME)
}

function isRetiredJobName(name: string): boolean {
  return normalizeJobNameKey(name) === normalizeJobNameKey(RETIRED_JOB_NAME)
}

function isAllowedScannerHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  if (ALLOWED_SCANNER_HOSTS.has(h)) return true
  if (h.endsWith('.ondigitalocean.app')) return true
  return h === 'localhost' || h === '127.0.0.1'
}

function isWireScannerPath(pathname: string): boolean {
  return /\/wire-scanner\/?/i.test(pathname)
}

function getBoxIdFromQueryOrHash(searchOrHash: string): string | null {
  if (!searchOrHash || !searchOrHash.trim()) return null
  const s = searchOrHash.trim()
  const query = s.startsWith('?') || s.startsWith('#') ? '?' + s.slice(1) : '?' + s
  const params = new URLSearchParams(query)
  const box = params.get('box')
  if (box) {
    return findBoxIdInText(box)
  }
  if (s.startsWith('#') && s.length > 1 && !s.includes('=')) {
    return findBoxIdInText(normalizeBoxId(s.slice(1)))
  }
  return null
}

type StickerScanResult =
  | { status: 'ok'; id: string }
  | { status: 'placeholder' }
  | { status: 'unsupported' }

/** URL wire-scanner stickers on allowed hosts; reject BX-0000 samples and non-URL payloads. */
function classifyScannedSticker(value: string): StickerScanResult {
  const raw = stripScanValuePrefixes(value || '')
  if (!raw) return { status: 'unsupported' }

  if (isPlaceholderBoxId(raw)) return { status: 'placeholder' }

  const looksLikeUrl =
    /^https?:\/\//i.test(raw) || /[/?#].*=/.test(raw) || /\.(app|com|io|net|org|site)\b/i.test(raw)
  if (!looksLikeUrl) return { status: 'unsupported' }

  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`
    const url = new URL(href)
    const id =
      getBoxIdFromQueryOrHash(url.search) ||
      getBoxIdFromQueryOrHash(url.hash) ||
      findBoxIdInText(`${url.pathname}${url.search}${url.hash}`)

    if (id && isPlaceholderBoxId(id)) return { status: 'placeholder' }
    if (!isAllowedScannerHost(url.hostname)) return { status: 'unsupported' }
    if (!isWireScannerPath(url.pathname)) return { status: 'unsupported' }
    if (!id) return { status: 'unsupported' }
    return { status: 'ok', id }
  } catch {
    return { status: 'unsupported' }
  }
}

function getInitialBoxIdFromWindow(): string {
  if (typeof window === 'undefined') return ''
  if (!isAllowedScannerHost(window.location.hostname)) return ''
  const fromSearch = getBoxIdFromQueryOrHash(window.location.search)
  if (fromSearch && !isPlaceholderBoxId(fromSearch)) return fromSearch
  const fromHash = getBoxIdFromQueryOrHash(window.location.hash)
  if (fromHash && !isPlaceholderBoxId(fromHash)) return fromHash
  return ''
}

function initialStickerGateMessage(): string | null {
  if (typeof window === 'undefined') return null
  const fromSearch = getBoxIdFromQueryOrHash(window.location.search)
  const fromHash = getBoxIdFromQueryOrHash(window.location.hash)
  const linkedId = fromSearch || fromHash
  if (!linkedId) return null
  if (isPlaceholderBoxId(linkedId)) return PLACEHOLDER_STICKER_MESSAGE
  return null
}

type CheckType = 'check_in' | 'check_out'

interface BoxProfile {
  wireTypeId: string
  capacityFt: string
  label: string
  remainingFt: string | null
}

interface LastScanInfo {
  jobName: string
  checkType: CheckType
  remainingFt: string | null
  scannedAt: string | null
  note: string | null
}

function formatJobLocationDisplay(jobName: string): string {
  if (isWarehouseJobName(jobName)) return 'Warehouse'
  if (isRetiredJobName(jobName)) return 'Retired'
  return jobName.trim() || '—'
}

function formatLastScanWhen(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [checkType, setCheckType] = useState<CheckType>('check_in')
  const [boxId, setBoxId] = useState(getInitialBoxIdFromWindow)
  const [jobName, setJobName] = useState('')
  const [currentFootage, setCurrentFootage] = useState('')
  const [counterWrong, setCounterWrong] = useState(false)
  const [actualMode, setActualMode] = useState<'' | 'empty' | 'custom'>('')
  const [actualFootage, setActualFootage] = useState('')
  const [jobOptions, setJobOptions] = useState<string[]>([])
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(() => {
    const gate = initialStickerGateMessage()
    return gate ? { type: 'error', message: gate } : null
  })
  const [submitting, setSubmitting] = useState(false)

  const [boxMetaLoading, setBoxMetaLoading] = useState(false)
  /** null = not loaded yet */
  const [hasExistingScans, setHasExistingScans] = useState<boolean | null>(null)
  const [boxProfile, setBoxProfile] = useState<BoxProfile | null>(null)
  const [boxRetired, setBoxRetired] = useState(false)
  const [lastScan, setLastScan] = useState<LastScanInfo | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [spoolCapacityStr, setSpoolCapacityStr] = useState('')

  const [wireTypes, setWireTypes] = useState<WireTypePreset[]>(() =>
    [...WIRE_TYPE_PRESETS].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    ),
  )
  const [wireTypesLoading, setWireTypesLoading] = useState(false)

  useEffect(() => {
    const fromUrl = getInitialBoxIdFromWindow()
    if (fromUrl) setBoxId(fromUrl)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setWireTypesLoading(true)
      try {
        const list = await fetchActiveWireTypes()
        if (!cancelled) setWireTypes(list)
      } finally {
        if (!cancelled) setWireTypesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('wire_jobs')
          .select('name, is_active')
          .eq('is_active', true)
          .order('name', { ascending: true })
        if (error) throw error
        if (cancelled) return
        const names = (data ?? [])
          .map((r) => (typeof r.name === 'string' ? r.name.trim() : ''))
          .filter(
            (n) =>
              n &&
              normalizeJobNameKey(n) !== 'inventory' &&
              !isRetiredJobName(n),
          )
        setJobOptions(names)
      } catch {
        if (!cancelled) setJobOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelectedPresetId('')
    setSpoolCapacityStr('')
    setBoxProfile(null)
    setBoxRetired(false)
    setLastScan(null)
    setHasExistingScans(null)
    setCounterWrong(false)
    setActualMode('')
    setActualFootage('')

    if (!boxId || !supabase) {
      setBoxMetaLoading(false)
      return
    }

    const id = normalizeBoxId(boxId)
    const idMatch = escapeIlikeExact(id)
    let cancelled = false
    setBoxMetaLoading(true)

    ;(async () => {
      try {
        const [countRes, profileRes, latestFirst] = await Promise.all([
          supabase.from('wire_box_scans').select('*', { count: 'exact', head: true }).ilike('box_id', idMatch),
          supabase
            .from('wire_box_scans')
            .select('box_id, wire_type, spool_capacity_ft, wire_type_label, current_footage')
            .ilike('box_id', idMatch)
            .not('spool_capacity_ft', 'is', null)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('wire_box_scans')
            .select(
              'box_id, job_name, check_type, current_footage, wire_type_label, wire_type, spool_capacity_ft, scanned_at, printed_footage, footage_note',
            )
            .ilike('box_id', idMatch)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        let latestRes = latestFirst
        if (latestRes.error && /printed_footage|footage_note/i.test(latestRes.error.message || '')) {
          latestRes = await supabase
            .from('wire_box_scans')
            .select(
              'box_id, job_name, check_type, current_footage, wire_type_label, wire_type, spool_capacity_ft, scanned_at',
            )
            .ilike('box_id', idMatch)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        }

        if (cancelled) return

        if (countRes.error) {
          console.error(countRes.error)
          setHasExistingScans(false)
          setBoxRetired(false)
          setLastScan(null)
        } else {
          setHasExistingScans((countRes.count ?? 0) > 0)
        }

        const latest = latestRes.data as {
          box_id?: string | null
          job_name?: string | null
          check_type?: string | null
          current_footage?: string | null
          wire_type?: string | null
          wire_type_label?: string | null
          spool_capacity_ft?: string | null
          scanned_at?: string | null
          printed_footage?: string | null
          footage_note?: string | null
        } | null
        const storedBoxId = latest?.box_id ? String(latest.box_id).trim() : ''
        // Keep DB casing for future inserts so we don't split one box into two ids.
        if (storedBoxId && storedBoxId !== id) {
          setBoxId(storedBoxId)
        }
        const retired = latest ? isRetiredJobName(String(latest.job_name ?? '')) : false
        setBoxRetired(retired)

        if (latest?.job_name != null || latest?.check_type != null) {
          const ctRaw = String(latest.check_type ?? '').trim().toLowerCase()
          const ct: CheckType = ctRaw === 'check_out' ? 'check_out' : 'check_in'
          const rem = latest.current_footage ? String(latest.current_footage).trim() : ''
          const printed = latest.printed_footage ? String(latest.printed_footage).trim() : ''
          const capRaw = latest.spool_capacity_ft ? String(latest.spool_capacity_ft).trim() : ''
          const typePreset = resolveWireTypePreset(
            latest.wire_type ? String(latest.wire_type).trim() : '',
            wireTypes,
          )
          const capN = typePreset?.defaultCapacityFt ?? parseFootageNumber(capRaw)
          const remN = parseFootageNumber(rem)
          const unreadable = !printed && remN !== null && capN !== null && capN > 0 && remN > capN
          setLastScan({
            jobName: String(latest.job_name ?? '').trim(),
            checkType: ct,
            remainingFt: unreadable ? null : rem || null,
            scannedAt: latest.scanned_at ? String(latest.scanned_at) : null,
            note: unreadable
              ? 'Last counter reading was too high for this spool and is not used.'
              : latest.footage_note
                ? String(latest.footage_note).trim()
                : null,
          })
        } else {
          setLastScan(null)
        }

        const row = (profileRes.data ?? latest) as {
          wire_type: string
          spool_capacity_ft: string
          wire_type_label?: string | null
          current_footage?: string | null
        } | null
        if (row?.wire_type && row?.spool_capacity_ft) {
          const wireRaw = String(row.wire_type).trim()
          const labelRaw = row.wire_type_label ? String(row.wire_type_label).trim() : ''
          const preset =
            resolveWireTypePreset(wireRaw, wireTypes) ??
            (labelRaw ? resolveWireTypePreset(labelRaw, wireTypes) : undefined)
          const storedCap = String(row.spool_capacity_ft).trim()
          const label =
            (row.wire_type_label && String(row.wire_type_label).trim()) ||
            preset?.label ||
            wireRaw
          const capacityFt = preset != null ? String(preset.defaultCapacityFt) : storedCap
          const remainingRaw = row.current_footage ? String(row.current_footage).trim() : ''
          setBoxProfile({
            wireTypeId: preset?.id ?? wireRaw,
            capacityFt,
            label,
            remainingFt: remainingRaw || null,
          })
        } else {
          setBoxProfile(null)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setHasExistingScans(false)
          setBoxProfile(null)
          setBoxRetired(false)
          setLastScan(null)
        }
      } finally {
        if (!cancelled) setBoxMetaLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [boxId, wireTypes])

  useEffect(() => {
    if (boxMetaLoading || hasExistingScans !== false) return
    // New boxes always start as warehouse stock (check-in + Inventory).
    setCheckType('check_in')
    setJobName(WAREHOUSE_JOB_NAME)
  }, [boxMetaLoading, hasExistingScans, boxId])

  useEffect(() => {
    if (checkType === 'check_in') {
      setJobName(WAREHOUSE_JOB_NAME)
      return
    }
    if (isWarehouseJobName(jobName)) {
      setJobName('')
    }
  }, [checkType]) // eslint-disable-line react-hooks/exhaustive-deps -- only react to mode changes

  useEffect(() => {
    if (hasExistingScans !== false || !selectedPresetId) return
    const p = getWireTypePreset(selectedPresetId, wireTypes)
    if (!p) return
    const cap = String(p.defaultCapacityFt)
    setSpoolCapacityStr(cap)
    setCurrentFootage(cap)
  }, [selectedPresetId, hasExistingScans, wireTypes])

  const alreadyCheckedOut =
    !boxRetired &&
    lastScan != null &&
    lastScan.checkType === 'check_out' &&
    !isWarehouseJobName(lastScan.jobName) &&
    !isRetiredJobName(lastScan.jobName)

  /** Latest scan is already a warehouse check-in — cannot check in again until checked out. */
  const alreadyCheckedIn =
    !boxRetired &&
    hasExistingScans === true &&
    lastScan != null &&
    lastScan.checkType === 'check_in' &&
    !isRetiredJobName(lastScan.jobName)

  // Force the only legal next action: in→out, out→in, new box→in.
  useEffect(() => {
    if (boxMetaLoading || boxRetired) return
    if (hasExistingScans === false) {
      setCheckType('check_in')
      return
    }
    if (alreadyCheckedOut) {
      setCheckType('check_in')
      return
    }
    if (alreadyCheckedIn) {
      setCheckType('check_out')
    }
  }, [boxMetaLoading, boxRetired, hasExistingScans, alreadyCheckedOut, alreadyCheckedIn, boxId])

  // Drop placeholder sample stickers (BX-0000) if they somehow get into state.
  useEffect(() => {
    if (!boxId || !isPlaceholderBoxId(boxId)) return
    setBoxId('')
    setStatus({ type: 'error', message: PLACEHOLDER_STICKER_MESSAGE })
  }, [boxId])

  const clearStatus = useCallback(() => setStatus(null), [])

  const showSuccess = (msg: string) => {
    setStatus({ type: 'success', message: msg })
    setTimeout(clearStatus, 5000)
  }

  const showError = (msg: string) => {
    setStatus({ type: 'error', message: msg })
  }

  const persistJobOption = useCallback(async (rawName: string) => {
    if (!supabase) return
    const name = rawName.trim().replace(/\s+/g, ' ')
    if (!name) return
    // Warehouse stock job is not a selectable job entry.
    if (isWarehouseJobName(name)) return
    const jobKey = normalizeJobNameKey(name)
    const { error } = await supabase
      .from('wire_jobs')
      .insert({ name, name_key: jobKey, is_active: true })
    if (error && !/duplicate|unique|already exists/i.test(error.message)) return
    setJobOptions((prev) => {
      if (prev.some((x) => normalizeJobNameKey(x) === jobKey)) return prev
      return [...prev, name].sort((a, b) => a.localeCompare(b))
    })
  }, [])

  const handleQRScanned = useCallback((value: string) => {
    const result = classifyScannedSticker(value)
    if (result.status === 'ok') {
      setBoxId(result.id)
      setShowScanner(false)
      return
    }
    setShowScanner(false)
    if (result.status === 'placeholder') {
      setStatus({ type: 'error', message: PLACEHOLDER_STICKER_MESSAGE })
      return
    }
    setStatus({
      type: 'error',
      message:
        'Could not read a wire-scanner URL from that QR. Use a sticker with the full link (DigitalOcean or shswebapp.site) and a unique BX number — not BX-0000.',
    })
  }, [])

  const buildProfileInsert = (): {
    wire_type?: string
    wire_type_label?: string
    spool_capacity_ft?: string
  } => {
    if (hasExistingScans === false) {
      if (!selectedPresetId) return {}
      const p = getWireTypePreset(selectedPresetId, wireTypes)
      if (!p) return {}
      const cap = String(p.defaultCapacityFt)
      return {
        wire_type: selectedPresetId,
        wire_type_label: p.label,
        spool_capacity_ft: cap,
      }
    }
    if (hasExistingScans === true && boxProfile) {
      return {
        wire_type: boxProfile.wireTypeId,
        wire_type_label: boxProfile.label,
        spool_capacity_ft: boxProfile.capacityFt,
      }
    }
    return {}
  }

  const spoolCapacityNow = (): number | null => {
    if (boxProfile?.capacityFt) {
      const fromBox = parseFootageNumber(boxProfile.capacityFt)
      if (fromBox !== null && fromBox > 0) return fromBox
    }
    if (selectedPresetId) {
      const preset = getWireTypePreset(selectedPresetId, wireTypes)
      if (preset && preset.defaultCapacityFt > 0) return preset.defaultCapacityFt
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      showError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }
    const id = normalizeBoxId(boxId)
    // Check-in = warehouse stock (Inventory). Check-out = out on a real job.
    const job =
      checkType === 'check_in'
        ? WAREHOUSE_JOB_NAME
        : (jobName || '').trim()
    const footage = (currentFootage || '').trim()
    if (!id) {
      showError('Scan a QR code first.')
      return
    }
    if (isPlaceholderBoxId(id)) {
      showError(PLACEHOLDER_STICKER_MESSAGE)
      setBoxId('')
      return
    }
    if (boxRetired) {
      showError(
        'This box is Retired (inactive). No check-in or check-out is allowed. Delete the box in Wire Tracker to reuse this ID.',
      )
      return
    }
    if (hasExistingScans === false) {
      if (checkType === 'check_out') {
        showError('New boxes must be checked in to the warehouse first.')
        return
      }
      if (!selectedPresetId) {
        showError('This box has no scans yet. Choose a wire type to initialize the box.')
        return
      }
      if (!getWireTypePreset(selectedPresetId, wireTypes)) {
        showError('Unknown wire type. Choose a wire type from the list.')
        return
      }
    }
    if (checkType === 'check_in') {
      if (alreadyCheckedIn && lastScan) {
        showError(
          `This box is already checked in to the warehouse. Check it out to a job before checking it in again.`,
        )
        return
      }
    }
    if (checkType === 'check_out') {
      if (alreadyCheckedOut && lastScan) {
        showError(
          `This box is already checked out to ${formatJobLocationDisplay(lastScan.jobName)}. Check it in to the warehouse before checking it out again.`,
        )
        return
      }
      if (!job) {
        showError('Choose a job for check-out.')
        return
      }
      if (isWarehouseJobName(job)) {
        showError('Check-out needs a real job name, not Warehouse / Inventory.')
        return
      }
    }
    if (!footage) {
      showError('Enter the number on the counter.')
      return
    }
    const printedN = parseFootageNumber(footage)
    if (printedN === null || printedN < 0) {
      showError('Enter the counter number in feet.')
      return
    }
    const capacityN = spoolCapacityNow()
    const footageOff = counterWrong && printedN > FOOTAGE_OFF_ABOVE_FT
    let storedFootage = footage
    let printedFootage: string | null = null
    let footageNote: string | null = null
    if (footageOff) {
      if (actualMode === 'empty') {
        storedFootage = '0'
        printedFootage = footage
        footageNote = `Counter read ${footage} ft. Box marked empty.`
      } else if (actualMode === 'custom') {
        const actual = actualFootage.trim()
        const actualN = parseFootageNumber(actual)
        if (actualN === null || actualN < 0) {
          showError('Enter how much wire is actually left, or choose Empty.')
          return
        }
        if (capacityN !== null && actualN > capacityN) {
          showError(`Actual footage cannot be more than this spool (${capacityN} ft). Choose Empty if the box is empty.`)
          return
        }
        storedFootage = actual
        printedFootage = footage
        footageNote = `Counter read ${footage} ft. Remaining set to ${actual} ft.`
      } else {
        showError('Choose Empty or enter how much wire is actually left.')
        return
      }
    } else if (printedN > FOOTAGE_OFF_ABOVE_FT) {
      showError('That footage is too high. Check “footage is off”, then choose Empty or enter the real footage.')
      return
    }

    setSubmitting(true)
    setStatus(null)
    try {
      const profile = buildProfileInsert()
      const row: Record<string, string | number | boolean | null> = {
        box_id: id,
        job_name: job,
        current_footage: storedFootage,
        check_type: checkType,
        scanned_at: new Date().toISOString(),
      }
      if (profile.wire_type) {
        row.wire_type = profile.wire_type
        row.wire_type_label = profile.wire_type_label ?? profile.wire_type
        row.spool_capacity_ft = profile.spool_capacity_ft!
      }
      if (printedFootage) {
        row.printed_footage = printedFootage
        row.footage_note = footageNote
      }

      const { error } = await supabase.from('wire_box_scans').insert(row)
      if (error) {
        const msg = error.message || 'Save failed'
        if (/printed_footage|footage_note/i.test(msg)) {
          showError(
            `${msg} Run supabase/add-wire-box-counter-correction.sql in the Supabase SQL Editor, then try again.`,
          )
          return
        }
        if (/wire_type|spool_capacity|wire_type_label|column/i.test(msg)) {
          showError(
            `${msg} Run supabase/add-wire-box-type-label-default.sql in the Supabase SQL Editor (adds wire_type, spool_capacity_ft, wire_type_label if missing).`
          )
        } else {
          showError(msg)
        }
        return
      }
      if (checkType === 'check_out') {
        await persistJobOption(job)
      }
      const modeLabel = checkType === 'check_out' ? 'Checked out' : 'Checked in to warehouse'
      const remainingLabel = `Remaining ${storedFootage} ft`
      const capHint =
        profile.spool_capacity_ft && parseFootageNumber(storedFootage) !== null
          ? ` of ${profile.spool_capacity_ft} ft`
          : ''
      const counterHint = printedFootage ? ` Counter read ${printedFootage} ft.` : ''
      showSuccess(`Saved: ${modeLabel} — ${id} — ${checkType === 'check_out' ? job : 'Warehouse'} — ${remainingLabel}${capHint}.${counterHint}`)
      setBoxId('')
      setJobName('')
      setCurrentFootage('')
      setCounterWrong(false)
      setActualMode('')
      setActualFootage('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleScanAnother = () => {
    setBoxId('')
    setJobName('')
    setCurrentFootage('')
    setCounterWrong(false)
    setActualMode('')
    setActualFootage('')
    setSelectedPresetId('')
    setSpoolCapacityStr('')
    setBoxRetired(false)
    setStatus(null)
    setShowScanner(true)
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="app">
        <header className="app-header">
          <h1><a href="/" className="home-title-link">Wire Box Scanner</a></h1>
        </header>
        <div className="section section-error">
          <p>
            Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your
            host&apos;s environment variables (e.g. DigitalOcean app env) and redeploy.
          </p>
          <p className="hint">
            Run <code>supabase/add-wire-box-scans.sql</code> in the Supabase SQL Editor. Also run{' '}
            <code>add-wire-box-check-type.sql</code>, <code>add-wire-box-type-label-default.sql</code>, and{' '}
            <code>add-wire-types.sql</code> (wire type catalog) as needed.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1><a href="/" className="home-title-link">Wire Box Scanner</a></h1>
      </header>

      {status && (
        <div className={`status status-${status.type}`}>
          {status.message}
        </div>
      )}

      <main className="app-main">
        {!boxId ? (
          <section className="section">
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={() => setShowScanner(true)}
            >
              Scan QR code
            </button>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="section form-section">
            {boxMetaLoading && (
              <p className="box-meta-loading">Checking this box in the database…</p>
            )}

            {!boxMetaLoading && boxRetired && (
              <div className="retired-banner" role="alert">
                <strong>Retired (inactive)</strong>
                <p>
                  This box cannot be checked in or checked out. Delete it in Wire Tracker if you need
                  to reuse this box ID for new data.
                </p>
                {boxProfile && (
                  <p className="retired-banner-meta">
                    {boxProfile.label}
                    {boxProfile.remainingFt ? ` · Remaining ${boxProfile.remainingFt} ft` : ''}
                  </p>
                )}
              </div>
            )}

            {!boxMetaLoading && !boxRetired && hasExistingScans === false && (
              <div className="form-field">
                <label className="label" htmlFor="wire-type-preset">
                  Wire type
                </label>
                <select
                  id="wire-type-preset"
                  className="input"
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                  required
                >
                  <option value="">Select wire type…</option>
                  {wireTypes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} — default {p.defaultCapacityFt} ft
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!boxMetaLoading && !boxRetired && lastScan && (
              <div
                className={`last-scan-panel${alreadyCheckedOut || alreadyCheckedIn ? ' last-scan-panel--out' : ''}`}
                role="status"
              >
                <strong>Last location</strong>
                <p className="last-scan-panel-main">
                  {lastScan.checkType === 'check_out' ? 'Checked out' : 'Checked in'}
                  {' · '}
                  {formatJobLocationDisplay(lastScan.jobName)}
                </p>
                {lastScan.remainingFt ? (
                  <p className="last-scan-footage" aria-label={`Remaining footage ${lastScan.remainingFt} feet`}>
                    <span className="last-scan-footage-label">Remaining</span>
                    <span className="last-scan-footage-value">{lastScan.remainingFt}</span>
                    <span className="last-scan-footage-unit">ft</span>
                  </p>
                ) : null}
                {lastScan.note ? <p className="last-scan-panel-warn">{lastScan.note}</p> : null}
                {formatLastScanWhen(lastScan.scannedAt) ? (
                  <p className="last-scan-panel-meta">{formatLastScanWhen(lastScan.scannedAt)}</p>
                ) : null}
                {alreadyCheckedOut && (
                  <p className="last-scan-panel-warn">
                    Already out on a job. Check in to the warehouse before checking out again.
                  </p>
                )}
                {alreadyCheckedIn && (
                  <p className="last-scan-panel-warn">
                    Already in the warehouse. Check out to a job before checking in again.
                  </p>
                )}
              </div>
            )}

            {!boxRetired && (
            <div className="form-field">
              <span className="label" id="check-type-label-form">
                Warehouse or job
              </span>
              <div
                className="check-type-toggle"
                role="group"
                aria-labelledby="check-type-label-form"
              >
                <button
                  type="button"
                  className={`check-type-btn ${checkType === 'check_in' ? 'active check-type-in' : ''}`}
                  onClick={() => setCheckType('check_in')}
                  disabled={alreadyCheckedIn}
                  title={
                    alreadyCheckedIn
                      ? 'Already checked in to the warehouse — check out first'
                      : undefined
                  }
                >
                  Check in
                </button>
                <button
                  type="button"
                  className={`check-type-btn ${checkType === 'check_out' ? 'active check-type-out' : ''}`}
                  onClick={() => setCheckType('check_out')}
                  disabled={alreadyCheckedOut || hasExistingScans === false}
                  title={
                    alreadyCheckedOut && lastScan
                      ? `Already checked out to ${formatJobLocationDisplay(lastScan.jobName)}`
                      : hasExistingScans === false
                        ? 'New boxes must check in first'
                        : undefined
                  }
                >
                  Check out
                </button>
              </div>
              {alreadyCheckedOut && (
                <p className="field-hint">
                  Check-out is locked until this box is checked in from{' '}
                  {formatJobLocationDisplay(lastScan!.jobName)}.
                </p>
              )}
              {alreadyCheckedIn && (
                <p className="field-hint">
                  Check-in is locked until this box is checked out to a job.
                </p>
              )}
            </div>
            )}
            <div className="form-field">
              <label className="label">Box ID</label>
              <div className="box-id-display">{boxId}</div>
            </div>
            {!boxRetired && (checkType === 'check_in' ? (
              <div className="form-field">
                <span className="label">Location</span>
                <div className="box-id-display warehouse-location-display">Warehouse</div>
              </div>
            ) : (
              <div className="form-field">
                <label className="label" htmlFor="job-name-select">
                  Job / location
                </label>
                <select
                  id="job-name-select"
                  className="input"
                  value={
                    jobOptions.some(
                      (j) => normalizeJobNameKey(j) === normalizeJobNameKey(jobName),
                    )
                      ? jobOptions.find(
                          (j) => normalizeJobNameKey(j) === normalizeJobNameKey(jobName),
                        )!
                      : ''
                  }
                  onChange={(e) => setJobName(e.target.value)}
                >
                  <option value="">
                    {jobOptions.length === 0 ? 'No saved jobs yet…' : 'Select a saved job…'}
                  </option>
                  {jobOptions.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
                <label className="label job-name-new-label" htmlFor="job-name">
                  Or type a new job name
                </label>
                <input
                  id="job-name"
                  type="text"
                  className="input"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="e.g. Smith Residence"
                  autoComplete="off"
                  required
                />
              </div>
            ))}
            {!boxRetired && (
            <div className="form-field">
              <label className="label" htmlFor="current-footage">
                Current footage (feet remaining on spool)
              </label>
              <div className="footage-entry">
                <input
                  id="current-footage"
                  type="text"
                  className="input"
                  value={currentFootage}
                  onChange={(e) => {
                    const next = e.target.value
                    setCurrentFootage(next)
                    const n = parseFootageNumber(next)
                    if (n === null || n <= FOOTAGE_OFF_ABOVE_FT) {
                      setCounterWrong(false)
                      setActualMode('')
                      setActualFootage('')
                    }
                  }}
                  placeholder="e.g. 250 or 125.5"
                  autoComplete="off"
                  disabled={boxMetaLoading}
                />
                {(() => {
                  const entered = parseFootageNumber(currentFootage)
                  if (entered === null || entered <= FOOTAGE_OFF_ABOVE_FT) return null
                  return (
                    <label className="footage-off">
                      <input
                        type="checkbox"
                        checked={counterWrong}
                        disabled={boxMetaLoading}
                        onChange={(e) => {
                          const on = e.target.checked
                          setCounterWrong(on)
                          if (!on) {
                            setActualMode('')
                            setActualFootage('')
                          }
                        }}
                      />
                      footage is off
                    </label>
                  )
                })()}
              </div>
              {(() => {
                const entered = parseFootageNumber(currentFootage)
                if (entered === null || entered <= FOOTAGE_OFF_ABOVE_FT) return null
                return (
                  <p className="counter-warn" role="status">
                    This number is too high to be footage left on the spool. Check “footage is off”, then mark the box empty or enter what is actually left.
                  </p>
                )
              })()}
              {counterWrong && (parseFootageNumber(currentFootage) ?? 0) > FOOTAGE_OFF_ABOVE_FT ? (
                <div className="counter-fix">
                  <p className="counter-fix-title">What is actually left?</p>
                  <p className="counter-fix-hint">
                    The counter number is kept as a note. Inventory and job totals use the amount you choose here.
                  </p>
                  <div className="counter-fix-actions">
                    <button
                      type="button"
                      className={`btn btn-secondary${actualMode === 'empty' ? ' is-on' : ''}`}
                      onClick={() => setActualMode('empty')}
                    >
                      Empty
                    </button>
                    <button
                      type="button"
                      className={`btn btn-secondary${actualMode === 'custom' ? ' is-on' : ''}`}
                      onClick={() => setActualMode('custom')}
                    >
                      Enter footage
                    </button>
                  </div>
                  {actualMode === 'custom' ? (
                    <input
                      id="actual-footage"
                      type="text"
                      className="input counter-fix-input"
                      value={actualFootage}
                      onChange={(e) => setActualFootage(e.target.value)}
                      placeholder="Feet actually left"
                      autoComplete="off"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleScanAnother}
                disabled={submitting || boxMetaLoading}
              >
                Scan another
              </button>
              {!boxRetired && (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || boxMetaLoading}
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
              )}
            </div>
          </form>
        )}
      </main>

      {showScanner && (
        <QRScanner
          onScan={handleQRScanned}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}

export default App
