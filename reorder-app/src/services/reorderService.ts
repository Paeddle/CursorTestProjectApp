import { supabase } from '../lib/supabase'
import type { ReorderRequestInput } from '../types'

const TABLE = 'reorder_requests'

export async function submitReorderRequest(input: ReorderRequestInput): Promise<{ id: string }> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      item_id: input.item_id,
      part_number: input.part_number,
      item_name: input.item_name,
      manufacturer: input.manufacturer,
      vendor_name: input.vendor_name,
      barcode: input.barcode,
      description: input.description,
      stock_available: input.stock_available,
      quantity: input.quantity,
      job: input.job,
      requested_by: input.requested_by,
      notes: input.notes,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return { id: data.id as string }
}
