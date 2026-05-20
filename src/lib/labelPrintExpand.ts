import type { PoLabelPrintRow } from '../types/poIpoint'
import { parseLabelKey } from './labelKey'

/**
 * Print `quantity` stickers per PO line. Cycles through selected room names when there
 * are several; repeats the only location (or null) when qty exceeds location count.
 */
export function expandLabelRowsByQuantity(
  rows: PoLabelPrintRow[],
  quantityByLineId: Map<string, number>
): PoLabelPrintRow[] {
  if (rows.length === 0) return []

  const byLine = new Map<string, PoLabelPrintRow[]>()
  for (const row of rows) {
    const parsed = parseLabelKey(row.key)
    const lineId = parsed?.lineId ?? row.key
    if (!byLine.has(lineId)) byLine.set(lineId, [])
    byLine.get(lineId)!.push(row)
  }

  const expanded: PoLabelPrintRow[] = []

  for (const [lineId, lineRows] of byLine) {
    const qty = Math.max(1, Math.round(quantityByLineId.get(lineId) ?? 1))

    for (let i = 0; i < qty; i++) {
      const src = lineRows[i % lineRows.length]!
      expanded.push({
        ...src,
        key: `${src.key}@q${i}`,
        location_name: src.location_name ?? null,
      })
    }
  }

  return expanded
}
