/** Ordering estimate from an SHS-style rough-in PDF (plan sheets + pull sheet). */

export type PdfTextItem = { str: string; x: number; y: number }

export type PdfPageText = {
  pageIndex: number
  width: number
  height: number
  items: PdfTextItem[]
}

export type HeadEndMark = { pageIndex: number; x: number; y: number }

export type RoughInSettings = {
  /** Feet added to every cable for the vertical drop and a loop at the panel. */
  wallDropFt: number
  /** Extra feet for each level between the device sheet and the head-end sheet. */
  floorToFloorFt: number
  /** Applied to the horizontal run and the floor-to-floor riser. */
  slackPercent: number
  headEndMark: HeadEndMark | null
}

export type RoughInCableRow = {
  wireId: string
  wireType: string
  destination: string
  feet: number
  note: string
}

export type RoughInEstimate =
  | {
      ok: false
      reason: 'needs-head-end'
      planPageIndexes: number[]
      message: string
    }
  | { ok: false; reason: 'error'; message: string }
  | {
      ok: true
      scaleLabel: string
      headEndNote: string
      totals: { wireType: string; count: number; feet: number }[]
      rows: RoughInCableRow[]
      cableCount: number
      totalFeet: number
      unlocated: number
    }

type ScaleInfo = { label: string; pointsPerFoot: number }

type Cols = { typeX: number; destX: number; compX: number }

type PullCable = { wireId: string; wireType: string; destination: string }

type Point = { pageIndex: number; x: number; y: number; floor: number }

type Panel = Point & { label: string }

const WIRE_ID_RE = /^(?:S)?\d{2,4}\.\d{1,2}$/i

function norm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function isBlank(value: string): boolean {
  const t = value.trim()
  return t === '' || t === '""' || t === "''" || t === '"' || t === "'"
}

function pageText(page: PdfPageText): string {
  return page.items.map((item) => item.str).join(' ')
}

