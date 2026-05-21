import { supabase } from '../lib/supabase'
import { poLineItemDbKeys } from '../lib/poLineCustomerOverride'

const TABLE = 'po_line_customer_pick'
const PAGE = 1000

type Row = { po_key: string; item_key: string; job_or_customer: string }

export async function fetchPoLineCustomerPickMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('po_key, item_key, job_or_customer')
      .order('po_key', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as Row[]
    for (const row of rows) {
      out[`${row.po_key}|${row.item_key}`] = row.job_or_customer
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  return out
}

export async function setPoLineCustomerPick(
  poNumber: string,
  itemName: string,
  jobOrCustomer: string
): Promise<void> {
  const { po_key, item_key } = poLineItemDbKeys(poNumber, itemName)
  const job = jobOrCustomer.trim()
  if (!job) throw new Error('Job / customer is required')

  const { error } = await supabase.from(TABLE).upsert(
    { po_key, item_key, job_or_customer: job, updated_at: new Date().toISOString() },
    { onConflict: 'po_key,item_key' }
  )
  if (error) throw new Error(error.message)
}

