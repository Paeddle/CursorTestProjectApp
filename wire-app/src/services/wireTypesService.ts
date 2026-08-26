import { supabase } from '../lib/supabase'
import { WIRE_TYPE_PRESETS, type WireTypePreset } from '../wireTypePresets'

type WireTypeRow = {
  id: string
  label: string
  default_capacity_ft: number
}

function rowToPreset(row: WireTypeRow): WireTypePreset {
  return {
    id: String(row.id).trim(),
    label: String(row.label).trim(),
    defaultCapacityFt: Number(row.default_capacity_ft) || 0,
  }
}

/** Active types from Supabase, or seed fallback if empty/unreachable. */
export async function fetchActiveWireTypes(): Promise<WireTypePreset[]> {
  try {
    const { data, error } = await supabase
      .from('wire_types')
      .select('id, label, default_capacity_ft, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })

    if (error) throw error
    const list = (data ?? [])
      .map((r) => rowToPreset(r as WireTypeRow))
      .filter((p) => p.id && p.label && p.defaultCapacityFt > 0)

    return list.length > 0 ? list : [...WIRE_TYPE_PRESETS]
  } catch {
    return [...WIRE_TYPE_PRESETS]
  }
}
