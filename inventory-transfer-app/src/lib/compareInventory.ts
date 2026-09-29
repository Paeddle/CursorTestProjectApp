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

export type SimilarCandidate = {
  id: string
  sourceIndex: number
  optionLabel: string
  label: string
  reason: string
  score: number
  partNumber: string
  itemName: string
  manufacturer: string
  brand: string
  model: string
  qty: number
  qtyRaw: string
  category: string
  itemType: string
  descriptionCustomer: string
  unitHardCost: string
  unitPrice: string
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
  similarCandidates: SimilarCandidate[]
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

/** Allow at most this many character edits between similar SKUs. */
const MAX_SIMILAR_EDITS = 5
/** Short codes must match exactly; keeps tiny SKUs from matching noise. */
const MIN_SIMILAR_LEN = 5

function usableKey(value: string): string {
  const key = normalizePartKey(value)
  if (key.length < 2 || SKIP_KEYS.has(key)) return ''
  return key
}

function compactKey(value: string): string {
  return usableKey(value).replace(/[^A-Z0-9]/g, '')
}

/** Levenshtein distance, aborting once it exceeds `max`. */
function editDistance(a: string, b: string, max = MAX_SIMILAR_EDITS): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > max) return max + 1
  if (m === 0) return n
  if (n === 0) return m

  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i
    let rowMin = curr[0]
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      const next = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
      curr[j] = next
      if (next < rowMin) rowMin = next
    }
    if (rowMin > max) return max + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]!
}

/**
 * Similar when the SKUs are mostly the same: at most 5 character edits, and
 * enough length left that they are not nearly rewritten.
 */
function similarEditDistance(a: string, b: string): number | null {
  if (!a || !b) return null
  if (a === b) return 0
  const maxLen = Math.max(a.length, b.length)
  const minLen = Math.min(a.length, b.length)
  if (minLen < MIN_SIMILAR_LEN) return null
  const dist = editDistance(a, b, MAX_SIMILAR_EDITS)
  if (dist > MAX_SIMILAR_EDITS) return null
  // Keep at least MIN_SIMILAR_LEN characters of "shared mass" after edits.
  if (maxLen - dist < MIN_SIMILAR_LEN) return null
  return dist
}

function similarScore(a: string, b: string): number {
  const dist = similarEditDistance(a, b)
  if (dist == null) return 0
  return 1000 - dist * 40 + Math.min(a.length, b.length)
}

type SimilarKey = {
  key: string
  field: string
  display: string
}

function describeSimilar(left: SimilarKey, right: SimilarKey, dist: number): string {
  const leftName = `${left.field} ${left.display}`
  const rightName = `${right.field} ${right.display}`
  if (dist === 0 || left.key === right.key) {
    return `${leftName} and ${rightName} match after ignoring hyphens and spaces`
  }
  return `${leftName} differs from ${rightName} by ${dist} character${dist === 1 ? '' : 's'}`
}

function labeledKeys(fields: { value: string; field: string }[]): SimilarKey[] {
  const out: SimilarKey[] = []
  for (const field of fields) {
    const usable = usableKey(field.value)
    const compact = compactKey(field.value)
    if (usable) out.push({ key: usable, field: field.field, display: field.value })
    if (compact && compact !== usable) out.push({ key: compact, field: field.field, display: field.value })
  }
  return out
}

function ipointSimilarKeys(item: ParsedItem): SimilarKey[] {
  return labeledKeys([
    { value: item.partNumber, field: 'iPoint Part Number' },
    { value: item.itemName, field: 'iPoint Item' },
  ])
}

function dtoolsSimilarKeys(item: ParsedItem): SimilarKey[] {
  return labeledKeys([
    { value: item.partNumber, field: 'D-Tools Part Number' },
    { value: item.model, field: 'D-Tools Model' },
  ])
}

