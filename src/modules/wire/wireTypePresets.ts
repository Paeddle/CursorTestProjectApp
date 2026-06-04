export interface WireTypePreset {
  id: string
  label: string
  defaultCapacityFt: number
}

export const WIRE_TYPE_PRESETS: WireTypePreset[] = [
  { id: 'rg6-quad-shield', label: 'RG-6 Quad Shield', defaultCapacityFt: 500 },
  { id: 'cat6-550mhz-blue', label: 'Cat6 550MHz Blue', defaultCapacityFt: 1000 },
  { id: 'cat6-550mhz-gray', label: 'Cat6 550MHz Gray', defaultCapacityFt: 1000 },
  { id: 'cat6-550mhz-white', label: 'Cat6 550MHz White', defaultCapacityFt: 1000 },
  { id: 'cat6-550mhz-black', label: 'Cat6 550MHz Black', defaultCapacityFt: 1000 },
  { id: 'cat6a-slim', label: 'Cat6A Slim', defaultCapacityFt: 1000 },
  { id: 'cat7', label: 'Cat7', defaultCapacityFt: 1000 },
  { id: 'cat8', label: 'Cat8', defaultCapacityFt: 1000 },
  { id: 'optical-fiber-cable', label: 'Optical Fiber Cable', defaultCapacityFt: 1000 },
  { id: 'lutron-green', label: 'Lutron Green', defaultCapacityFt: 1000 },
  { id: 'lutron-qs-m', label: 'Lutron QS/M', defaultCapacityFt: 1000 },
  { id: '18-4cs-security-wire', label: '18-4CS Security Wire', defaultCapacityFt: 500 },
  { id: '18-2cs-security-wire', label: '18-2CS Security Wire', defaultCapacityFt: 500 },
  { id: '22-4-stranded-security-wire', label: '22-4 Stranded Security Wire', defaultCapacityFt: 1000 },
  { id: '22-2-stranded-security-wire', label: '22-2 Stranded Security Wire', defaultCapacityFt: 1000 },
  { id: '16-2fx-db-speaker-wire', label: '16-2FX DB Speaker Wire', defaultCapacityFt: 500 },
  { id: '16-4fx-db-speaker-wire', label: '16-4FX DB Speaker Wire', defaultCapacityFt: 500 },
  { id: '14-2fx-db-speaker-wire', label: '14-2FX DB Speaker Wire', defaultCapacityFt: 500 },
  { id: '14-4fx-db-speaker-wire', label: '14-4FX DB Speaker Wire', defaultCapacityFt: 500 },
  { id: '12-2fx-db-speaker-wire', label: '12-2FX DB Speaker Wire', defaultCapacityFt: 500 },
  { id: '12-4fx-db-speaker-wire', label: '12-4FX DB Speaker Wire', defaultCapacityFt: 500 },
]

export function getWireTypePreset(id: string): WireTypePreset | undefined {
  return WIRE_TYPE_PRESETS.find((p) => p.id === id)
}

export function resolveWireTypePreset(raw: string | null | undefined): WireTypePreset | undefined {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  const byExactId = WIRE_TYPE_PRESETS.find((p) => p.id === t)
  if (byExactId) return byExactId
  const lower = t.toLowerCase()
  const byIdCi = WIRE_TYPE_PRESETS.find((p) => p.id.toLowerCase() === lower)
  if (byIdCi) return byIdCi
  const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const nl = normLabel(t)
  return WIRE_TYPE_PRESETS.find((p) => normLabel(p.label) === nl)
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

