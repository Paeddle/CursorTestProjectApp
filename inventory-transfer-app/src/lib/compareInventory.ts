import { normalizePartKey, type ParsedItem, type ParsedWorkbook } from './parseInventoryFiles'

export type MatchKind = 'both' | 'ipoint-only' | 'dtools-only'
export type QtyChoice = 'keep-dtools' | 'use-ipoint'

export type QtySlice = {
  sourceIndex: number
  partNumber: string
  item: string
  manufacturer: string
  qty: number
  qtyRaw: string
}

export type CompareLine = {
  id: string
  partKey: string
  ipointPartNumber: string
  dtoolsPartNumber: string
  match: MatchKind
  matchVia: string
  ipointQty: number | null
  dtoolsQty: number | null
  ipointRaw: string
  dtoolsRaw: string
  ipointItem: string
  ipointManufacturer: string
  dtoolsBrand: string
  dtoolsModel: string
  ipointRows: number
  dtoolsRowsForKey: number
  dtoolsSourceIndex: number | null
  notes: string[]
  qtyDiffers: boolean
  similarTo: string
  isSimilar: boolean
  similarPeerId: string
  similarIpointQty: number | null
  similarIpointRaw: string
  similarDtoolsQty: number | null
  similarDtoolsRaw: string
  similarDtoolsSourceIndex: number | null
  treatedAsSame: boolean
  ipointSlices: QtySlice[]
  groupSlices: QtySlice[]
  isGrouped: boolean
  groupDetail: string
  splitFromGroup: boolean
  splitParentId: string
  quantitiesCombined: boolean
  ipointSourceIndex: number | null
  ipointCategory: string
  ipointType: string
  ipointDescription: string
  ipointUnitCost: string
  ipointUnitPrice: string
}

export type CompareResult = {
  lines: CompareLine[]
  matchedKeys: number
  qtyDifferences: number
  ipointOnly: number
  dtoolsOnly: number
  ipointDuplicates: number
  dtoolsDuplicates: number
  similarCount: number
  groupedCount: number
  discrepancyCount: number
}

const SKIP_KEYS = new Set(['N/A', 'NA', '-', '--', 'NONE', 'NULL', '?', '#'])

function usableKey(value: string): string {
  const key = normalizePartKey(value)
  if (key.length < 2 || SKIP_KEYS.has(key)) return ''
  return key
}

function compactKey(value: string): string {
  return usableKey(value).replace(/[^A-Z0-9]/g, '')
}

function similarScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1000 + a.length
  const shorter = a.length <= b.length ? a : b
  const longer = a.length > b.length ? a : b
  if (shorter.length < 6) return 0
  if (longer.startsWith(shorter) || longer.includes(shorter)) return shorter.length
  return 0
}

function similarReason(left: string, right: string, leftLabel: string, rightLabel: string): string {
  if (!left || !right) return ''
  if (left === right) {
    return `${leftLabel} and ${rightLabel} match after ignoring hyphens and spaces`
  }
  const shorter = left.length <= right.length ? left : right
  const longer = left.length > right.length ? left : right
  const shorterLabel = left.length <= right.length ? leftLabel : rightLabel
  const longerLabel = left.length > right.length ? leftLabel : rightLabel
  if (longer.startsWith(shorter)) {
    return `${longerLabel} starts with ${shorterLabel}`
  }
  if (longer.includes(shorter)) {
    return `${shorterLabel} appears inside ${longerLabel}`
  }
  return `${leftLabel} is similar to ${rightLabel}`
}

