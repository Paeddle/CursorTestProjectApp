export interface WireTypePreset {
  id: string
  label: string
  /** Typical full-spool length (ft) when the box is new */
  defaultCapacityFt: number
}

/** Defaults match common NM-B reel sizes; adjust in code if your inventory differs. */
export const WIRE_TYPE_PRESETS: WireTypePreset[] = [
  { id: '14-2-nm-b', label: '14/2 NM-B w/ ground', defaultCapacityFt: 500 },
  { id: '14-3-nm-b', label: '14/3 NM-B w/ ground', defaultCapacityFt: 500 },
  { id: '12-2-nm-b', label: '12/2 NM-B w/ ground', defaultCapacityFt: 250 },
  { id: '12-3-nm-b', label: '12/3 NM-B w/ ground', defaultCapacityFt: 250 },
  { id: '10-2-nm-b', label: '10/2 NM-B w/ ground', defaultCapacityFt: 250 },
  { id: '10-3-nm-b', label: '10/3 NM-B w/ ground', defaultCapacityFt: 250 },
  { id: '8-2-nm-b', label: '8/2 NM-B w/ ground', defaultCapacityFt: 125 },
  { id: '8-3-nm-b', label: '8/3 NM-B w/ ground', defaultCapacityFt: 125 },
  { id: '6-3-nm-b', label: '6/3 NM-B w/ ground', defaultCapacityFt: 125 },
  { id: '12-2-mc', label: '12/2 MC', defaultCapacityFt: 250 },
  { id: '14-2-mc', label: '14/2 MC', defaultCapacityFt: 250 },
  { id: 'low-voltage', label: 'Low voltage / data', defaultCapacityFt: 1000 },
]

export function getWireTypePreset(id: string): WireTypePreset | undefined {
  return WIRE_TYPE_PRESETS.find((p) => p.id === id)
}

export function parseFootageNumber(raw: string): number | null {
  const s = String(raw ?? '')
    .replace(/,/g, '')
    .replace(/ft\.?/gi, '')
    .trim()
  const m = s.match(/-?[\d.]+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}
