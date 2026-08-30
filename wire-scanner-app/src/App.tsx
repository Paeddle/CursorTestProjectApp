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
/** Same as Tracker: inactive / retired boxes use this job name and cannot be scanned. */
const RETIRED_JOB_NAME = 'Retired'

function normalizeBoxId(raw: string): string {
  return raw.trim()
}

/** Wire box labels on QR stickers, e.g. BX-0001. */
const BOX_ID_PATTERN = /\b(BX-\d+)\b/i

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

function getBoxIdFromQueryOrHash(searchOrHash: string): string | null {
  if (!searchOrHash || !searchOrHash.trim()) return null
  const s = searchOrHash.trim()
  const query = s.startsWith('?') || s.startsWith('#') ? '?' + s.slice(1) : '?' + s
  const params = new URLSearchParams(query)
  const box = params.get('box')
  if (box) {
    const fromParam = findBoxIdInText(box) || normalizeBoxId(box)
    return fromParam
  }
  if (s.startsWith('#') && s.length > 1 && !s.includes('=')) {
    const hashVal = normalizeBoxId(s.slice(1))
    return findBoxIdInText(hashVal) || hashVal
  }
  return null
}

/** Pull only the box id from a QR payload (plain BX-####, ?box=, or full scanner URL). */
function extractBoxIdFromScannedValue(value: string): string | null {
  const raw = stripScanValuePrefixes(value || '')
  if (!raw) return null

  const looksLikeUrl = /^https?:\/\//i.test(raw) || /[/?#].*=/.test(raw) || /\.(app|com|io|net|org)\b/i.test(raw)
  if (looksLikeUrl) {
    try {
      const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`
      const url = new URL(href)
      const fromParams =
        getBoxIdFromQueryOrHash(url.search) || getBoxIdFromQueryOrHash(url.hash)
      if (fromParams) return findBoxIdInText(fromParams) || fromParams
      const fromPath = findBoxIdInText(`${url.pathname}${url.search}${url.hash}`)
      if (fromPath) return fromPath
    } catch {
      // fall through to text match
    }
    const embedded = findBoxIdInText(raw)
    if (embedded) return embedded
    return null
  }

  const embedded = findBoxIdInText(raw)
  if (embedded) return embedded

  // Plain id that is not a URL (legacy formats)
  if (!/\s/.test(raw) && raw.length < 64 && !raw.includes('://')) {
    return normalizeBoxId(raw)
  }
  return null
}

function getInitialBoxIdFromWindow(): string {
  if (typeof window === 'undefined') return ''
  const fromSearch = getBoxIdFromQueryOrHash(window.location.search)
  if (fromSearch) return fromSearch
  const fromHash = getBoxIdFromQueryOrHash(window.location.hash)
  if (fromHash) return fromHash
  return ''
}

type CheckType = 'check_in' | 'check_out'

interface BoxProfile {
  wireTypeId: string
  capacityFt: string
  label: string
  remainingFt: string | null
}

function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [checkType, setCheckType] = useState<CheckType>('check_in')
  const [boxId, setBoxId] = useState(getInitialBoxIdFromWindow)
  const [jobName, setJobName] = useState('')
  const [currentFootage, setCurrentFootage] = useState('')
  const [jobOptions, setJobOptions] = useState<string[]>([])
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [boxMetaLoading, setBoxMetaLoading] = useState(false)
  /** null = not loaded yet */
  const [hasExistingScans, setHasExistingScans] = useState<boolean | null>(null)
  const [boxProfile, setBoxProfile] = useState<BoxProfile | null>(null)
  const [boxRetired, setBoxRetired] = useState(false)
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
          .filter((n) => n && normalizeJobNameKey(n) !== 'inventory')
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
    setHasExistingScans(null)

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
        const [countRes, profileRes, latestRes] = await Promise.all([
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
            .select('box_id, job_name, check_type, current_footage, wire_type_label, wire_type, spool_capacity_ft')
            .ilike('box_id', idMatch)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        if (cancelled) return

        if (countRes.error) {
          console.error(countRes.error)
          setHasExistingScans(false)
          setBoxRetired(false)
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
        } | null
        const storedBoxId = latest?.box_id ? String(latest.box_id).trim() : ''
        // Keep DB casing for future inserts so we don't split one box into two ids.
        if (storedBoxId && storedBoxId !== id) {
          setBoxId(storedBoxId)
        }
        const retired = latest ? isRetiredJobName(String(latest.job_name ?? '')) : false
        setBoxRetired(retired)

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
      .upsert({ name, name_key: jobKey, is_active: true }, { onConflict: 'name_key' })
    if (error) return
    setJobOptions((prev) => {
      if (prev.some((x) => normalizeJobNameKey(x) === jobKey)) return prev
      return [...prev, name].sort((a, b) => a.localeCompare(b))
    })
  }, [])

  const handleQRScanned = useCallback((value: string) => {
    const id = extractBoxIdFromScannedValue(value)
    if (id) {
      setBoxId(id)
      setShowScanner(false)
      return
    }
    setStatus({
      type: 'error',
      message: 'Could not read a box ID (expected BX-0000) from that QR code.',
    })
    setShowScanner(false)
  }, [])

  useEffect(() => {
    if (!supabase) return
    const normalized = jobName.trim().replace(/\s+/g, ' ')
    if (!normalized) return
    const t = window.setTimeout(() => {
      void persistJobOption(normalized)
    }, 500)
    return () => window.clearTimeout(t)
  }, [jobName, persistJobOption])

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
    if (boxRetired) {
      showError(
        'This box is Retired (inactive). No check-in or check-out is allowed. Delete the box in Wire Tracker to reuse this ID.',
      )
      return
    }
    if (hasExistingScans === false) {
      if (!selectedPresetId) {
        showError('This box has no scans yet. Choose a wire type to initialize the box.')
        return
      }
      if (!getWireTypePreset(selectedPresetId, wireTypes)) {
        showError('Unknown wire type. Choose a wire type from the list.')
        return
      }
    }
    if (checkType === 'check_out') {
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
      showError('Enter current footage.')
      return
    }

    setSubmitting(true)
    setStatus(null)
    try {
      const profile = buildProfileInsert()
      const row: Record<string, string | number | boolean | null> = {
        box_id: id,
        job_name: job,
        current_footage: footage,
        check_type: checkType,
        scanned_at: new Date().toISOString(),
      }
      if (profile.wire_type) {
        row.wire_type = profile.wire_type
        row.wire_type_label = profile.wire_type_label ?? profile.wire_type
        row.spool_capacity_ft = profile.spool_capacity_ft!
      }

      const { error } = await supabase.from('wire_box_scans').insert(row)
      if (error) {
        const msg = error.message || 'Save failed'
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
      const remainingLabel = `Remaining ${footage} ft`
      const capHint =
        profile.spool_capacity_ft && parseFootageNumber(footage) !== null
          ? ` of ${profile.spool_capacity_ft} ft`
          : ''
      showSuccess(`Saved: ${modeLabel} — ${id} — ${checkType === 'check_out' ? job : 'Warehouse'} — ${remainingLabel}${capHint}`)
      setBoxId('')
      setJobName('')
      setCurrentFootage('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleScanAnother = () => {
    setBoxId('')
    setJobName('')
    setCurrentFootage('')
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
            <div className="form-field">
              <span className="label" id="check-type-label-idle">
                Warehouse or job
              </span>
              <div
                className="check-type-toggle"
                role="group"
                aria-labelledby="check-type-label-idle"
              >
                <button
                  type="button"
                  className={`check-type-btn ${checkType === 'check_in' ? 'active check-type-in' : ''}`}
                  onClick={() => setCheckType('check_in')}
                >
                  Check in
                </button>
                <button
                  type="button"
                  className={`check-type-btn ${checkType === 'check_out' ? 'active check-type-out' : ''}`}
                  onClick={() => setCheckType('check_out')}
                >
                  Check out
                </button>
              </div>
            </div>
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
                >
                  Check in
                </button>
                <button
                  type="button"
                  className={`check-type-btn ${checkType === 'check_out' ? 'active check-type-out' : ''}`}
                  onClick={() => setCheckType('check_out')}
                >
                  Check out
                </button>
              </div>
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
                <label className="label" htmlFor="job-name">
                  Job name
                </label>
                <input
                  id="job-name"
                  type="text"
                  className="input"
                  list="job-name-options"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  onBlur={() => {
                    void persistJobOption(jobName)
                  }}
                  placeholder="e.g. Smith Residence"
                  autoComplete="off"
                  required
                />
                <datalist id="job-name-options">
                  {jobOptions.map((j) => (
                    <option key={j} value={j} />
                  ))}
                </datalist>
              </div>
            ))}
            {!boxRetired && (
            <div className="form-field">
              <label className="label" htmlFor="current-footage">
                Current footage (feet remaining on spool)
              </label>
              <input
                id="current-footage"
                type="text"
                className="input"
                value={currentFootage}
                onChange={(e) => setCurrentFootage(e.target.value)}
                placeholder="e.g. 250 or 125.5"
                autoComplete="off"
                disabled={boxMetaLoading}
              />
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
