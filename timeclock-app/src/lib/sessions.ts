import type { Punch } from './types'

export type Session = {
  id: string
  start: Punch
  end: Punch | null
  minutes: number | null
}

export function activePunches(punches: Punch[]): Punch[] {
  return punches
    .filter((punch) => !punch.deletedAt)
    .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime())
}

export function toSessions(punches: Punch[]): Session[] {
  const sessions: Session[] = []
  let open: Punch | null = null
  for (const punch of activePunches(punches)) {
    if (punch.action === 'in') {
      if (open) {
        sessions.push({ id: open.id, start: open, end: null, minutes: null })
      }
      open = punch
      continue
    }
    if (open) {
      const minutes = Math.max(
        0,
        Math.round((new Date(punch.punchedAt).getTime() - new Date(open.punchedAt).getTime()) / 60000),
      )
      sessions.push({ id: open.id, start: open, end: punch, minutes })
      open = null
    }
  }
  if (open) sessions.push({ id: open.id, start: open, end: null, minutes: null })
  return sessions.reverse()
}

export function clockedInSince(punches: Punch[]): Punch | null {
  const list = activePunches(punches)
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

export function dayKey(iso: string): string {
  const date = new Date(iso)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today'
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayKey(yesterday.toISOString()) === key) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function minutesBetween(startIso: string, endMs: number): number {
  return Math.max(0, Math.round((endMs - new Date(startIso).getTime()) / 60000))
}
