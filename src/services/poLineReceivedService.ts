import { supabase } from '../lib/supabase'
import { poLineItemDbKeys, poLineItemKey } from '../lib/poLineCustomerOverride'
import { normalizePoKey } from '../lib/poIpointMatch'

const TABLE = 'po_line_received'
const PAGE = 1000

type Row = { po_key: string; item_key: string; received_qty: number }

export async function fetchPoLineReceivedMap(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('po_key, item_key, received_qty')
      .order('po_key', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as Row[]
    for (const row of rows) {
      out[`${row.po_key}|${row.item_key}`] = Math.max(0, Math.round(row.received_qty))
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  return out
}

export async function setPoLineReceivedQty(
  poNumber: string,
  itemName: string,
  receivedQty: number
): Promise<void> {
  const { po_key, item_key } = poLineItemDbKeys(poNumber, itemName)
  const qty = Math.max(0, Math.round(receivedQty))

  if (qty === 0) {
    const { error } = await supabase.from(TABLE).delete().eq('po_key', po_key).eq('item_key', item_key)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase.from(TABLE).upsert(
    { po_key, item_key, received_qty: qty, updated_at: new Date().toISOString() },
    { onConflict: 'po_key,item_key' }
  )
  if (error) throw new Error(error.message)
}

export function receivedKey(poNumber: string, itemName: string): string {
  return poLineItemKey(poNumber, itemName)
}

export async function setAllPoLinesReceivedForPo(
  poNumber: string,
  entries: { itemName: string; receivedQty: number }[],
  clearPo: boolean
): Promise<void> {
  const po_key = normalizePoKey(poNumber)

  if (clearPo) {
    const { error } = await supabase.from(TABLE).delete().eq('po_key', po_key)
    if (error) throw new Error(error.message)
    return
  }

  const now = new Date().toISOString()
  const rows = entries
    .map((e) => {
      const qty = Math.max(0, Math.round(e.receivedQty))
      if (qty <= 0) return null
      const { po_key: pk, item_key } = poLineItemDbKeys(poNumber, e.itemName)
      return { po_key: pk, item_key, received_qty: qty, updated_at: now }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  if (rows.length === 0) return

  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from(TABLE).upsert(rows.slice(i, i + BATCH), {
      onConflict: 'po_key,item_key',
    })
    if (error) throw new Error(error.message)
  }
}
