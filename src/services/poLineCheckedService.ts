import { supabase } from '../lib/supabase'
import { poLineItemDbKeys } from '../lib/poLineCustomerOverride'
import { normalizePoKey } from '../lib/poIpointMatch'

const TABLE = 'po_line_checked'
const PAGE = 1000

type PoLineCheckedRow = {
  po_key: string
  item_key: string
}

/** Load all checked iPoint lines into the in-memory map shape used by PO Info. */
export async function fetchPoLineCheckedMap(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('po_key, item_key')
      .order('po_key', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as PoLineCheckedRow[]
    for (const row of rows) {
      out[`${row.po_key}|${row.item_key}`] = true
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  return out
}

export async function setPoLineChecked(
  poNumber: string,
  itemName: string,
  checked: boolean
): Promise<void> {
  const { po_key, item_key } = poLineItemDbKeys(poNumber, itemName)

  if (checked) {
    const { error } = await supabase.from(TABLE).upsert(
      { po_key, item_key, updated_at: new Date().toISOString() },
      { onConflict: 'po_key,item_key' }
    )
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase.from(TABLE).delete().eq('po_key', po_key).eq('item_key', item_key)
  if (error) throw new Error(error.message)
}

export async function setAllPoLinesCheckedForPo(
  poNumber: string,
  lines: { item_name: string }[],
  checked: boolean
): Promise<void> {
  const po_key = normalizePoKey(poNumber)

  if (!checked) {
    const { error } = await supabase.from(TABLE).delete().eq('po_key', po_key)
    if (error) throw new Error(error.message)
    return
  }

  if (lines.length === 0) return

  const rows = lines.map((line) => {
    const keys = poLineItemDbKeys(poNumber, line.item_name)
    return { po_key: keys.po_key, item_key: keys.item_key, updated_at: new Date().toISOString() }
  })

  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from(TABLE).upsert(chunk, { onConflict: 'po_key,item_key' })
    if (error) throw new Error(error.message)
  }
}

/** One-time merge of legacy browser-only checks into Supabase (best-effort). */
export async function migrateLocalPoLineCheckedToSupabase(
  local: Record<string, boolean>
): Promise<void> {
  const keys = Object.keys(local).filter((k) => local[k])
  if (keys.length === 0) return

  const rows = keys.map((key) => {
    const sep = key.indexOf('|')
    const po_key = sep >= 0 ? key.slice(0, sep) : key
    const item_key = sep >= 0 ? key.slice(sep + 1) : ''
    return { po_key, item_key, updated_at: new Date().toISOString() }
  }).filter((r) => r.po_key && r.item_key)

  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'po_key,item_key' })
    if (error) throw new Error(error.message)
  }
}
