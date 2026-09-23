import { normalizePartKey, type ParsedItem, type ParsedWorkbook } from './parseInventoryFiles'

export type MatchKind = 'both' | 'ipoint-only' | 'dtools-only'
export type QtyChoice = 'keep-dtools' | 'use-ipoint'

export type CompareLine = {
  id: string
  partKey: string
  partNumberDisplay: string
  match: MatchKind
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
}

export type CompareResult = {
  lines: CompareLine[]
  matchedKeys: number
  qtyDifferences: number
  ipointOnly: number
  dtoolsOnly: number
  ipointDuplicates: number
  dtoolsDuplicates: number
}

function groupByKey(items: ParsedItem[]): Map<string, ParsedItem[]> {
  const map = new Map<string, ParsedItem[]>()
  for (const item of items) {
    const list = map.get(item.partKey) || []
    list.push(item)
    map.set(item.partKey, list)
  }
  return map
}

function sumQty(items: ParsedItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0)
}

function qtyLabel(items: ParsedItem[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0].qtyRaw
  return items.map((i) => i.qtyRaw || '0').join(' + ')
}

export function compareInventories(ipoint: ParsedWorkbook, dtools: ParsedWorkbook): CompareResult {
  const iBy = groupByKey(ipoint.items)
  const dBy = groupByKey(dtools.items)
  const keys = [...new Set([...iBy.keys(), ...dBy.keys()])].sort((a, b) => a.localeCompare(b))

  let ipointDuplicates = 0
  let dtoolsDuplicates = 0
  const lines: CompareLine[] = []

  for (const key of keys) {
    const irows = iBy.get(key) || []
    const drows = dBy.get(key) || []
    if (irows.length > 1) ipointDuplicates += 1
    if (drows.length > 1) dtoolsDuplicates += 1

    if (irows.length === 0) {
      drows.forEach((dr, n) => {
        lines.push({
          id: `${key}-d-${dr.sourceIndex}-${n}`,
          partKey: key,
          partNumberDisplay: dr.partNumber,
          match: 'dtools-only',
          ipointQty: null,
          dtoolsQty: dr.qty,
          ipointRaw: '',
          dtoolsRaw: dr.qtyRaw,
          ipointItem: '',
          ipointManufacturer: '',
          dtoolsBrand: dr.brand,
          dtoolsModel: dr.model,
          ipointRows: 0,
          dtoolsRowsForKey: drows.length,
          dtoolsSourceIndex: dr.sourceIndex,
          notes: ['In D-Tools Products only', ...(drows.length > 1 ? [`${drows.length} D-Tools rows share this part number`] : [])],
          qtyDiffers: false,
        })
      })
      continue
    }

    if (drows.length === 0) {
      irows.forEach((ir, n) => {
        lines.push({
          id: `${key}-i-${ir.sourceIndex}-${n}`,
          partKey: key,
          partNumberDisplay: ir.partNumber,
          match: 'ipoint-only',
          ipointQty: ir.qty,
          dtoolsQty: null,
          ipointRaw: ir.qtyRaw,
          dtoolsRaw: '',
          ipointItem: ir.itemName,
          ipointManufacturer: ir.manufacturer,
          dtoolsBrand: '',
          dtoolsModel: '',
          ipointRows: irows.length,
          dtoolsRowsForKey: 0,
          dtoolsSourceIndex: null,
          notes: ['In iPoint Item List only', ...(irows.length > 1 ? [`${irows.length} iPoint rows share this part number`] : [])],
          qtyDiffers: false,
        })
      })
      continue
    }

    const ipointQty = sumQty(irows)
    const ipointRaw = qtyLabel(irows)
    const notes: string[] = []
    if (irows.length > 1) notes.push(`${irows.length} iPoint rows; stock available shown as the sum (${ipointQty})`)
    if (drows.length > 1) notes.push(`${drows.length} D-Tools rows share this part number`)

    drows.forEach((dr, n) => {
      const qtyDiffers = ipointQty !== dr.qty
      lines.push({
        id: `${key}-b-${dr.sourceIndex}-${n}`,
        partKey: key,
        partNumberDisplay: dr.partNumber || irows[0].partNumber,
        match: 'both',
        ipointQty,
        dtoolsQty: dr.qty,
        ipointRaw,
        dtoolsRaw: dr.qtyRaw,
        ipointItem: irows.map((r) => r.itemName).filter(Boolean).join(' / ') || irows[0].itemName,
        ipointManufacturer: irows[0].manufacturer,
        dtoolsBrand: dr.brand,
        dtoolsModel: dr.model,
        ipointRows: irows.length,
        dtoolsRowsForKey: drows.length,
        dtoolsSourceIndex: dr.sourceIndex,
        notes: qtyDiffers ? ['Quantity differs', ...notes] : notes,
        qtyDiffers,
      })
    })
  }

  return {
    lines,
    matchedKeys: keys.filter((k) => iBy.has(k) && dBy.has(k)).length,
    qtyDifferences: lines.filter((l) => l.qtyDiffers).length,
    ipointOnly: lines.filter((l) => l.match === 'ipoint-only').length,
    dtoolsOnly: lines.filter((l) => l.match === 'dtools-only').length,
    ipointDuplicates,
    dtoolsDuplicates,
  }
}

export function defaultChoices(lines: CompareLine[]): Record<string, QtyChoice> {
  const out: Record<string, QtyChoice> = {}
  for (const line of lines) out[line.id] = 'keep-dtools'
  return out
}

export function normalizeSearch(q: string): string {
  return normalizePartKey(q)
}
