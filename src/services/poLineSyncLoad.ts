import { fetchPoLineCustomerPickMap } from './poLineCustomerPickService'
import { fetchPoLineCheckedMap } from './poLineCheckedService'
import { fetchPoLineReceivedMap } from './poLineReceivedService'

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /does not exist|relation.*not found|42P01|Could not find the table/i.test(msg)
}

export type PoLineSyncMaps = {
  lineChecked: Record<string, boolean>
  customerPicks: Record<string, string>
  lineReceived: Record<string, number>
  missingSyncTables: boolean
}

/** Load shared PO line state; flags when Supabase sync tables are not created yet. */
export async function fetchPoLineSyncMaps(): Promise<PoLineSyncMaps> {
  let missingSyncTables = false

  const load = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (isMissingTableError(e)) missingSyncTables = true
      return {} as T
    }
  }

  const [lineChecked, customerPicks, lineReceived] = await Promise.all([
    load(() => fetchPoLineCheckedMap()),
    load(() => fetchPoLineCustomerPickMap()),
    load(() => fetchPoLineReceivedMap()),
  ])

  return { lineChecked, customerPicks, lineReceived, missingSyncTables }
}
