import { supabase } from '../lib/supabase'
import {
  WIRE_TYPE_PRESETS,
  type WireTypePreset,
  slugifyWireTypeId,
} from '../wireTypePresets'

type WireTypeRow = {
  id: string
  label: string
  default_capacity_ft: number
  is_active?: boolean
  sort_order?: number
}

function rowToPreset(row: WireTypeRow): WireTypePreset {
  return {
    id: String(row.id).trim(),
    label: String(row.label).trim(),
    defaultCapacityFt: Number(row.default_capacity_ft) || 0,
  }
}

/** Active types from Supabase, sorted by name; seed fallback if empty/unreachable. */
export async function fetchActiveWireTypes(): Promise<WireTypePreset[]> {
  try {
    const { data, error } = await supabase
      .from('wire_types')
      .select('id, label, default_capacity_ft, is_active, sort_order')
      .eq('is_active', true)
      .order('label', { ascending: true })

    if (error) throw error
    const list = (data ?? [])
      .map((r) => rowToPreset(r as WireTypeRow))
      .filter((p) => p.id && p.label && p.defaultCapacityFt > 0)

    if (list.length === 0) {
      return [...WIRE_TYPE_PRESETS].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      )
    }
    return list.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    )
  } catch {
    return [...WIRE_TYPE_PRESETS].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    )
  }
}

export async function addWireType(input: {
  label: string
  defaultCapacityFt: number
}): Promise<WireTypePreset> {
  const label = String(input.label ?? '').trim().replace(/\s+/g, ' ')
  if (!label) throw new Error('Enter a wire type name.')

  const capacity = Math.round(Number(input.defaultCapacityFt))
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error('Default spool feet must be a positive number.')
  }

  const id = slugifyWireTypeId(label)
  if (!id) throw new Error('Could not make an id from that name. Use letters or numbers.')

  const { data: existing, error: existErr } = await supabase
    .from('wire_types')
    .select('id, label, is_active')
    .eq('id', id)
    .maybeSingle()

  if (existErr) throw new Error(existErr.message)

  if (existing) {
    const row = existing as { id: string; label: string; is_active: boolean }
    if (row.is_active) {
      throw new Error(`“${row.label || id}” is already in the list.`)
    }
    const { data, error } = await supabase
      .from('wire_types')
      .update({
        label,
        default_capacity_ft: capacity,
        is_active: true,
      })
      .eq('id', id)
      .select('id, label, default_capacity_ft')
      .single()
    if (error) throw new Error(error.message)
    return rowToPreset(data as WireTypeRow)
  }

  const { count } = await supabase
    .from('wire_types')
    .select('*', { count: 'exact', head: true })

  const sortOrder = ((count ?? 0) + 1) * 10

  const { data, error } = await supabase
    .from('wire_types')
    .insert({
      id,
      label,
      default_capacity_ft: capacity,
      is_active: true,
      sort_order: sortOrder,
    })
    .select('id, label, default_capacity_ft')
    .single()

  if (error) {
    if (/duplicate|unique|conflict/i.test(error.message)) {
      throw new Error(`A wire type with id “${id}” already exists.`)
    }
    if (/relation .*wire_types.* does not exist|Could not find the table/i.test(error.message)) {
      throw new Error(
        `${error.message} Run supabase/add-wire-types.sql in the Supabase SQL Editor first.`,
      )
    }
    throw new Error(error.message)
  }

  return rowToPreset(data as WireTypeRow)
}

/** Soft-delete: hide from dropdowns; scan history keeps stored labels. */
export async function deactivateWireType(id: string): Promise<void> {
  const trimmed = String(id ?? '').trim()
  if (!trimmed) throw new Error('Missing wire type id.')

  const { error } = await supabase
    .from('wire_types')
    .update({ is_active: false })
    .eq('id', trimmed)

  if (error) {
    if (/relation .*wire_types.* does not exist|Could not find the table/i.test(error.message)) {
      throw new Error(
        `${error.message} Run supabase/add-wire-types.sql in the Supabase SQL Editor first.`,
      )
    }
    throw new Error(error.message)
  }
}
