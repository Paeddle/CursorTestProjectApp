import { supabase } from '../lib/supabase'
import { poLineItemDbKeys, poLineItemKey } from '../lib/poLineCustomerOverride'

const TABLE = 'po_line_last_scan'
const PAGE = 1000

type Row = { po_key: string; item_key: string; scanned_at: string }

export async function fetchPoLineLastScanMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('po_key, item_key, scanned_at')
      .order('po_key', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as Row[]
    for (const row of rows) {
      out[`${row.po_key}|${row.item_key}`] = row.scanned_at
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  return out
}

export async function upsertPoLineLastScan(
  poNumber: string,
  itemName: string,
  scannedAt: string
): Promise<void> {
  const { po_key, item_key } = poLineItemDbKeys(poNumber, itemName)
  const ms = new Date(scannedAt).getTime()
  if (!Number.isFinite(ms)) return

  const { error } = await supabase.from(TABLE).upsert(
    {
      po_key,
      item_key,
      scanned_at: new Date(ms).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'po_key,item_key' }
  )
  if (error) throw new Error(error.message)
}

export function lastScanStorageKey(poNumber: string, itemName: string): string {
  return poLineItemKey(poNumber, itemName)
}

export function pickLatestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}
