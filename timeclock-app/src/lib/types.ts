export type PunchAction = 'in' | 'out'
export type SyncStatus = 'pending' | 'synced'

export type Punch = {
  id: string
  action: PunchAction
  punchedAt: string
  note: string
  job: string
  dayOnly: boolean
  updatedAt: string
  deletedAt: string | null
  syncStatus: SyncStatus
}

export type TimePunchRow = {
  id: string
  action: PunchAction
  punched_at: string
  note: string | null
  job: string | null
  day_only: boolean | null
  updated_at: string
  deleted_at: string | null
}

export function normalizePunch(punch: Partial<Punch> & Pick<Punch, 'id' | 'action' | 'punchedAt'>): Punch {
  return {
    id: punch.id,
    action: punch.action,
    punchedAt: punch.punchedAt,
    note: punch.note ?? '',
    job: punch.job ?? '',
    dayOnly: Boolean(punch.dayOnly),
    updatedAt: punch.updatedAt ?? punch.punchedAt,
    deletedAt: punch.deletedAt ?? null,
    syncStatus: punch.syncStatus ?? 'pending',
  }
}
