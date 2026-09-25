import type { Punch } from './types'

export type Session = {
  id: string
  start: Punch
  end: Punch | null
  minutes: number | null
  dayOnly: boolean
}

export function activePunches(punches: Punch[]): Punch[] {
  return punches
    .filter((punch) => !punch.deletedAt)
    .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime())
}

export function sessionJob(session: Session): string {
  return session.start.job.trim() || session.end?.job.trim() || ''
}

export function toSessions(punches: Punch[]): Session[] {
  const sessions: Session[] = []
  let open: Punch | null = null
  for (const punch of activePunches(punches)) {
    if (punch.dayOnly) {
      if (open) {
        sessions.push({ id: open.id, start: open, end: null, minutes: null, dayOnly: false })
        open = null
      }
      sessions.push({ id: punch.id, start: punch, end: null, minutes: null, dayOnly: true })
      continue
    }
    if (punch.action === 'in') {
      if (open) {
        sessions.push({ id: open.id, start: open, end: null, minutes: null, dayOnly: false })
      }
      open = punch
      continue
    }
    if (open) {
      const minutes = Math.max(
        0,
        Math.round((new Date(punch.punchedAt).getTime() - new Date(open.punchedAt).getTime()) / 60000),
      )
      sessions.push({ id: open.id, start: open, end: punch, minutes, dayOnly: false })
      open = null
    }
  }
  if (open) sessions.push({ id: open.id, start: open, end: null, minutes: null, dayOnly: false })
  return sessions.reverse()
}

export function clockedInSince(punches: Punch[]): Punch | null {
  const list = activePunches(punches).filter((punch) => !punch.dayOnly)
  const last = list[list.length - 1]
  return last?.action === 'in' ? last : null
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatClockCompact(iso: string): string {
  const date = new Date(iso)
  const hours = date.getHours() % 12 || 12
  return `${hours}:${`${date.getMinutes()}`.padStart(2, '0')}`
}

export function formatShortDate(isoOrKey: string): string {
  const date = isoOrKey.includes('T') ? new Date(isoOrKey) : dateFromKey(isoOrKey)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function formatTableDate(isoOrKey: string): string {
  const date = isoOrKey.includes('T') ? new Date(isoOrKey) : dateFromKey(isoOrKey)
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

export function dayKey(iso: string): string {
  const date = new Date(iso)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today'
  const date = dateFromKey(key)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayKey(yesterday.toISOString()) === key) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function minutesBetween(startIso: string, endMs: number): number {
  return Math.max(0, Math.round((endMs - new Date(startIso).getTime()) / 60000))
}

export function mondayOf(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = start.getDay()
  start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1))
  return start
}

export function toDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function toTimeInput(iso: string): string {
  const date = new Date(iso)
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`
}

export function fromLocalDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

export function weekKey(dateKey: string): string {
  return toDateInput(mondayOf(dateFromKey(dateKey)))
}
