export type PunchAction = 'in' | 'out'
export type SyncStatus = 'pending' | 'synced'

export type Punch = {
  id: string
  action: PunchAction
  punchedAt: string
  note: string
  updatedAt: string
  deletedAt: string | null
  syncStatus: SyncStatus
}

export type TimePunchRow = {
  id: string
  action: PunchAction
  punched_at: string
  note: string | null
  updated_at: string
  deleted_at: string | null
}