function findSimilarCandidates(
  selfKeys: SimilarKey[],
  others: { keys: SimilarKey[]; item: ParsedItem }[],
  side: 'i' | 'd',
): SimilarCandidate[] {
  const found: SimilarCandidate[] = []
  for (const other of others) {
    let best: { score: number; dist: number; self: SimilarKey; other: SimilarKey } | null = null
    for (const self of selfKeys) {
      for (const otherKey of other.keys) {
        const dist = similarEditDistance(self.key, otherKey.key)
        if (dist == null) continue
        const score = similarScore(self.key, otherKey.key)
        if (score > (best?.score || 0)) best = { score, dist, self, other: otherKey }
      }
    }
    if (!best || best.score <= 0) continue
    const item = other.item
    found.push({
      id: `${side}-${item.sourceIndex}`,
      sourceIndex: item.sourceIndex,
      optionLabel:
        side === 'd'
          ? [item.partNumber, item.model].filter(Boolean).join(' · ') || item.model
          : [item.partNumber, item.itemName].filter(Boolean).join(' · ') || item.itemName,
      label: best.other.display,
      reason: describeSimilar(best.self, best.other, best.dist),
      score: best.score,
      partNumber: item.partNumber,
      itemName: item.itemName,
      manufacturer: item.manufacturer,
      brand: item.brand,
      model: item.model,
      qty: item.qty,
      qtyRaw: item.qtyRaw,
      category: item.category,
      itemType: item.itemType,
      descriptionCustomer: item.descriptionCustomer,
      unitHardCost: item.unitHardCost,
      unitPrice: item.unitPrice,
    })
  }
  found.sort((a, b) => b.score - a.score || a.optionLabel.localeCompare(b.optionLabel))
  return found.slice(0, 5)
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
  return line.qtyDiffers || line.isSimilar || line.isGrouped
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
  similarCandidates: [] as SimilarCandidate[],
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

  const iSimilar = ipoint.items
    .filter((item) => !matchedI.has(item.sourceIndex))
    .map((item) => ({
      keys: ipointSimilarKeys(item),
      item,
    }))

  for (const dr of dtools.items) {
    if (matchedD.has(dr.sourceIndex)) continue
    const candidates = findSimilarCandidates(dtoolsSimilarKeys(dr), iSimilar, 'i')
    const similar = candidates[0]
    const similarTo = similar?.label || ''
    const notes = ['In D-Tools only — no exact iPoint Item or Part Number match']
    if (similar) {
      notes.push(
        candidates.length > 1
          ? `${candidates.length} similar iPoint products. ${similar.reason}. Pick one in the Similar SKU menu.`
          : `${similar.reason}. This D-Tools row already exists in Products.csv. Treat only this row as the same part, or add the iPoint item as a new row.`,
      )
    }
    lines.push({
      id: `d-${dr.sourceIndex}`,
      partKey: usableKey(dr.partNumber) || usableKey(dr.model) || String(dr.sourceIndex),
      ipointPartNumber: similar?.partNumber || '',
      dtoolsPartNumber: dr.partNumber,
      match: 'dtools-only',
      matchVia: similar ? `Similar only — ${similar.reason}` : '',
      ipointQty: null,
      dtoolsQty: dr.qty,
      ipointRaw: '',
      dtoolsRaw: dr.qtyRaw,
      ipointItem: similar?.itemName || '',
      ipointManufacturer: similar?.manufacturer || '',
      dtoolsBrand: dr.brand,
      dtoolsModel: dr.model,
      ipointRows: 0,
      dtoolsRowsForKey: 1,
      dtoolsSourceIndex: dr.sourceIndex,
      notes,
      qtyDiffers: false,
      similarTo,
      isSimilar: Boolean(similarTo),
      similarPeerId: similar?.id || '',
      similarIpointQty: similar?.qty ?? null,
      similarIpointRaw: similar?.qtyRaw || '',
      similarDtoolsQty: dr.qty,
      similarDtoolsRaw: dr.qtyRaw,
      similarDtoolsSourceIndex: dr.sourceIndex,
      similarCandidates: candidates,
      treatedAsSame: false,
      ipointSlices: [],
      groupSlices: [],
      isGrouped: false,
      groupDetail: '',
      splitFromGroup: false,
      splitParentId: '',
      quantitiesCombined: true,
      ipointSourceIndex: similar?.sourceIndex ?? null,
      ipointCategory: similar?.category || '',
      ipointType: similar?.itemType || '',
      ipointDescription: similar?.descriptionCustomer || '',
      ipointUnitCost: similar?.unitHardCost || '',
      ipointUnitPrice: similar?.unitPrice || '',
    })
  }

  for (const ir of ipoint.items) {
    if (matchedI.has(ir.sourceIndex)) continue
    lines.push({
      id: `i-${ir.sourceIndex}`,
      partKey: usableKey(ir.partNumber) || usableKey(ir.itemName) || String(ir.sourceIndex),
      ipointPartNumber: ir.partNumber,
      dtoolsPartNumber: '',
      match: 'ipoint-only',
      matchVia: '',
      ipointQty: ir.qty,
      dtoolsQty: null,
      ipointRaw: ir.qtyRaw,
      dtoolsRaw: '',
      ipointItem: ir.itemName,
      ipointManufacturer: ir.manufacturer,
      dtoolsBrand: '',
      dtoolsModel: '',
      ipointRows: 1,
      dtoolsRowsForKey: 0,
      dtoolsSourceIndex: null,
      notes: ['In iPoint only — no exact D-Tools Model or Part Number match. Add it as a new Products.csv row if you want it in D-Tools.'],
      qtyDiffers: false,
      ...blankSimilar,
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

export function applySimilarSelection(
  lines: CompareLine[],
  picks: Record<string, string>,
): CompareLine[] {
  return lines.map((line) => {
    if (line.similarCandidates.length === 0 || line.match !== 'dtools-only') return line
    const chosen =
      line.similarCandidates.find((candidate) => candidate.id === picks[line.id]) || line.similarCandidates[0]
    return {
      ...line,
      ipointPartNumber: chosen.partNumber,
      ipointItem: chosen.itemName,
      ipointManufacturer: chosen.manufacturer,
      similarTo: chosen.label,
      similarPeerId: chosen.id,
      similarIpointQty: chosen.qty,
      similarIpointRaw: chosen.qtyRaw,
      ipointSourceIndex: chosen.sourceIndex,
      ipointCategory: chosen.category,
      ipointType: chosen.itemType,
      ipointDescription: chosen.descriptionCustomer,
      ipointUnitCost: chosen.unitHardCost,
      ipointUnitPrice: chosen.unitPrice,
      matchVia: `Similar only — ${chosen.reason}`,
    }
  })
}

export function applyTreatedSimilar(
  lines: CompareLine[],
  treatedIds: Record<string, boolean>,
): CompareLine[] {
  const isTreated = (line: CompareLine) => Boolean(treatedIds[line.id])

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
