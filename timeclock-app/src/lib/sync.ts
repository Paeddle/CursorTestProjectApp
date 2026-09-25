import { loadPunches, savePunches } from './db'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Punch, TimePunchRow } from './types'

function rowToPunch(row: TimePunchRow): Punch {
  return {
    id: row.id,
    action: row.action,
    punchedAt: row.punched_at,
    note: row.note ?? '',
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncStatus: 'synced',
  }
}

function punchToRow(punch: Punch): TimePunchRow {
  return {
    id: punch.id,
    action: punch.action,
    punched_at: punch.punchedAt,
    note: punch.note,
    updated_at: punch.updatedAt,
    deleted_at: punch.deletedAt,
  }
}

function newer(a: string, b: string): boolean {
  return new Date(a).getTime() >= new Date(b).getTime()
}

export async function syncPunches(): Promise<Punch[]> {
  const local = await loadPunches()
  if (!navigator.onLine || !supabase) return local

  const pending = local.filter((punch) => punch.syncStatus === 'pending')
  if (pending.length > 0) {
    const { error } = await supabase.from('time_punches').upsert(pending.map(punchToRow))
    if (error) throw new Error(error.message)
  }

  const { data, error } = await supabase
    .from('time_punches')
    .select('id, action, punched_at, note, updated_at, deleted_at')
  if (error) throw new Error(error.message)

  const remote = ((data ?? []) as TimePunchRow[]).map(rowToPunch)
  const byId = new Map<string, Punch>()
  for (const punch of remote) byId.set(punch.id, punch)

  for (const punch of local) {
    const existing = byId.get(punch.id)
    if (!existing || (punch.syncStatus === 'pending' && newer(punch.updatedAt, existing.updatedAt))) {
      byId.set(punch.id, punch.syncStatus === 'pending' ? punch : { ...punch, syncStatus: 'synced' })
    }
  }

  const merged = [...byId.values()]
  const pushed = new Set(pending.map((punch) => punch.id))
  const settled = merged.map((punch) =>
    pushed.has(punch.id) ? { ...punch, syncStatus: 'synced' as const } : punch,
  )
  await savePunches(settled)
  return settled
}

export function canSync(): boolean {
  return isSupabaseConfigured && navigator.onLine
}
