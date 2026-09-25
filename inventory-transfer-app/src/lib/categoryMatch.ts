function normalizeCat(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9 >&+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalizeCat(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function categoriesFromRecords(records: Record<string, string>[], headers: string[]): string[] {
  const header = headers.find((h) => h.trim().toLowerCase() === 'category') || 'Category'
  return unique(records.map((row) => (row[header] || '').trim()))
}

function typeFits(lastSegment: string, itemType: string): number {
  const last = normalizeCat(lastSegment)
  const type = normalizeCat(itemType)
  if (!type) return 0
  if (last === type) return 2200
  if (last.includes(type) || type.includes(last)) return 1800
  const lastTokens = tokens(lastSegment)
  const typeTokens = tokens(itemType)
  let overlap = 0
  for (const token of typeTokens) {
    if (lastTokens.some((part) => part === token || part.includes(token) || token.includes(part))) overlap += 1
  }
  return overlap * 450
}

function scoreCategory(ipointCategory: string, ipointType: string, candidate: string): number {
  const wanted = normalizeCat(ipointCategory)
  const option = normalizeCat(candidate)
  if (!wanted || !option) return 0
  const segments = option.split('>').map((part) => part.trim()).filter(Boolean)
  const first = segments[0] || ''
  const last = segments[segments.length - 1] || ''
  let score = 0
  if (option === wanted) score += 10000
  if (first === wanted && segments.length === 1) score += 9000
  if (first === wanted) score += 4000
  if (last === wanted) score += 3000
  if (segments.some((part) => part === wanted)) score += 2500
  if (first.startsWith(wanted) || wanted.startsWith(first)) score += 1200
  const typeScore = typeFits(last, ipointType)
  if (typeScore && first === wanted) score += 5500
  score += typeScore
  const wantedTokens = tokens(ipointCategory)
  const optionTokens = tokens(candidate)
  score += wantedTokens.filter((token) => optionTokens.includes(token)).length * 180
  score -= Math.abs(first.length - wanted.length)
  return score
}

export function matchDtoolsCategory(
  ipointCategory: string,
  ipointType: string,
  dtoolsCategories: string[],
): { category: string; fromCatalog: boolean } {
  let best: { category: string; score: number } | null = null
  for (const candidate of dtoolsCategories) {
    const score = scoreCategory(ipointCategory, ipointType, candidate)
    if (score > (best?.score || 0)) best = { category: candidate, score }
  }
  if (best && best.score >= 250) return { category: best.category, fromCatalog: true }
  const fallback = ipointCategory.trim()
  return { category: fallback, fromCatalog: false }
}
