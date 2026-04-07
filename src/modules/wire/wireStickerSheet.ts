import type { WireBoxScan } from '../../types/wireBox'
import { wireTypeIdToDefaultFt, wireTypeIdToLabel } from './wireReport'

/** Inclusive range of sticker indices (BOX_0000 … BOX_1000 → 1001 rows). */
export const STICKER_BOX_INDEX_START = 0
export const STICKER_BOX_INDEX_END = 1000

export function formatStickerBoxId(index: number): string {
  if (
    index < STICKER_BOX_INDEX_START ||
    index > STICKER_BOX_INDEX_END ||
    !Number.isInteger(index)
  ) {
    throw new Error(`Sticker index must be an integer ${STICKER_BOX_INDEX_START}–${STICKER_BOX_INDEX_END}`)
  }
  return `BOX_${String(index).padStart(4, '0')}`
}

/**
 * Maps a stored `box_id` to canonical `BOX_NNNN` if it is in range.
 * Accepts e.g. BOX_0001, box_0001, BOX-0001, BOX_1.
 */
export function normalizeStoredBoxIdToStickerKey(boxId: string): string | null {
  const u = boxId.trim().toUpperCase().replace(/-/g, '_')
  const m = u.match(/^BOX_(\d{1,4})$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < STICKER_BOX_INDEX_START || n > STICKER_BOX_INDEX_END) return null
  return formatStickerBoxId(n)
}

function escapeCsvField(val: string): string {
  if (/[",\n\r]/.test(val)) return `"${val.replace(/"/g, '""')}"`
  return val
}

/**
 * CSV with columns BOX_ID, WIRE_TYPE, DEFAULT_WIRE_FT for sticker/bulk print workflows.
 * WIRE_TYPE uses DB labels when a scan exists for that BOX_nnnn with wire_type.
 */
export function buildStickerSheetCsv(allScans: WireBoxScan[]): string {
  const byStickerKey = new Map<string, { wireType: string; defaultFt: string }>()
  const sorted = [...allScans].sort(
    (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
  )

  for (const scan of sorted) {
    const wtId = String(scan.wire_type ?? '').trim()
    if (!wtId) continue
    const key = normalizeStoredBoxIdToStickerKey(scan.box_id)
    if (!key || byStickerKey.has(key)) continue
    const wireType =
      (scan.wire_type_label || '').trim() || wireTypeIdToLabel(scan.wire_type) || ''
    const defaultFt =
      (scan.wire_type_default_ft || '').trim() || wireTypeIdToDefaultFt(scan.wire_type) || ''
    byStickerKey.set(key, { wireType, defaultFt })
  }

  const header = ['BOX_ID', 'WIRE_TYPE', 'DEFAULT_WIRE_FT']
  const lines = [header.join(',')]
  for (let i = STICKER_BOX_INDEX_START; i <= STICKER_BOX_INDEX_END; i++) {
    const boxId = formatStickerBoxId(i)
    const info = byStickerKey.get(boxId)
    lines.push(
      [
        escapeCsvField(boxId),
        escapeCsvField(info?.wireType ?? ''),
        escapeCsvField(info?.defaultFt ?? ''),
      ].join(','),
    )
  }

  return '\uFEFF' + lines.join('\n') + '\n'
}
