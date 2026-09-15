import { supabase } from '../lib/supabase'
import type { ReorderRequestInput } from '../types'
import { getReorderColumnSchema, toInsertRow } from './reorderSchema'

const TABLE = 'reorder_requests'

export async function submitReorderRequest(input: ReorderRequestInput): Promise<{ id: string }> {
  if (!supabase) throw new Error('Supabase is not configured')

  const schema = await getReorderColumnSchema()
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toInsertRow(input, schema))
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return { id: data.id as string }
}
