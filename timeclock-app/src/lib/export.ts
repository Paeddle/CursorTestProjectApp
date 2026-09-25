import {
  dayKey,
  formatClock,
  formatClockCompact,
  formatShortDate,
  formatTableDate,
  sessionJob,
  weekKey,
  type Session,
} from './sessions'

export type TimesheetFormat = 'table' | 'compact'

export function filterSessionsByRange(sessions: Session[], from: string, to: string): Session[] {
  return sessions.filter((session) => {
    const key = dayKey(session.start.punchedAt)
    return key >= from && key <= to
  })
}

function orderedSessions(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => new Date(a.start.punchedAt).getTime() - new Date(b.start.punchedAt).getTime(),
  )
}

export function formatCompactText(sessions: Session[]): string {
  const lines: string[] = []
  let lastDate = ''
  let lastWeek = ''
  for (const session of orderedSessions(sessions)) {
    const key = dayKey(session.start.punchedAt)
    const week = weekKey(key)
    if (lastWeek && week !== lastWeek) lines.push('----------------')
    if (key !== lastDate) {
      if (lines.length > 0 && lines[lines.length - 1] !== '----------------') lines.push('')
      lines.push(formatShortDate(key))
      lastDate = key
    }
    lastWeek = week
    const job = sessionJob(session)
    if (session.dayOnly) {
      lines.push(job || 'Time off')
      continue
    }
    const start = formatClockCompact(session.start.punchedAt)
    const end = session.end ? formatClockCompact(session.end.punchedAt) : 'now'
    lines.push(`${job || 'Job'}:${start} – ${end}`)
  }
  return lines.join('\n')
}

export function formatTablePlain(sessions: Session[]): string {
  const rows = [
    ['Date', 'Job', 'Clock-In', 'Clock-Out'],
    ...orderedSessions(sessions).map((session) => {
      const key = dayKey(session.start.punchedAt)
      const job = sessionJob(session) || '—'
      if (session.dayOnly) return [formatTableDate(key), job, 'NA', 'NA']
      return [
        formatTableDate(key),
        job,
        formatClock(session.start.punchedAt),
        session.end ? formatClock(session.end.punchedAt) : '—',
      ]
    }),
  ]
  return rows.map((row) => row.join('\t')).join('\n')
}

export function formatTableHtml(sessions: Session[]): string {
  const body = orderedSessions(sessions)
    .map((session) => {
      const key = dayKey(session.start.punchedAt)
      const job = escapeHtml(sessionJob(session) || '—')
      const clockIn = session.dayOnly ? 'NA' : escapeHtml(formatClock(session.start.punchedAt))
      const clockOut = session.dayOnly
        ? 'NA'
        : escapeHtml(session.end ? formatClock(session.end.punchedAt) : '—')
      return `<tr><td>${escapeHtml(formatTableDate(key))}</td><td>${job}</td><td>${clockIn}</td><td>${clockOut}</td></tr>`
    })
    .join('')
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:14px"><thead><tr><th align="left">Date</th><th align="left">Job</th><th align="left">Clock-In</th><th align="left">Clock-Out</th></tr></thead><tbody>${body}</tbody></table>`
}

export async function copyTimesheet(format: TimesheetFormat, sessions: Session[]): Promise<void> {
  const plain = format === 'table' ? formatTablePlain(sessions) : formatCompactText(sessions)
  if (format === 'table' && 'clipboard' in navigator && 'ClipboardItem' in window) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([formatTableHtml(sessions)], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // Fall through to plain text.
    }
  }
  await navigator.clipboard.writeText(plain)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