function bestSimilar(
  keys: string[],
  others: { keys: string[]; item: ParsedItem; label: string }[],
): { item: ParsedItem; label: string; reason: string } | null {
  let best: { score: number; item: ParsedItem; label: string; left: string; right: string } | null = null
  for (const key of keys) {
    for (const other of others) {
      for (const otherKey of other.keys) {
        const score = similarScore(key, otherKey)
        if (score > (best?.score || 0)) {
          best = {
            score,
            item: other.item,
            label: other.label,
            left: key,
            right: otherKey,
          }
        }
      }
    }
  }
  if (!best) return null
  return {
    item: best.item,
    label: best.label,
    reason: similarReason(best.left, best.right, 'this SKU', best.label),
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function ipointKeys(item: ParsedItem): string[] {
  return unique([
    usableKey(item.partNumber),
    usableKey(item.itemName),
    compactKey(item.partNumber),
    compactKey(item.itemName),
  ])
}

function dtoolsKeys(item: ParsedItem): string[] {
  return unique([
    usableKey(item.partNumber),
    usableKey(item.model),
    compactKey(item.partNumber),
    compactKey(item.model),
  ])
}

function matchReasons(ipoint: ParsedItem, dtools: ParsedItem): string[] {
  const iPart = usableKey(ipoint.partNumber)
  const iItem = usableKey(ipoint.itemName)
  const dPart = usableKey(dtools.partNumber)
  const dModel = usableKey(dtools.model)
  const reasons: string[] = []
  if (iPart && dPart && iPart === dPart) reasons.push('iPoint part number = D-Tools part number')
  if (iPart && dModel && iPart === dModel) reasons.push('iPoint part number = D-Tools model')
  if (iItem && dPart && iItem === dPart) reasons.push('iPoint item = D-Tools part number')
  if (iItem && dModel && iItem === dModel) reasons.push('iPoint item = D-Tools model')
  const iCompact = unique([compactKey(ipoint.partNumber), compactKey(ipoint.itemName)])
  const dCompact = unique([compactKey(dtools.partNumber), compactKey(dtools.model)])
  if (reasons.length === 0 && iCompact.some((a) => dCompact.includes(a))) {
    reasons.push('same SKU after ignoring hyphens and spaces')
  }
  return reasons
}

function sumQty(items: ParsedItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0)
}

function sliceFrom(item: ParsedItem): QtySlice {
  return {
    sourceIndex: item.sourceIndex,
    partNumber: item.partNumber,
    item: item.itemName,
    manufacturer: item.manufacturer,
    qty: item.qty,
    qtyRaw: item.qtyRaw,
  }
}

function groupDetail(slices: QtySlice[], total: number): string {
  const parts = slices.map((s) => `${s.partNumber || s.item || 'row'} (${s.qtyRaw === '' ? 'blank→0' : s.qtyRaw})`)
  return `${parts.join(' + ')} = ${total}`
}

export function lineIsDiscrepancy(line: CompareLine): boolean {
  if (line.treatedAsSame) return true
  return line.qtyDiffers || line.isSimilar || line.match !== 'both' || line.isGrouped
}

const blankSimilar = {
  similarTo: '',
  isSimilar: false,
  similarPeerId: '',
  similarIpointQty: null as number | null,
  similarIpointRaw: '',
  similarDtoolsQty: null as number | null,
  similarDtoolsRaw: '',
  similarDtoolsSourceIndex: null as number | null,
  treatedAsSame: false,
}

function indexByKey(items: ParsedItem[], keysFor: (item: ParsedItem) => string[]): {
  byKey: Map<string, ParsedItem[]>
  duplicateKeys: number
} {
  const byKey = new Map<string, ParsedItem[]>()
  for (const item of items) {
    for (const key of keysFor(item)) {
      const list = byKey.get(key) || []
      if (!list.some((row) => row.sourceIndex === item.sourceIndex)) list.push(item)
      byKey.set(key, list)
    }
  }
  let duplicateKeys = 0
  for (const list of byKey.values()) {
    if (list.length > 1) duplicateKeys += 1
  }
  return { byKey, duplicateKeys }
}

type DtoolsMatch = {
  dtools: ParsedItem
  ipoints: ParsedItem[]
  reasons: Set<string>
}

export function compareInventories(ipoint: ParsedWorkbook, dtools: ParsedWorkbook): CompareResult {
  const dIndex = indexByKey(dtools.items, dtoolsKeys)
  const iIndex = indexByKey(ipoint.items, ipointKeys)
  const iSimilar = ipoint.items.map((item) => ({
    keys: unique([compactKey(item.partNumber), compactKey(item.itemName)]),
    item,
    label: item.partNumber || item.itemName,
  }))
  const dSimilar = dtools.items.map((item) => ({
    keys: unique([compactKey(item.partNumber), compactKey(item.model)]),
    item,
    label: item.partNumber || item.model,
  }))
  const matchedD = new Map<number, DtoolsMatch>()
  const matchedI = new Set<number>()

  const ipointHitCounts = new Map<number, number>()
  for (const ir of ipoint.items) {
    const hits = new Map<number, ParsedItem>()
    for (const key of ipointKeys(ir)) {
      for (const dr of dIndex.byKey.get(key) || []) hits.set(dr.sourceIndex, dr)
    }
    ipointHitCounts.set(ir.sourceIndex, 0)
    for (const dr of hits.values()) {
      const reasons = matchReasons(ir, dr)
      if (reasons.length === 0) continue
      ipointHitCounts.set(ir.sourceIndex, (ipointHitCounts.get(ir.sourceIndex) || 0) + 1)
      matchedI.add(ir.sourceIndex)
      let bucket = matchedD.get(dr.sourceIndex)
      if (!bucket) {
        bucket = { dtools: dr, ipoints: [], reasons: new Set() }
        matchedD.set(dr.sourceIndex, bucket)
      }
      if (!bucket.ipoints.some((row) => row.sourceIndex === ir.sourceIndex)) bucket.ipoints.push(ir)
      for (const reason of reasons) bucket.reasons.add(reason)
    }
  }

  const lines: CompareLine[] = []

  const matchedDRows = [...matchedD.values()].sort((a, b) =>
    (a.dtools.partNumber || a.dtools.model).localeCompare(b.dtools.partNumber || b.dtools.model),
  )

  for (const bucket of matchedDRows) {
    const dr = bucket.dtools
    const irows = bucket.ipoints
    const ipointQty = sumQty(irows)
    const slices = irows.map(sliceFrom)
    const isGrouped = slices.length > 1
    const notes: string[] = []
    if (isGrouped) {
      notes.push(`GROUPED: ${slices.length} iPoint rows were added together: ${groupDetail(slices, ipointQty)}`)
    }
    const shared = Math.max(...irows.map((row) => ipointHitCounts.get(row.sourceIndex) || 1), 1)
    if (shared > 1) {
      notes.push(
        `SHARED: at least one of these iPoint rows also matched ${shared} D-Tools products. The same iPoint stock is shown on each of those D-Tools rows so nothing is hidden.`,
      )
    }
    const qtyDiffers = ipointQty !== dr.qty
    if (qtyDiffers) notes.push('Quantity differs')
    lines.push({
      id: `b-${dr.sourceIndex}`,
      partKey: usableKey(dr.partNumber) || usableKey(dr.model) || String(dr.sourceIndex),
      ipointPartNumber: unique(irows.map((row) => row.partNumber).filter(Boolean)).join(' / '),
      dtoolsPartNumber: dr.partNumber,
      match: 'both',
      matchVia: [...bucket.reasons].join('; '),
      ipointQty,
      dtoolsQty: dr.qty,
      ipointRaw: isGrouped ? groupDetail(slices, ipointQty) : slices[0]?.qtyRaw || '',
      dtoolsRaw: dr.qtyRaw,
      ipointItem: unique(irows.map((row) => row.itemName)).join(' / '),
      ipointManufacturer: unique(irows.map((row) => row.manufacturer).filter(Boolean)).join(' / '),
      dtoolsBrand: dr.brand,
      dtoolsModel: dr.model,
      ipointRows: irows.length,
      dtoolsRowsForKey: shared,
      dtoolsSourceIndex: dr.sourceIndex,
      notes,
      qtyDiffers,
      ...blankSimilar,
      ipointSlices: slices,
      groupSlices: slices,
      isGrouped,
      groupDetail: isGrouped ? groupDetail(slices, ipointQty) : '',
      splitFromGroup: false,
      splitParentId: '',
      quantitiesCombined: true,
      ipointSourceIndex: irows[0]?.sourceIndex ?? null,
      ipointCategory: unique(irows.map((row) => row.category).filter(Boolean)).join(' / '),
      ipointType: unique(irows.map((row) => row.itemType).filter(Boolean)).join(' / '),
      ipointDescription: unique(irows.map((row) => row.descriptionCustomer).filter(Boolean)).join(' / '),
      ipointUnitCost: irows[0]?.unitHardCost || '',
      ipointUnitPrice: irows[0]?.unitPrice || '',
    })
  }

  for (const ir of ipoint.items) {
    if (matchedI.has(ir.sourceIndex)) continue
    const similar = bestSimilar(
      unique([compactKey(ir.partNumber), compactKey(ir.itemName)]),
      dSimilar,
    )
    const similarTo = similar?.label || ''
    const notes = ['In iPoint only — no exact D-Tools Model or Part Number match']
    if (similar) {
      notes.push(
        `Flagged similar to D-Tools ${similar.label}. ${similar.reason}. Quantity is not compared unless you treat them as the same part.`,
      )
    }
    lines.push({
      id: `i-${ir.sourceIndex}`,
      partKey: usableKey(ir.partNumber) || usableKey(ir.itemName) || String(ir.sourceIndex),
      ipointPartNumber: ir.partNumber,
      dtoolsPartNumber: similar?.item.partNumber || '',
      match: 'ipoint-only',
      matchVia: similar ? `Similar only — ${similar.reason}` : '',
      ipointQty: ir.qty,
      dtoolsQty: null,
      ipointRaw: ir.qtyRaw,
      dtoolsRaw: '',
      ipointItem: ir.itemName,
      ipointManufacturer: ir.manufacturer,
      dtoolsBrand: similar?.item.brand || '',
      dtoolsModel: similar?.item.model || '',
      ipointRows: 1,
      dtoolsRowsForKey: 0,
      dtoolsSourceIndex: null,
      notes,
      qtyDiffers: false,
      similarTo,
      isSimilar: Boolean(similarTo),
      similarPeerId: similar ? `d-${similar.item.sourceIndex}` : '',
      similarIpointQty: ir.qty,
      similarIpointRaw: ir.qtyRaw,
      similarDtoolsQty: similar ? similar.item.qty : null,
      similarDtoolsRaw: similar?.item.qtyRaw || '',
      similarDtoolsSourceIndex: similar ? similar.item.sourceIndex : null,
      treatedAsSame: false,
      ipointSlices: [sliceFrom(ir)],
      groupSlices: [sliceFrom(ir)],
      isGrouped: false,
      groupDetail: '',
      splitFromGroup: false,
      splitParentId: '',
      quantitiesCombined: true,
      ipointSourceIndex: ir.sourceIndex,
      ipointCategory: ir.category,
      ipointType: ir.itemType,
      ipointDescription: ir.descriptionCustomer,
      ipointUnitCost: ir.unitHardCost,
      ipointUnitPrice: ir.unitPrice,
    })
  }

  for (const dr of dtools.items) {
    if (matchedD.has(dr.sourceIndex)) continue
    const similar = bestSimilar(
      unique([compactKey(dr.partNumber), compactKey(dr.model)]),
      iSimilar,
    )
    const similarTo = similar?.label || ''
    const notes = ['In D-Tools only — no exact iPoint Item or Part Number match']
    if (similar) {
      notes.push(
        `Flagged similar to iPoint ${similar.label}. ${similar.reason}. Shown in the iPoint columns for comparison only — not a match unless you treat them as the same part.`,
      )
    }
    lines.push({
      id: `d-${dr.sourceIndex}`,
      partKey: usableKey(dr.partNumber) || usableKey(dr.model) || String(dr.sourceIndex),
      ipointPartNumber: similar?.item.partNumber || '',
      dtoolsPartNumber: dr.partNumber,
      match: 'dtools-only',
      matchVia: similar ? `Similar only — ${similar.reason}` : '',
      ipointQty: null,
      dtoolsQty: dr.qty,
      ipointRaw: '',
      dtoolsRaw: dr.qtyRaw,
      ipointItem: similar?.item.itemName || '',
      ipointManufacturer: similar?.item.manufacturer || '',
      dtoolsBrand: dr.brand,
      dtoolsModel: dr.model,
      ipointRows: 0,
      dtoolsRowsForKey: 1,
      dtoolsSourceIndex: dr.sourceIndex,
      notes,
      qtyDiffers: false,
      similarTo,
      isSimilar: Boolean(similarTo),
      similarPeerId: similar ? `i-${similar.item.sourceIndex}` : '',
      similarIpointQty: similar ? similar.item.qty : null,
      similarIpointRaw: similar?.item.qtyRaw || '',
      similarDtoolsQty: dr.qty,
      similarDtoolsRaw: dr.qtyRaw,
      similarDtoolsSourceIndex: dr.sourceIndex,
      treatedAsSame: false,
      ipointSlices: [],
      groupSlices: [],
      isGrouped: false,
      groupDetail: '',
      splitFromGroup: false,
      splitParentId: '',
      quantitiesCombined: true,
      ipointSourceIndex: similar?.item.sourceIndex ?? null,
      ipointCategory: similar?.item.category || '',
      ipointType: similar?.item.itemType || '',
      ipointDescription: similar?.item.descriptionCustomer || '',
      ipointUnitCost: similar?.item.unitHardCost || '',
      ipointUnitPrice: similar?.item.unitPrice || '',
    })
  }

  return {
    lines,
    matchedKeys: matchedD.size,
    qtyDifferences: lines.filter((l) => l.qtyDiffers).length,
    ipointOnly: lines.filter((l) => l.match === 'ipoint-only').length,
    dtoolsOnly: lines.filter((l) => l.match === 'dtools-only').length,
    ipointDuplicates: iIndex.duplicateKeys,
    dtoolsDuplicates: dIndex.duplicateKeys,
    similarCount: lines.filter((l) => l.isSimilar).length,
    groupedCount: lines.filter((l) => l.isGrouped).length,
    discrepancyCount: lines.filter(lineIsDiscrepancy).length,
  }
}

export function applyTreatedSimilar(
  lines: CompareLine[],
  treatedIds: Record<string, boolean>,
): CompareLine[] {
  const isTreated = (line: CompareLine) =>
    Boolean(treatedIds[line.id] || (line.similarPeerId && treatedIds[line.similarPeerId]))

  const out: CompareLine[] = []
  for (const line of lines) {
    const treated = line.isSimilar && isTreated(line)
    if (!treated) {
      out.push(line)
      continue
    }

    const ipointQty = line.ipointQty ?? line.similarIpointQty
    const dtoolsQty = line.dtoolsQty ?? line.similarDtoolsQty
    const qtyDiffers = ipointQty != null && dtoolsQty != null && ipointQty !== dtoolsQty
    out.push({
      ...line,
      match: line.similarDtoolsSourceIndex != null && ipointQty != null ? 'both' : line.match,
      ipointQty,
      dtoolsQty,
      ipointRaw: line.ipointRaw || line.similarIpointRaw,
      dtoolsRaw: line.dtoolsRaw || line.similarDtoolsRaw,
      ipointItem: line.ipointItem,
      dtoolsSourceIndex: line.dtoolsSourceIndex ?? line.similarDtoolsSourceIndex,
      qtyDiffers,
      treatedAsSame: true,
      matchVia: `Treated as the same part${line.similarTo ? ` — ${line.similarTo}` : ''}`,
      notes: [
        'You chose to treat these similar SKUs as the same part.',
        qtyDiffers ? 'Quantity differs' : 'Counts match',
      ],
    })
  }
  return out
}

export function applyUncombined(
  lines: CompareLine[],
  uncombined: Record<string, boolean>,
): CompareLine[] {
  return lines.map((line) => {
    if (line.groupSlices.length < 2 || !uncombined[line.id]) return line
    return {
      ...line,
      ipointQty: null,
      ipointRaw: '',
      qtyDiffers: false,
      isGrouped: true,
      quantitiesCombined: false,
      groupDetail: '',
      notes: [
        'iPoint quantities are not added together. The Products.csv row will keep its current D-Tools quantity.',
      ],
    }
  })
}

export function defaultChoices(lines: CompareLine[]): Record<string, QtyChoice> {
  const out: Record<string, QtyChoice> = {}
  for (const line of lines) out[line.id] = 'keep-dtools'
  return out
}

export function normalizeSearch(q: string): string {
  return normalizePartKey(q)
}
