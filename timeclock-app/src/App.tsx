import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadPunches, savePunch } from './lib/db'
import {
  clockedInSince,
  dayKey,
  formatClock,
  formatDayLabel,
  formatDuration,
  minutesBetween,
  toSessions,
} from './lib/sessions'
import { isSupabaseConfigured } from './lib/supabase'
import { syncPunches } from './lib/sync'
import type { Punch, PunchAction } from './lib/types'

export function App() {
  const [punches, setPunches] = useState<Punch[]>([])
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [online, setOnline] = useState(() => navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [ready, setReady] = useState(false)

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
    if (dayKey(session.start.punchedAt) !== today) return total
    if (session.minutes != null) return total + session.minutes
    return total + minutesBetween(session.start.punchedAt, now)
  }, 0)

  async function punch(action: PunchAction) {
    const stamp = new Date().toISOString()
    const next: Punch = {
      id: crypto.randomUUID(),
      action,
      punchedAt: stamp,
      note: note.trim(),
      updatedAt: stamp,
      deletedAt: null,
      syncStatus: 'pending',
    }
    await savePunch(next)
    setNote('')
    await sync()
  }

  async function removePunch(punch: Punch) {
    const stamp = new Date().toISOString()
    await savePunch({ ...punch, deletedAt: stamp, updatedAt: stamp, syncStatus: 'pending' })
    await sync()
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

      <section className={`status ${openPunch ? 'status-in' : ''}`}>
        {openPunch ? (
          <>
            <p className="status-label">Clocked in</p>
            <p className="status-time">
              {formatDuration(minutesBetween(openPunch.punchedAt, now))}
            </p>
            <p className="status-meta">Since {formatClock(openPunch.punchedAt)}</p>
          </>
        ) : (
          <>
            <p className="status-label">Clocked out</p>
            <p className="status-time">{formatDuration(todayMinutes)}</p>
            <p className="status-meta">Today</p>
          </>
        )}
      </section>

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

      <section className="history">
        <div className="history-head">
          <h2>Recent</h2>
          <button type="button" className="text-btn" onClick={() => void sync()}>
            Sync now
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="empty">No punches yet.</p>
        ) : (
          groups.map(([key, daySessions]) => {
            const closed = daySessions.reduce((sum, session) => sum + (session.minutes ?? 0), 0)
            const running = daySessions.some((session) => session.end == null)
            const extra = running && key === today ? minutesBetween(openPunch!.punchedAt, now) : 0
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
                          {formatClock(session.start.punchedAt)}
                          {' – '}
                          {session.end ? formatClock(session.end.punchedAt) : 'now'}
                        </strong>
                        <span>
                          {session.minutes != null
                            ? formatDuration(session.minutes)
                            : formatDuration(minutesBetween(session.start.punchedAt, now))}
                          {session.start.note ? ` · ${session.start.note}` : ''}
                          {session.end?.note ? ` · ${session.end.note}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          void (async () => {
                            await removePunch(session.start)
                            if (session.end) await removePunch(session.end)
                          })()
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })
        )}
      </section>
    </main>
  )
}
