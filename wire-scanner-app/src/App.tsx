import { useState, useCallback, useEffect } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import QRScanner from './components/QRScanner'
import {
  WIRE_TYPE_PRESETS,
  getWireTypePreset,
  parseFootageNumber,
  resolveWireTypePreset,
} from './wireTypePresets'
import './App.css'

function normalizeBoxId(raw: string): string {
  return raw.trim()
}

function normalizeJobNameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function isValidBoxIdFormat(id: string): boolean {
  if (!id) return false
  return /^[a-zA-Z0-9]+-[a-zA-Z0-9]+$/.test(id) || /^[a-zA-Z][a-zA-Z0-9-]*\d+$/.test(id)
}

function getBoxIdFromQueryOrHash(searchOrHash: string): string | null {
  if (!searchOrHash || !searchOrHash.trim()) return null
  const s = searchOrHash.trim()
  const query = s.startsWith('?') || s.startsWith('#') ? '?' + s.slice(1) : '?' + s
  const params = new URLSearchParams(query)
  const box = params.get('box')
  if (box) return normalizeBoxId(box)
  if (s.startsWith('#') && s.length > 1 && !s.includes('=')) return normalizeBoxId(s.slice(1))
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

function FootageContextHint({
  currentFootage,
  capacityStr,
  typeLabel,
}: {
  currentFootage: string
  capacityStr: string | null
  typeLabel?: string | null
}) {
  const cur = parseFootageNumber(currentFootage)
  const cap = capacityStr ? parseFootageNumber(capacityStr) : null
  if (cur === null || cap === null || cap <= 0) return null
  const pct = Math.min(100, Math.round((cur / cap) * 100))
  return (
    <p className="footage-context" role="status">
      {typeLabel && (
        <span className="footage-context-type">
          {typeLabel}
          <span className="footage-context-sep"> · </span>
        </span>
      )}
      <span>
        <strong>{cur}</strong> ft left of <strong>{cap}</strong> ft on spool
      </span>
      <span className="footage-context-pct"> ({pct}% of full reel)</span>
    </p>
  )
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
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [spoolCapacityStr, setSpoolCapacityStr] = useState('')

  useEffect(() => {
    const fromUrl = getInitialBoxIdFromWindow()
    if (fromUrl) setBoxId(fromUrl)
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
          .filter(Boolean)
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
    setHasExistingScans(null)

    if (!boxId || !supabase) {
      setBoxMetaLoading(false)
      return
    }

    const id = normalizeBoxId(boxId)
    let cancelled = false
    setBoxMetaLoading(true)

    ;(async () => {
      try {
        const [countRes, profileRes] = await Promise.all([
          supabase.from('wire_box_scans').select('*', { count: 'exact', head: true }).eq('box_id', id),
          supabase
            .from('wire_box_scans')
            .select('wire_type, spool_capacity_ft, wire_type_label, current_footage')
            .eq('box_id', id)
            .not('spool_capacity_ft', 'is', null)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        if (cancelled) return

        if (countRes.error) {
          console.error(countRes.error)
          setHasExistingScans(false)
        } else {
          setHasExistingScans((countRes.count ?? 0) > 0)
        }

        const row = profileRes.data as {
          wire_type: string
          spool_capacity_ft: string
          wire_type_label?: string | null
          current_footage?: string | null
        } | null
        if (row?.wire_type && row?.spool_capacity_ft) {
          const wireRaw = String(row.wire_type).trim()
          const labelRaw = row.wire_type_label ? String(row.wire_type_label).trim() : ''
          const preset =
            resolveWireTypePreset(wireRaw) ?? (labelRaw ? resolveWireTypePreset(labelRaw) : undefined)
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
        }
      } finally {
        if (!cancelled) setBoxMetaLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [boxId])

  useEffect(() => {
    if (boxMetaLoading || hasExistingScans !== false) return
    setJobName('Inventory')
  }, [boxMetaLoading, hasExistingScans, boxId])

  useEffect(() => {
    if (hasExistingScans !== false || !selectedPresetId) return
    const p = getWireTypePreset(selectedPresetId)
    if (!p) return
    const cap = String(p.defaultCapacityFt)
    setSpoolCapacityStr(cap)
    setCurrentFootage(cap)
  }, [selectedPresetId, hasExistingScans])

  const clearStatus = useCallback(() => setStatus(null), [])

  const showSuccess = (msg: string) => {
    setStatus({ type: 'success', message: msg })
    setTimeout(clearStatus, 5000)
  }

  const showError = (msg: string) => {
    setStatus({ type: 'error', message: msg })
  }

  const handleQRScanned = useCallback((value: string) => {
    const raw = (value || '').trim()
    if (!raw) return
    let id: string | null = null
    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw)
        id = getBoxIdFromQueryOrHash(url.search) || getBoxIdFromQueryOrHash(url.hash)
        if (!id) id = normalizeBoxId(raw)
      } catch {
        id = normalizeBoxId(raw)
      }
    } else {
      id = normalizeBoxId(raw)
    }
    if (id) {
      setBoxId(id)
      setShowScanner(false)
    }
  }, [])

  const buildProfileInsert = (): {
    wire_type?: string
    wire_type_label?: string
    spool_capacity_ft?: string
  } => {
    if (hasExistingScans === false) {
      if (!selectedPresetId) return {}
      const p = getWireTypePreset(selectedPresetId)
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
    const job = (jobName || '').trim()
    const footage = (currentFootage || '').trim()
    if (!id) {
      showError('Scan a QR code first.')
      return
    }
    if (hasExistingScans === false) {
      if (!selectedPresetId) {
        showError('This box has no scans yet. Choose a wire type to initialize the box.')
        return
      }
      if (!getWireTypePreset(selectedPresetId)) {
        showError('Unknown wire type. Choose a wire type from the list.')
        return
      }
    }
    if (!job) {
      showError('Enter a job name.')
      return
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
      const jobKey = normalizeJobNameKey(job)
      const { error: jobErr } = await supabase.from('wire_jobs').upsert(
        { name: job, name_key: jobKey, is_active: true },
        { onConflict: 'name_key' }
      )
      if (!jobErr) {
        setJobOptions((prev) => {
          if (prev.some((x) => normalizeJobNameKey(x) === jobKey)) return prev
          return [...prev, job].sort((a, b) => a.localeCompare(b))
        })
      }
      const modeLabel = checkType === 'check_out' ? 'Check out' : 'Check in'
      const remainingLabel = `Remaining ${footage} ft`
      const capHint =
        profile.spool_capacity_ft && parseFootageNumber(footage) !== null
          ? ` of ${profile.spool_capacity_ft} ft`
          : ''
      showSuccess(`Saved: ${modeLabel} — ${id} — ${job} — ${remainingLabel}${capHint}`)
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
    setStatus(null)
    setShowScanner(true)
  }

  const capacityForHint =
    hasExistingScans === false
      ? spoolCapacityStr.trim() || null
      : boxProfile
        ? boxProfile.capacityFt
        : null

  const typeLabelForHint =
    hasExistingScans === false
      ? selectedPresetId
        ? getWireTypePreset(selectedPresetId)?.label ?? selectedPresetId
        : null
      : boxProfile
        ? boxProfile.label
        : null

  if (!isSupabaseConfigured) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Wire Box Scanner</h1>
        </header>
        <div className="section section-error">
          <p>
            Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your
            host&apos;s environment variables (e.g. DigitalOcean app env) and redeploy.
          </p>
          <p className="hint">
            Run <code>supabase/add-wire-box-scans.sql</code> in the Supabase SQL Editor. Also run{' '}
            <code>add-wire-box-check-type.sql</code> and <code>add-wire-box-type-label-default.sql</code> (profile columns
            including <code>spool_capacity_ft</code>) as needed.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Wire Box Scanner</h1>
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
                Check in / Check out
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

            {!boxMetaLoading && hasExistingScans === false && (
              <div className="init-banner" role="region" aria-label="New box setup">
                <strong>New box — first entry</strong>
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
                    {WIRE_TYPE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} — default {p.defaultCapacityFt} ft
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {!boxMetaLoading && hasExistingScans === true && boxProfile && (
              <div className="profile-banner" role="status">
                <strong>Box reel on file</strong>
                <p>
                  {boxProfile.label}
                  <span className="profile-cap"> · Full spool {boxProfile.capacityFt} ft</span>
                  <span className="profile-cap">
                    {' '}
                    · Current {boxProfile.remainingFt ? `${boxProfile.remainingFt} ft` : '—'}
                  </span>
                </p>
              </div>
            )}

            {!boxMetaLoading && hasExistingScans === true && !boxProfile && (
              <div className="legacy-banner">
                <strong>No reel profile</strong>
                <p>This box has scans but no wire type / spool size stored (added before that feature). Footage is shown without a denominator until you use a new box ID or backfill in the database.</p>
              </div>
            )}

            <div className="form-field">
              <span className="label" id="check-type-label-form">
                Check in / Check out
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
            <div className="form-field">
              <label className="label">Box ID</label>
              <div className="box-id-display">{boxId}</div>
              {!isValidBoxIdFormat(boxId) && (
                <p className="field-hint">Expected format like bx-1234</p>
              )}
            </div>
            <div className="form-field">
              <label className="label" htmlFor="job-name">Job name</label>
              <input
                id="job-name"
                type="text"
                className="input"
                list="job-name-options"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g. Smith Residence"
                autoComplete="off"
              />
              <datalist id="job-name-options">
                {jobOptions.map((j) => (
                  <option key={j} value={j} />
                ))}
              </datalist>
            </div>
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
              {!boxMetaLoading && (
                <FootageContextHint
                  currentFootage={currentFootage}
                  capacityStr={capacityForHint}
                  typeLabel={typeLabelForHint}
                />
              )}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleScanAnother}
                disabled={submitting || boxMetaLoading}
              >
                Scan another
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || boxMetaLoading}
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
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
