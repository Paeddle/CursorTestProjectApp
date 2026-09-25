import type { Punch } from './types'

const JOBS_KEY = 'timeclock-jobs'
const LAST_JOB_KEY = 'timeclock-last-job'
export const DEFAULT_JOB = 'Warehouse(8000)'

function readStoredJobs(): string[] {
  try {
    const raw = localStorage.getItem(JOBS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  } catch {
    return []
  }
}

export function listJobs(punches: Punch[]): string[] {
  const unique = new Set<string>([DEFAULT_JOB, ...readStoredJobs()])
  for (const punch of punches) {
    const job = punch.job.trim()
    if (job) unique.add(job)
  }
  return [...unique].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function rememberJob(job: string): string {
  const trimmed = job.trim()
  if (!trimmed) return ''
  const next = new Set(readStoredJobs())
  next.add(trimmed)
  localStorage.setItem(JOBS_KEY, JSON.stringify([...next]))
  localStorage.setItem(LAST_JOB_KEY, trimmed)
  return trimmed
}

export function lastJob(punches: Punch[] = []): string {
  try {
    const stored = localStorage.getItem(LAST_JOB_KEY)?.trim()
    if (stored) return stored
  } catch {
    // ignore
  }
  for (const punch of [...punches].reverse()) {
    if (punch.job.trim()) return punch.job.trim()
  }
  return DEFAULT_JOB
}
