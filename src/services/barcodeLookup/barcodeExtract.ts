/** Pull plausible UPC/EAN/GTIN values from free text (search snippets, titles). */
export function extractBarcodesFromText(text: string): string[] {
  const found = new Set<string>()
  const re = /\b(\d{8}|\d{12}|\d{13}|\d{14})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const d = m[1]
    if (d.length === 8 || d.length === 12 || d.length === 13) found.add(d)
  }
  return [...found]
}

export function normalizePartKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function buildSearchQueries(input: {
  part_number?: string | null
  manufacturer?: string | null
  item?: string | null
}): string[] {
  const part = (input.part_number || '').trim()
  const mfr = (input.manufacturer || '').trim()
  const item = (input.item || '').trim()
  const queries = new Set<string>()
  if (part) {
    queries.add(part)
    if (mfr) {
      queries.add(`${mfr} ${part}`)
      queries.add(`${mfr} ${part} UPC EAN barcode`)
    }
    queries.add(`${part} UPC barcode`)
    queries.add(`${part} EAN GTIN`)
    queries.add(`${part} pro AV`)
  }
  if (item && item !== part) {
    queries.add(item)
    if (mfr) queries.add(`${mfr} ${item}`)
  }
  return [...queries].slice(0, 6)
}
