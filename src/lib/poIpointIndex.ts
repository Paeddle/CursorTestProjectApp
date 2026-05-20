import type { AggregatedPoLineItem } from './poLineAggregate'
import {
  dedupeLocationsByName,
  findItemLocations,
  ipointScannedLineIds,
  locationNamesForLine,
  locationsForLine,
  normalizeRefNumber,
} from './poIpointMatch'
import type { BarcodeCatalogItem, POBarcode } from '../types/poCheckin'
import type { PoItemLocation, PoJobRef, PoLineItem } from '../types/poIpoint'

/** Locations grouped by normalized job ref (built once per load). */
export type IpointLocationIndex = {
  byRef: Map<string, PoItemLocation[]>
  all: PoItemLocation[]
}

export function buildIpointLocationIndex(locations: PoItemLocation[]): IpointLocationIndex {
  const byRef = new Map<string, PoItemLocation[]>()
  for (const loc of locations) {
    const ref = normalizeRefNumber(loc.ref_number)
    if (!ref) continue
    if (!byRef.has(ref)) byRef.set(ref, [])
    byRef.get(ref)!.push(loc)
  }
  return { byRef, all: locations }
}

export function locationNamesForLineIndexed(
  line: PoLineItem,
  jobRefs: PoJobRef[],
  index: IpointLocationIndex
): string[] {
  return locationNamesForLine(line, jobRefs, index.all)
}

export function findItemLocationsIndexed(
  productName: string,
  refNumber: string | null | undefined,
  index: IpointLocationIndex
): PoItemLocation[] {
  return findItemLocations(productName, refNumber, index.all)
}

export type IpointLineDisplayCache = Map<
  string,
  { locationNames: string[]; labelKeys: string[] }
>

export function buildIpointLineDisplayCache(
  poNumber: string,
  lines: PoLineItem[],
  jobRefs: PoJobRef[],
  index: IpointLocationIndex,
  makeLabelKey: (po: string, lineId: string, locationName?: string) => string
): IpointLineDisplayCache {
  const cache: IpointLineDisplayCache = new Map()
  for (const line of lines) {
    const locationNames = locationNamesForLineIndexed(line, jobRefs, index)
    const labelKeys =
      locationNames.length === 0
        ? [makeLabelKey(poNumber, line.id, '')]
        : locationNames.map((name) => makeLabelKey(poNumber, line.id, name))
    cache.set(line.id, { locationNames, labelKeys })
  }
  return cache
}

export function ipointScannedLineIdsForPo(
  lines: PoLineItem[],
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  index: IpointLocationIndex,
  jobRefs: PoJobRef[]
): Set<string> {
  return ipointScannedLineIds(lines, barcodes, catalogMap, index.all, jobRefs)
}

function locationNamesForAggregatedLine(
  line: AggregatedPoLineItem,
  sourceById: Map<string, PoLineItem>,
  jobRefs: PoJobRef[],
  index: IpointLocationIndex
): string[] {
  const matches: PoItemLocation[] = []
  for (const id of line.sourceLineIds) {
    const src = sourceById.get(id)
    if (!src) continue
    matches.push(...locationsForLine(src, jobRefs, index.all))
  }
  return dedupeLocationsByName(matches).map((m) => m.location_name.trim()).filter(Boolean)
}

/** Display cache for aggregated PO line rows (one per item, total Req. qty). */
export function buildAggregatedIpointLineDisplayCache(
  poNumber: string,
  aggregatedLines: AggregatedPoLineItem[],
  sourceLines: PoLineItem[],
  jobRefs: PoJobRef[],
  index: IpointLocationIndex,
  makeLabelKey: (po: string, lineId: string, locationName?: string) => string
): IpointLineDisplayCache {
  const sourceById = new Map(sourceLines.map((l) => [l.id, l]))
  const cache: IpointLineDisplayCache = new Map()

  for (const line of aggregatedLines) {
    const locationNames = locationNamesForAggregatedLine(line, sourceById, jobRefs, index)
    const labelKeys =
      locationNames.length === 0
        ? [makeLabelKey(poNumber, line.id, '')]
        : locationNames.map((name) => makeLabelKey(poNumber, line.id, name))
    cache.set(line.id, { locationNames, labelKeys })
  }
  return cache
}

export function ipointScannedIdsForAggregatedLines(
  aggregatedLines: AggregatedPoLineItem[],
  sourceLines: PoLineItem[],
  barcodes: POBarcode[],
  catalogMap: Map<string, BarcodeCatalogItem>,
  index: IpointLocationIndex,
  jobRefs: PoJobRef[]
): Set<string> {
  const scannedSource = ipointScannedLineIds(sourceLines, barcodes, catalogMap, index.all, jobRefs)
  const out = new Set<string>()
  for (const line of aggregatedLines) {
    if (line.sourceLineIds.some((id) => scannedSource.has(id))) {
      out.add(line.id)
    }
  }
  return out
}