function parseScale(page: PdfPageText): ScaleInfo | null {
  const text = pageText(page)
  const fraction = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:["″''])?\s*=\s*(\d+)\s*'/)
  if (fraction) {
    const inches = Number(fraction[1]) / Number(fraction[2])
    const feet = Number(fraction[3])
    if (inches > 0 && feet > 0) {
      return {
        label: `${fraction[1]}/${fraction[2]}" = ${feet}'-0"`,
        pointsPerFoot: (inches * 72) / feet,
      }
    }
  }
  const whole = text.match(/(\d+(?:\.\d+)?)\s*(?:["″])\s*=\s*(\d+)\s*'/)
  if (whole) {
    const inches = Number(whole[1])
    const feet = Number(whole[2])
    if (inches > 0 && feet > 0) {
      return {
        label: `${inches}" = ${feet}'-0"`,
        pointsPerFoot: (inches * 72) / feet,
      }
    }
  }
  return null
}

function findColumns(page: PdfPageText): Cols[] {
  const rows = groupLines(page.items, 3)
  const found: Cols[] = []
  for (const row of rows) {
    const type = row.find((item) => {
      const text = norm(item.str)
      return text === 'TYPE' || text === 'WIRE TYPE'
    })
    const dest = row.find((item) => norm(item.str) === 'DESTINATION')
    const comp = row.find((item) => norm(item.str) === 'COMPONENT')
    if (!type || !dest || !comp) continue
    if (!(type.x < dest.x && dest.x < comp.x)) continue
    if (found.some((cols) => Math.abs(cols.typeX - type.x) < 20)) continue
    found.push({ typeX: type.x, destX: dest.x, compX: comp.x })
  }
  return found
}

function isPullSheet(page: PdfPageText): boolean {
  if (findColumns(page).length === 0) return false
  return /pull\s*sheet/i.test(pageText(page))
}

function groupLines(items: PdfTextItem[], tolerance: number): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; items: PdfTextItem[] }[] = []
  for (const item of sorted) {
    const last = lines[lines.length - 1]
    if (!last || Math.abs(last.y - item.y) > tolerance) {
      lines.push({ y: item.y, items: [item] })
    } else {
      last.items.push(item)
      last.y = last.y * 0.75 + item.y * 0.25
    }
  }
  return lines.map((line) => line.items.sort((a, b) => a.x - b.x))
}

function parseWireType(tokens: string[]): string | 'skip' | null {
  const words = tokens.flatMap((token) => token.split(/\s+/)).map((token) => norm(token)).filter(Boolean)
  const joined = words.join(' ')
  if (!joined || joined === 'WIRE TYPE' || joined === 'TYPE') return null
  if (joined.includes('CONDUIT')) return 'skip'
  if (joined.startsWith('18-4 RED')) return '18-4 RED'
  if (joined.startsWith('18-4')) return '18-4'
  if (joined.includes('LUTRON') && joined.includes('QSM')) return 'LUTRON QSM'
  if (joined.includes('LUTRON') && joined.includes('GREEN')) return 'LUTRON GREEN'
  if (joined.startsWith('CAT6A') || joined.startsWith('CAT-6A')) return 'CAT6A'
  if (joined.startsWith('CAT6') || joined.startsWith('CAT-6')) return 'CAT6'
  if (joined.startsWith('CAT7') || joined.startsWith('CAT-7')) return 'CAT7'
  if (joined.startsWith('RG6')) return 'RG6'
  if (joined.startsWith('22-4')) return '22-4'
  if (joined.startsWith('14-4')) return '14-4'
  if (joined.startsWith('14-2')) return '14-2'
  if (joined.startsWith('4 STRAND')) return '4 STRAND SMF'
  if (joined.startsWith('6-STRAND') || joined.startsWith('6 STRAND')) return '6-STRAND SMF'
  return null
}

function parseDestination(tokens: string[]): string {
  const raw = tokens
    .flatMap((token) => token.split(/\s+/))
    .map((token) => norm(token))
    .filter((token) => token && !isBlank(token))
  if (raw.length === 0) return ''
  if (raw[0] === 'AV' && raw[1] === 'HE') {
    return /^\d+$/.test(raw[2] || '') ? `AV HE ${raw[2]}` : 'AV HE'
  }
  if (raw[0] === 'SEC' && raw[1] === 'PNL') {
    return /^\d+$/.test(raw[2] || '') ? `SEC PNL ${raw[2]}` : 'SEC PNL'
  }
  if ((raw[0] === 'SHADE' || raw[0] === 'SHD') && raw[1] === 'PNL') {
    return /^\d+$/.test(raw[2] || '') ? `SHADE PNL ${raw[2]}` : 'SHADE PNL'
  }
  if (raw[0] === 'SMOKE' && raw[1] === 'LOOP') {
    const suffix = raw[2] && /^[A-Z]$/.test(raw[2]) ? ` ${raw[2]}` : ''
    return `SMOKE LOOP${suffix}`
  }
  if (raw[0] === 'PROC' && raw[1] === 'PNL') return 'PROC PNL'
  return raw.slice(0, 3).join(' ')
}

function parsePullCables(page: PdfPageText, carried: { id: string; dest: string }): PullCable[] {
  const columnSets = findColumns(page)
  if (columnSets.length === 0) return []
  const cables: PullCable[] = []
  let previousId = carried.id
  let previousDest = carried.dest

  for (const cols of columnSets) {
    const idMax = cols.typeX - 18
    const typeMax = cols.destX - 6
    const destMax = cols.compX - 6
    const owned = page.items.filter((item) => item.x >= idMax - 80 && item.x < destMax + 40)
    for (const line of groupLines(owned, 2.4)) {
      const idTokens: string[] = []
      const typeTokens: string[] = []
      const destTokens: string[] = []
      for (const item of line) {
        if (item.x < idMax) idTokens.push(item.str)
        else if (item.x < typeMax) typeTokens.push(item.str)
        else if (item.x < destMax) destTokens.push(item.str)
      }
      const wireType = parseWireType(typeTokens)
      if (!wireType || wireType === 'skip') continue
      const idJoined = idTokens
        .map((token) => token.trim())
        .filter((token) => !isBlank(token))
        .join(' ')
      const destJoined = parseDestination(destTokens)
      const wireId = idJoined || previousId
      const destination = destJoined || previousDest
      if (idJoined) previousId = idJoined
      if (destJoined) previousDest = destJoined
      cables.push({ wireId: norm(wireId), wireType, destination })
    }
  }
  carried.id = previousId
  carried.dest = previousDest
  return cables
}

function wireIdSet(page: PdfPageText): Set<string> {
  const ids = new Set<string>()
  for (const item of page.items) {
    if (WIRE_ID_RE.test(item.str.trim())) ids.add(norm(item.str))
  }
  return ids
}

function buildFloorGroups(planPages: PdfPageText[]): Map<number, number> {
  const parent = new Map<number, number>()
  const find = (pageIndex: number): number => {
    const current = parent.get(pageIndex) ?? pageIndex
    if (current === pageIndex) return pageIndex
    const root = find(current)
    parent.set(pageIndex, root)
    return root
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  for (const page of planPages) parent.set(page.pageIndex, page.pageIndex)

  const ids = new Map(planPages.map((page) => [page.pageIndex, wireIdSet(page)]))
  for (let i = 0; i < planPages.length; i++) {
    for (let j = i + 1; j < planPages.length; j++) {
      const a = ids.get(planPages[i]!.pageIndex)!
      const b = ids.get(planPages[j]!.pageIndex)!
      const small = a.size < b.size ? a : b
      const large = a.size < b.size ? b : a
      if (small.size < 3) continue
      let shared = 0
      for (const id of small) if (large.has(id)) shared++
      if (shared >= 3 && shared / small.size >= 0.3) {
        unite(planPages[i]!.pageIndex, planPages[j]!.pageIndex)
      }
    }
  }

  const roots = [...new Set(planPages.map((page) => find(page.pageIndex)))].sort((a, b) => a - b)
  const floorOfRoot = new Map(roots.map((root, index) => [root, index]))
  const floors = new Map<number, number>()
  for (const page of planPages) floors.set(page.pageIndex, floorOfRoot.get(find(page.pageIndex)) ?? 0)
  return floors
}

function nearby(a: PdfTextItem, b: PdfTextItem, maxDx: number, maxDy: number): boolean {
  return Math.abs(a.y - b.y) <= maxDy && b.x >= a.x - 2 && b.x - a.x <= maxDx
}

function closestDigit(items: PdfTextItem[], anchor: PdfTextItem): string {
  let best: { str: string; dist: number } | null = null
  for (const item of items) {
    if (!/^\d{1,2}$/.test(item.str.trim())) continue
    if (!nearby(anchor, item, 48, 14)) continue
    const dist = Math.hypot(item.x - anchor.x, item.y - anchor.y)
    if (!best || dist < best.dist) best = { str: item.str.trim(), dist }
  }
  return best?.str ?? ''
}

function panelLabelFromText(text: string): string | null {
  const match = text.match(/^(AV HE|SEC PNL|SHADE PNL|SHD PNL)(?:\s+(\d{1,2}))?$/)
  if (!match) return null
  const family = match[1] === 'SHD PNL' ? 'SHADE PNL' : match[1]
  return match[2] ? `${family} ${match[2]}` : family
}

function findPanels(page: PdfPageText, floor: number): Panel[] {
  const panels: Panel[] = []
  const items = page.items
  for (const item of items) {
    const direct = panelLabelFromText(norm(item.str))
    if (direct) {
      panels.push({ label: direct, pageIndex: page.pageIndex, x: item.x, y: item.y, floor })
      continue
    }
    const text = norm(item.str)
    if (text !== 'AV' && text !== 'SEC' && text !== 'SHD' && text !== 'SHADE') continue
    const second = items.find((other) => {
      if (text === 'AV') return norm(other.str) === 'HE' && nearby(item, other, 36, 8)
      return norm(other.str) === 'PNL' && nearby(item, other, 48, 8)
    })
    if (!second) continue
    const lineMates = items.filter(
      (other) => Math.abs(other.y - item.y) <= 8 && other.x >= item.x - 10 && other.x <= item.x + 220,
    )
    if (lineMates.length > 8) continue
    const digit = closestDigit(items, second)
    let label = ''
    if (text === 'AV') label = digit ? `AV HE ${digit}` : 'AV HE'
    else if (text === 'SEC') label = digit ? `SEC PNL ${digit}` : 'SEC PNL'
    else label = digit ? `SHADE PNL ${digit}` : 'SHADE PNL'
    panels.push({ label, pageIndex: page.pageIndex, x: item.x, y: item.y, floor })
  }
  return panels
}

function findDevicePoints(page: PdfPageText, floor: number): Map<string, Point[]> {
  const points = new Map<string, Point[]>()
  const add = (id: string, item: PdfTextItem) => {
    const key = norm(id)
    if (!key) return
    const list = points.get(key) ?? []
    const point = { pageIndex: page.pageIndex, x: item.x, y: item.y, floor }
    if (list.some((existing) => Math.hypot(existing.x - point.x, existing.y - point.y) < 8)) return
    list.push(point)
    points.set(key, list)
  }
  for (const item of page.items) {
    const text = item.str.trim()
    if (WIRE_ID_RE.test(text) || /^LOOP\s+[A-Z]\d$/i.test(text)) add(text, item)
  }
  for (const item of page.items) {
    if (norm(item.str) !== 'LOOP') continue
    const suffix = page.items.find(
      (other) => /^[A-Z]\d$/i.test(other.str.trim()) && nearby(item, other, 40, 8),
    )
    if (suffix) add(`LOOP ${suffix.str}`, item)
  }
  return points
}

function familyOf(label: string): string {
  if (label.startsWith('AV HE')) return 'AV HE'
  if (label.startsWith('SEC PNL')) return 'SEC PNL'
  if (label.startsWith('SHADE PNL')) return 'SHADE PNL'
  return label
}

function manhattanFeet(a: Point, b: Point, pointsPerFoot: number): number {
  return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / pointsPerFoot
}

function pickPanel(destination: string, device: Point | null, panels: Panel[], mark: Panel | null): Panel | null {
  const exact = panels.filter((panel) => panel.label === destination)
  const family = panels.filter((panel) => familyOf(panel.label) === familyOf(destination))
  const pool = exact.length > 0 ? exact : family
  if (pool.length > 0) {
    if (!device) return pool[0]!
    const sameFloor = pool.filter((panel) => panel.floor === device.floor)
    const choices = sameFloor.length > 0 ? sameFloor : pool
    return choices.reduce((best, panel) =>
      Math.hypot(panel.x - device.x, panel.y - device.y) <
      Math.hypot(best.x - device.x, best.y - device.y)
        ? panel
        : best,
    )
  }
  if (mark) return mark
  const headEnds = panels.filter((panel) => familyOf(panel.label) === 'AV HE')
  if (headEnds.length === 0 || !device) return headEnds[0] ?? null
  return headEnds.reduce((best, panel) =>
    Math.hypot(panel.x - device.x, panel.y - device.y) < Math.hypot(best.x - device.x, best.y - device.y)
      ? panel
      : best,
  )
}

function applyRun(horizontalFt: number, floorDelta: number, settings: RoughInSettings): number {
  const slack = 1 + Math.max(0, settings.slackPercent) / 100
  const riser = Math.abs(floorDelta) * Math.max(0, settings.floorToFloorFt)
  return Math.round((horizontalFt + riser) * slack + Math.max(0, settings.wallDropFt))
}

export function estimateRoughIn(pages: PdfPageText[], settings: RoughInSettings): RoughInEstimate {
  const pullPages = pages.filter(isPullSheet)
  const carried = { id: '', dest: '' }
  const cables = pullPages.flatMap((page) => parsePullCables(page, carried))
  if (cables.length === 0) {
    return {
      ok: false,
      reason: 'error',
      message: 'No pull sheet was found in this PDF. The estimate reads the pull-sheet cable list and the scaled plan.',
    }
  }

  const planPages = pages.filter((page) => {
    if (isPullSheet(page)) return false
    return wireIdSet(page).size >= 3 && parseScale(page) != null
  })
  if (planPages.length === 0) {
    return {
      ok: false,
      reason: 'error',
      message: 'No scaled floor plan was found in this PDF.',
    }
  }

  const scales = new Map<number, ScaleInfo>()
  for (const page of planPages) {
    const scale = parseScale(page)
    if (scale) scales.set(page.pageIndex, scale)
  }
  const fallbackScale = [...scales.values()][0]
  if (!fallbackScale) {
    return {
      ok: false,
      reason: 'error',
      message: 'The plan does not show a scale (for example 3/16" = 1\'-0"), so footage cannot be calculated.',
    }
  }

  const floors = buildFloorGroups(planPages)
  const panels: Panel[] = []
  const devices = new Map<string, Point[]>()
  for (const page of planPages) {
    const floor = floors.get(page.pageIndex) ?? 0
    panels.push(...findPanels(page, floor))
    for (const [id, points] of findDevicePoints(page, floor)) {
      const list = devices.get(id) ?? []
      list.push(...points)
      devices.set(id, list)
    }
  }

  const avHeads = panels.filter((panel) => familyOf(panel.label) === 'AV HE')
  if (avHeads.length === 0 && !settings.headEndMark) {
    const bestByFloor = new Map<number, { pageIndex: number; count: number }>()
    for (const page of planPages) {
      const floor = floors.get(page.pageIndex) ?? 0
      const count = wireIdSet(page).size
      const current = bestByFloor.get(floor)
      if (!current || count > current.count) bestByFloor.set(floor, { pageIndex: page.pageIndex, count })
    }
    return {
      ok: false,
      reason: 'needs-head-end',
      planPageIndexes: [...bestByFloor.values()]
        .map((entry) => entry.pageIndex)
        .sort((a, b) => a - b),
      message:
        'No AV head end is marked on this drawing. Click the head-end location on the plan, then estimate again.',
    }
  }

  const mark: Panel | null = settings.headEndMark
    ? {
        label: 'AV HE',
        pageIndex: settings.headEndMark.pageIndex,
        x: settings.headEndMark.x,
        y: settings.headEndMark.y,
        floor: floors.get(settings.headEndMark.pageIndex) ?? 0,
      }
    : null

  const primaryPage = new Map<number, number>()
  for (const page of planPages) {
    const floor = floors.get(page.pageIndex) ?? 0
    const count = wireIdSet(page).size
    const current = primaryPage.get(floor)
    if (current == null || count > wireIdSet(planPages.find((candidate) => candidate.pageIndex === current)!).size) {
      primaryPage.set(floor, page.pageIndex)
    }
  }

  function devicePoints(wireId: string): Point[] {
    const hits = devices.get(norm(wireId)) ?? []
    if (hits.length <= 1) return hits
    const preferred = hits.filter((hit) => primaryPage.get(hit.floor) === hit.pageIndex)
    return preferred.length > 0 ? preferred : hits
  }

  const rows: RoughInCableRow[] = []
  const smokeGroups = new Map<string, PullCable[]>()
  const homeruns: PullCable[] = []
  for (const cable of cables) {
    if (cable.destination.startsWith('SMOKE LOOP')) {
      const list = smokeGroups.get(cable.destination) ?? []
      list.push(cable)
      smokeGroups.set(cable.destination, list)
    } else {
      homeruns.push(cable)
    }
  }

  let unlocated = 0
  for (const cable of homeruns) {
    const located = devicePoints(cable.wireId)
    const device = located[0] ?? null
    if (!device) unlocated++
    const panel = pickPanel(cable.destination, device, panels, mark)
    const notes: string[] = []
    let horizontal = 0
    let floorDelta = 0
    if (!device) {
      notes.push('Device not found on the plan — wall drop only')
    } else if (!panel) {
      notes.push('Panel not found — wall drop only')
    } else {
      const scale = scales.get(device.pageIndex) ?? fallbackScale
      horizontal = manhattanFeet(device, panel, scale.pointsPerFoot)
      floorDelta = device.floor - panel.floor
      if (panel.label !== cable.destination) {
        notes.push(
          panel.label === 'AV HE' && mark && panel.x === mark.x && panel.y === mark.y
            ? 'Measured to the head end you marked'
            : `Measured to ${panel.label}`,
        )
      }
      if (floorDelta !== 0) {
        const levels = Math.abs(floorDelta)
        notes.push(`${levels} floor${levels === 1 ? '' : 's'} from the head end`)
      }
    }
    rows.push({
      wireId: cable.wireId,
      wireType: cable.wireType,
      destination: cable.destination,
      feet: device && panel ? applyRun(horizontal, floorDelta, settings) : Math.round(Math.max(0, settings.wallDropFt)),
      note: notes.join('. '),
    })
  }

  for (const [destination, group] of smokeGroups) {
    const unique = new Map<string, Point>()
    for (const cable of group) {
      for (const point of devicePoints(cable.wireId)) {
        unique.set(`${point.pageIndex}:${Math.round(point.x)}:${Math.round(point.y)}`, point)
      }
    }
    const chain = [...unique.values()]
    let chainFeet = 0
    if (chain.length >= 2) {
      const unused = chain.slice(1)
      let current = chain[0]!
      while (unused.length > 0) {
        let bestIndex = 0
        let bestDist = Infinity
        for (let i = 0; i < unused.length; i++) {
          const scale = scales.get(current.pageIndex) ?? fallbackScale
          const dist =
            manhattanFeet(current, unused[i]!, scale.pointsPerFoot) +
            Math.abs(current.floor - unused[i]!.floor) * Math.max(0, settings.floorToFloorFt)
          if (dist < bestDist) {
            bestDist = dist
            bestIndex = i
          }
        }
        chainFeet += bestDist
        current = unused.splice(bestIndex, 1)[0]!
      }
    }
    const slack = 1 + Math.max(0, settings.slackPercent) / 100
    const shared = Math.round(chainFeet * slack)
    group.forEach((cable, index) => {
      const drop = Math.round(Math.max(0, settings.wallDropFt))
      const missing = (devices.get(norm(cable.wireId)) ?? []).length === 0
      if (missing) unlocated++
      rows.push({
        wireId: cable.wireId,
        wireType: cable.wireType,
        destination,
        feet: (index === 0 ? shared : 0) + drop,
        note:
          chain.length >= 2
            ? 'Smoke loop — chain along the loop labels, plus a wall drop'
            : missing
              ? 'Smoke loop device not found — wall drop only'
              : 'Smoke loop — wall drop only (loop path was not separate labels)',
      })
    })
  }

  const totalsMap = new Map<string, { count: number; feet: number }>()
  for (const row of rows) {
    const current = totalsMap.get(row.wireType) ?? { count: 0, feet: 0 }
    current.count += 1
    current.feet += row.feet
    totalsMap.set(row.wireType, current)
  }
  const totals = [...totalsMap.entries()]
    .map(([wireType, total]) => ({ wireType, count: total.count, feet: total.feet }))
    .sort((a, b) => b.feet - a.feet || a.wireType.localeCompare(b.wireType))

  const headLabels = [...new Set((mark && avHeads.length === 0 ? [mark] : avHeads).map((panel) => panel.label))]
  const headEndNote =
    avHeads.length === 0 && mark
      ? 'Head end: the location you marked on the plan.'
      : `Head end: ${headLabels.join(', ')} found on the plan.`

  const scaleLabel = [...new Set([...scales.values()].map((scale) => scale.label))].join(', ') || fallbackScale.label

  return {
    ok: true,
    scaleLabel,
    headEndNote,
    totals,
    rows,
    cableCount: rows.length,
    totalFeet: totals.reduce((sum, total) => sum + total.feet, 0),
    unlocated,
  }
}
