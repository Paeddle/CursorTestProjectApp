import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'
import type { AggregatedPoLineItem } from './poLineAggregate'
import { resolveAggregatedLine } from './poLineAggregate'
import { locationNamesForLine, normalizePoKey } from './poIpointMatch'
import { makeLabelKey, parseLabelKey } from './labelKey'

/** Label keys for one aggregated row (respects selected customer / active source lines). */
export function labelKeysForAggregatedLine(
  poNumber: string,
  line: AggregatedPoLineItem,
  jobRefs: PoJobRef[],
  itemLocations: PoItemLocation[],
  sourceLines: PoLineItem[],
  customerOverrides: Record<string, string>
): string[] {
  const resolved = resolveAggregatedLine(line, customerOverrides, sourceLines)
  const names = new Set<string>()
  const sourceById = new Map(sourceLines.map((l) => [l.id, l]))
  for (const id of resolved.activeSourceLineIds) {
    const src = sourceById.get(id)
    if (!src) continue
    for (const name of locationNamesForLine(src, jobRefs, itemLocations)) {
      names.add(name)
    }
  }
  const list = [...names].sort((a, b) => a.localeCompare(b))
  if (list.length === 0) return [makeLabelKey(poNumber, line.id, '')]
  return list.map((name) => makeLabelKey(poNumber, line.id, name))
}

/** Resolve aggregated line for a saved print key (handles stale ids after PO re-import). */
export function findAggregatedLineForLabelKey(
  key: string,
  poNumber: string,
  poLines: AggregatedPoLineItem[],
  jobRefs: PoJobRef[],
  itemLocations: PoItemLocation[],
  sourceLines: PoLineItem[],
  customerOverrides: Record<string, string>
): AggregatedPoLineItem | undefined {
  const parsed = parseLabelKey(key)
  if (!parsed || parsed.poKey !== normalizePoKey(poNumber)) return undefined

  const byId = poLines.find((l) => l.id === parsed.lineId)
  if (byId) return byId

  for (const line of poLines) {
    const keys = labelKeysForAggregatedLine(
      poNumber,
      line,
      jobRefs,
      itemLocations,
      sourceLines,
      customerOverrides
    )
    if (keys.includes(key)) return line
  }
  return undefined
}
