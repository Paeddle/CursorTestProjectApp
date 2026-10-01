import { supabase } from '../lib/supabase'
import { compareWireTypeLabelsDisplay } from '../../../wire-app/src/wireReport'
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

/** Active types from Supabase, same order as the Wire Tracker inventory list. */
export async function fetchActiveWireTypes(): Promise<WireTypePreset[]> {
  const byDisplay = (list: WireTypePreset[]) =>
    [...list].sort((a, b) => compareWireTypeLabelsDisplay(a.label, b.label))
  if (!supabase) return byDisplay(WIRE_TYPE_PRESETS)

  try {
    const { data, error } = await supabase
      .from('wire_types')
      .select('id, label, default_capacity_ft, is_active, sort_order')
      .eq('is_active', true)

    if (error) throw error
    const list = (data ?? [])
      .map((r) => rowToPreset(r as WireTypeRow))
      .filter((p) => p.id && p.label && p.defaultCapacityFt > 0)

    if (list.length === 0) return byDisplay(WIRE_TYPE_PRESETS)
    return byDisplay(list)
  } catch {
    return byDisplay(WIRE_TYPE_PRESETS)
  }
}
