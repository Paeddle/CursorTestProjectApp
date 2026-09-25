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

const GENERIC_TOKENS = new Set([
  'WALL',
  'MOUNT',
  'MOUNTS',
  'KIT',
  'KITS',
  'BLACK',
  'WHITE',
  'CABLE',
  'CABLES',
  'WIRE',
  'WIRES',
  'SPEAKER',
  'SPEAKERS',
  'AUDIO',
  'VIDEO',
  'POWER',
  'CONTROL',
  'SYSTEM',
  'SYSTEMS',
  'ACCESSORY',
  'ACCESSORIES',
  'CEILING',
  'OUTDOOR',
  'INDOOR',
  'ACTIVE',
  'PASSIVE',
  'BRACKET',
  'BRACKETS',
  'STAND',
  'STANDS',
  'DISPLAY',
  'BOX',
  'BOXES',
  'ENCLOSURE',
  'ENCLOSURES',
  'ADAPTER',
  'ADAPTERS',
  'HDMI',
  'USB',
  'PORT',
  'PORTS',
  'CHANNEL',
  'STEREO',
  'WIRELESS',
  'ULTRA',
  'PRO',
  'MAX',
  'PLUS',
  'MINI',
  'SLIM',
  'GEN',
  'THE',
  'AND',
  'FOR',
  'WITH',
  'BACK',
  'PRE',
  'CONSTRUCTION',
  'SURFACE',
  'INWALL',
  'INCEILING',
  'EACH',
  'PACK',
  'PAIR',
  'SET',
])

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

function wordTokens(value: string): string[] {
  return usableKey(value)
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 3)
}

function sharedPhraseBonus(left: string[], right: string[]): number {
  let best = 0
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let n = 0
      while (i + n < left.length && j + n < right.length && left[i + n] === right[j + n]) n += 1
      if (n > best) best = n
    }
  }
  return best >= 2 ? best * 20 : 0
}

function distinctiveTokens(value: string): string[] {
  return wordTokens(value).filter((token) => !GENERIC_TOKENS.has(token))
}

function tokenOverlapScore(left: string, right: string): number {
  const sharedDistinct = distinctiveTokens(left).filter((token) => distinctiveTokens(right).includes(token))
  if (sharedDistinct.length === 0) return 0
  return (
    sharedDistinct.reduce((sum, token) => sum + token.length * 8, 0) +
    sharedPhraseBonus(wordTokens(left), wordTokens(right))
  )
}

function compactPairScore(self: SimilarKey, other: SimilarKey): number {
  const compact = similarScore(self.key, other.key)
  if (!compact) return 0
  if (distinctiveTokens(self.display).some((token) => distinctiveTokens(other.display).includes(token))) {
    return compact
  }
  return 0
}

type SimilarKey = {
  key: string
  field: string
  display: string
}

function describeSimilar(left: SimilarKey, right: SimilarKey): string {
  const leftName = `${left.field} ${left.display}`
  const rightName = `${right.field} ${right.display}`
  if (left.key === right.key) {
    return `${leftName} and ${rightName} match after ignoring hyphens and spaces`
  }
  const shorter = left.key.length <= right.key.length ? left : right
  const longer = left.key.length <= right.key.length ? right : left
  if (longer.key.startsWith(shorter.key)) {
    return `${longer.field} ${longer.display} starts with ${shorter.field} ${shorter.display}`
  }
  if (longer.key.includes(shorter.key)) {
    return `${shorter.field} ${shorter.display} appears in ${longer.field} ${longer.display}`
  }
  return `${leftName} looks like ${rightName}`
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
    let best: { score: number; self: SimilarKey; other: SimilarKey; compact: number } | null = null
    for (const self of selfKeys) {
      for (const otherKey of other.keys) {
        const compact = compactPairScore(self, otherKey)
        const tokens = tokenOverlapScore(self.display, otherKey.display)
        const score = compact * 10 + tokens
        if (score > (best?.score || 0)) best = { score, self, other: otherKey, compact }
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
      reason:
        best.compact > 0
          ? describeSimilar(best.self, best.other)
          : `${best.self.field} ${best.self.display} shares words with ${best.other.field} ${best.other.display}`,
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
  return found.slice(0, 8)
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
