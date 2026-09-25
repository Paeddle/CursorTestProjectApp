import { useCallback, useEffect, useMemo, useState } from 'react'
import { JobField } from './JobField'
import { loadPunches, savePunch } from './lib/db'
import {
  copyTimesheet,
  filterSessionsByRange,
  formatCompactText,
  formatTablePlain,
  type TimesheetFormat,
} from './lib/export'
import { lastJob, listJobs, rememberJob } from './lib/jobs'
import {
  clockedInSince,
  dayKey,
  formatClock,
  formatDayLabel,
  formatDuration,
  fromLocalDateTime,
  mondayOf,
  minutesBetween,
  sessionJob,
  toDateInput,
  toSessions,
  toTimeInput,
} from './lib/sessions'
import { isSupabaseConfigured } from './lib/supabase'
import { syncPunches } from './lib/sync'
import { normalizePunch, type Punch, type PunchAction } from './lib/types'

type Editor = {
  mode: 'edit' | 'add'
  startId: string | null
  endId: string | null
  job: string
  date: string
  clockIn: string
  clockOut: string
  note: string
  dayOnly: boolean
}

function weekBounds(offsetWeeks = 0): { from: string; to: string } {
  const start = mondayOf(new Date())
  start.setDate(start.getDate() + offsetWeeks * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { from: toDateInput(start), to: toDateInput(end) }
}

function emptyEditor(job: string): Editor {
  const now = new Date()
  return {
    mode: 'add',
    startId: null,
    endId: null,
    job,
    date: toDateInput(now),
    clockIn: toTimeInput(now.toISOString()),
    clockOut: '',
    note: '',
    dayOnly: false,
  }
}

export function App() {
  const [punches, setPunches] = useState<Punch[]>([])
  const [job, setJob] = useState(() => lastJob())
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [online, setOnline] = useState(() => navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [ready, setReady] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [range, setRange] = useState(() => weekBounds(0))
  const [exportFormat, setExportFormat] = useState<TimesheetFormat>('table')
  const [copyMessage, setCopyMessage] = useState('')

  const jobs = useMemo(() => listJobs(punches), [punches])

  const refresh = useCallback(async () => {
    setPunches(await loadPunches())
  }, [])

  const sync = useCallback(async () => {
    if (!navigator.onLine || !isSupabaseConfigured) {
      await refresh()
      return
    }
    setSyncing(true)
    setSyncError('')
    try {
      setPunches(await syncPunches())
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Sync failed')
      await refresh()
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  useEffect(() => {
    void sync().finally(() => setReady(true))
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const retry = window.setInterval(() => {
      if (navigator.onLine) void sync()
    }, 30000)
    const onOnline = () => {
      setOnline(true)
      void sync()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.clearInterval(clock)
      window.clearInterval(retry)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [sync])

  const openPunch = clockedInSince(punches)
  const sessions = useMemo(() => toSessions(punches), [punches])
  const today = dayKey(new Date(now).toISOString())
  const pending = punches.filter((punch) => punch.syncStatus === 'pending' && !punch.deletedAt).length

  const groups = useMemo(() => {
    const map = new Map<string, typeof sessions>()
    for (const session of sessions) {
      const key = dayKey(session.start.punchedAt)
      const list = map.get(key) ?? []
      list.push(session)
      map.set(key, list)
    }
    return [...map.entries()].slice(0, 21)
  }, [sessions])

  const todayMinutes = sessions.reduce((total, session) => {
    if (session.dayOnly || dayKey(session.start.punchedAt) !== today) return total
    if (session.minutes != null) return total + session.minutes
    return total + minutesBetween(session.start.punchedAt, now)
  }, 0)

  const thisWeek = weekBounds(0)
  const weekMinutes = sessions.reduce((total, session) => {
    if (session.dayOnly) return total
    const key = dayKey(session.start.punchedAt)
    if (key < thisWeek.from || key > thisWeek.to) return total
    if (session.minutes != null) return total + session.minutes
    return total + minutesBetween(session.start.punchedAt, now)
  }, 0)

  const exportSessions = useMemo(
    () => filterSessionsByRange(sessions, range.from, range.to),
    [sessions, range],
  )

  async function persist(punch: Punch) {
    const stamp = new Date().toISOString()
    await savePunch({ ...punch, updatedAt: stamp, syncStatus: 'pending' })
  }

  async function punch(action: PunchAction) {
    const stamp = new Date().toISOString()
    const jobName = rememberJob(job) || rememberJob(lastJob(punches))
    const next = normalizePunch({
      id: crypto.randomUUID(),
      action,
      punchedAt: stamp,
      note: note.trim(),
      job: action === 'out' && openPunch?.job ? openPunch.job : jobName,
      dayOnly: false,
      updatedAt: stamp,
      deletedAt: null,
      syncStatus: 'pending',
    })
    if (jobName) setJob(jobName)
    await savePunch(next)
    setNote('')
    await sync()
  }

  async function removePunch(target: Punch) {
    const stamp = new Date().toISOString()
    await savePunch({ ...target, deletedAt: stamp, updatedAt: stamp, syncStatus: 'pending' })
  }

  function openEdit(session: (typeof sessions)[number]) {
    setEditor({
      mode: 'edit',
      startId: session.start.id,
      endId: session.end?.id ?? null,
      job: sessionJob(session),
      date: dayKey(session.start.punchedAt),
      clockIn: toTimeInput(session.start.punchedAt),
      clockOut: session.end ? toTimeInput(session.end.punchedAt) : '',
      note: session.start.note || session.end?.note || '',
      dayOnly: session.dayOnly,
    })
  }

  async function saveEditor() {
    if (!editor) return
    const jobName = rememberJob(editor.job)
    if (!jobName) return
    setSaving(true)
    try {
      const startAt = editor.dayOnly
        ? fromLocalDateTime(editor.date, '12:00')
        : fromLocalDateTime(editor.date, editor.clockIn || '08:00')
      let endAt = ''
      if (!editor.dayOnly && editor.clockOut) {
        endAt = fromLocalDateTime(editor.date, editor.clockOut)
        if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
          const nextDay = new Date(`${editor.date}T${editor.clockOut}:00`)
          nextDay.setDate(nextDay.getDate() + 1)
          endAt = nextDay.toISOString()
        }
      }

      const start = normalizePunch({
        id: editor.startId ?? crypto.randomUUID(),
        action: 'in',
        punchedAt: startAt,
        note: editor.note.trim(),
        job: jobName,
        dayOnly: editor.dayOnly,
        deletedAt: null,
        syncStatus: 'pending',
      })
      await persist(start)

      const existingEnd = editor.endId ? punches.find((item) => item.id === editor.endId) : undefined
      if (endAt) {
        const end = normalizePunch({
          id: existingEnd?.id ?? crypto.randomUUID(),
          action: 'out',
          punchedAt: endAt,
          note: editor.note.trim(),
          job: jobName,
          dayOnly: false,
          deletedAt: null,
          syncStatus: 'pending',
        })
        await persist(end)
      } else if (existingEnd) {
        await removePunch(existingEnd)
      }

      setJob(jobName)
      setEditor(null)
      await sync()
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy() {
    try {
      await copyTimesheet(exportFormat, exportSessions)
      setCopyMessage(exportSessions.length === 0 ? 'Nothing in that range to copy.' : 'Copied. Paste it into your email.')
    } catch {
      setCopyMessage('Copy failed. Select the preview and copy it manually.')
    }
    window.setTimeout(() => setCopyMessage(''), 4000)
  }

  const clockLabel = new Date(now).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Personal time clock</p>
          <h1>{clockLabel}</h1>
        </div>
        <p className={`pill ${online ? 'pill-ok' : 'pill-warn'}`}>
          {online ? 'Online' : 'Offline'}
        </p>
      </header>

      <div className="layout">
      <div className="clock-pane">
      <section className={`status ${openPunch ? 'status-in' : ''}`}>
        {openPunch ? (
          <>
            <p className="status-label">Clocked in</p>
            <p className="status-time">
              {formatDuration(minutesBetween(openPunch.punchedAt, now))}
            </p>
            <p className="status-meta">
              Since {formatClock(openPunch.punchedAt)}
              {openPunch.job ? ` · ${openPunch.job}` : ''}
            </p>
          </>
        ) : (
          <>
            <p className="status-label">Clocked out</p>
            <p className="status-time">{formatDuration(todayMinutes)}</p>
            <p className="status-meta">Today</p>
          </>
        )}
        <p className="week-total">
          <span>Hours this week</span>
          <strong>{formatDuration(weekMinutes)}</strong>
        </p>
      </section>

      <JobField value={job} jobs={jobs} onChange={setJob} />

      <label className="note">
        Note
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional"
          maxLength={200}
        />
      </label>

      <button
        type="button"
        className={openPunch ? 'punch out' : 'punch in'}
        disabled={!ready}
        onClick={() => void punch(openPunch ? 'out' : 'in')}
      >
        {openPunch ? 'Clock out' : 'Clock in'}
      </button>

      <p className="sync-line">
        {!isSupabaseConfigured
          ? 'Saved on this device. Add Supabase keys to sync across devices.'
          : syncing
            ? 'Syncing…'
            : syncError
              ? `Saved here. Sync will retry. ${syncError}`
              : pending > 0
                ? `${pending} punch${pending === 1 ? '' : 'es'} waiting to sync.`
                : online
                  ? 'Synced.'
                  : 'Saved on this phone. They will sync when you have a connection.'}
      </p>
      </div>

      <div className="records-pane">
      <section className="export">
        <div className="history-head">
          <h2>Email timesheet</h2>
          <div className="row-actions">
            <button type="button" className="text-btn" onClick={() => setRange(weekBounds(0))}>
              This week
            </button>
            <button type="button" className="text-btn" onClick={() => setRange(weekBounds(-1))}>
              Last week
            </button>
          </div>
        </div>
        <div className="range-row">
          <label>
            From
            <input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} />
          </label>
          <label>
            To
            <input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} />
          </label>
        </div>
        <div className="format-row">
          <button
            type="button"
            className={exportFormat === 'table' ? 'chip on' : 'chip'}
            onClick={() => setExportFormat('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={exportFormat === 'compact' ? 'chip on' : 'chip'}
            onClick={() => setExportFormat('compact')}
          >
            Compact
          </button>
        </div>
        <pre className="export-preview">
          {exportSessions.length === 0
            ? 'No punches in this range.'
            : exportFormat === 'compact'
              ? formatCompactText(exportSessions)
              : formatTablePlain(exportSessions)}
        </pre>
        <button type="button" className="copy-btn" onClick={() => void handleCopy()}>
          Copy for email
        </button>
        {copyMessage ? <p className="copy-msg">{copyMessage}</p> : null}
      </section>

      <section className="history">
        <div className="history-head">
          <h2>Recent</h2>
          <div className="row-actions">
            <button type="button" className="text-btn" onClick={() => setEditor(emptyEditor(job || lastJob(punches)))}>
              Add entry
            </button>
            <button type="button" className="text-btn" onClick={() => void sync()}>
              Sync now
            </button>
          </div>
        </div>
        {groups.length === 0 ? (
          <p className="empty">No punches yet.</p>
        ) : (
          groups.map(([key, daySessions]) => {
            const closed = daySessions.reduce((sum, session) => sum + (session.minutes ?? 0), 0)
            const running = daySessions.some((session) => !session.dayOnly && session.end == null)
            const extra = running && key === today && openPunch ? minutesBetween(openPunch.punchedAt, now) : 0
            return (
              <article key={key} className="day">
                <header>
                  <h3>{formatDayLabel(key, today)}</h3>
                  <span>{formatDuration(closed + extra)}</span>
                </header>
                <ul>
                  {daySessions.map((session) => (
                    <li key={session.id}>
                      <div>
                        <strong>
                          {session.dayOnly
                            ? sessionJob(session) || 'Time off'
                            : `${formatClock(session.start.punchedAt)} – ${session.end ? formatClock(session.end.punchedAt) : 'now'}`}
                        </strong>
                        <span>
                          {session.dayOnly
                            ? 'No clock times'
                            : session.minutes != null
                              ? formatDuration(session.minutes)
                              : formatDuration(minutesBetween(session.start.punchedAt, now))}
                          {!session.dayOnly && sessionJob(session) ? ` · ${sessionJob(session)}` : ''}
                          {session.start.note ? ` · ${session.start.note}` : ''}
                          {session.end?.note && session.end.note !== session.start.note
                            ? ` · ${session.end.note}`
                            : ''}
                        </span>
                      </div>
                      <div className="row-actions">
                        <button type="button" className="text-btn" onClick={() => openEdit(session)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() => {
                            void (async () => {
                              await removePunch(session.start)
                              if (session.end) await removePunch(session.end)
                              await sync()
                            })()
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })
        )}
      </section>
      </div>
      </div>

      {editor ? (
        <div className="sheet" role="dialog" aria-label={editor.mode === 'edit' ? 'Edit time' : 'Add entry'}>
          <div className="sheet-card">
            <div className="history-head">
              <h2>{editor.mode === 'edit' ? 'Edit time' : 'Add entry'}</h2>
              <button type="button" className="text-btn" onClick={() => setEditor(null)}>
                Close
              </button>
            </div>
            <JobField value={editor.job} jobs={jobs} onChange={(value) => setEditor({ ...editor, job: value })} />
            <label className="note">
              Date
              <input
                type="date"
                value={editor.date}
                onChange={(event) => setEditor({ ...editor, date: event.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editor.dayOnly}
                onChange={(event) => setEditor({ ...editor, dayOnly: event.target.checked })}
              />
              No clock times (holiday / sick day)
            </label>
            {!editor.dayOnly ? (
              <div className="range-row">
                <label>
                  Clock in
                  <input
                    type="time"
                    value={editor.clockIn}
                    onChange={(event) => setEditor({ ...editor, clockIn: event.target.value })}
                  />
                </label>
                <label>
                  Clock out
                  <input
                    type="time"
                    value={editor.clockOut}
                    onChange={(event) => setEditor({ ...editor, clockOut: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
            <label className="note">
              Note
              <input
                value={editor.note}
                onChange={(event) => setEditor({ ...editor, note: event.target.value })}
                placeholder="Optional"
                maxLength={200}
              />
            </label>
            <button type="button" className="copy-btn" disabled={saving || !editor.job.trim()} onClick={() => void saveEditor()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <p className="status-meta">
              Changes save on this device right away, then sync when you are online.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  )
}
