import type { ProductLookupInput } from './types'
import { extractManufacturerFromTitle, extractModelFromTitle, extractTvSkuHintFromTitle } from './productPageExtract'

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

/** Derive part # and manufacturer from item title when fields are missing (e.g. TVs). */
export function enrichLookupInput(input: ProductLookupInput): ProductLookupInput {
  const item = (input.item || '').trim() || null
  const part = (input.part_number || '').trim() || null
  const mfr = (input.manufacturer || '').trim() || null
  const derivedMfr = mfr || extractManufacturerFromTitle(item)
  const derivedPart =
    part ||
    extractModelFromTitle(item) ||
    extractTvSkuHintFromTitle(item) ||
    extractModelFromTitle(derivedMfr ? `${derivedMfr} ${item ?? ''}` : null)

  return {
    ...input,
    part_number: derivedPart || input.part_number,
    manufacturer: derivedMfr || input.manufacturer,
  }
}

export function buildSearchQueries(input: ProductLookupInput): string[] {
  const enriched = enrichLookupInput(input)
  const part = (enriched.part_number || '').trim()
  const mfr = (enriched.manufacturer || '').trim()
  const item = (enriched.item || '').trim()
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
    if (part && !item.toUpperCase().includes(part.toUpperCase())) {
      queries.add(`${mfr ? `${mfr} ` : ''}${part}`)
      queries.add(`${mfr ? `${mfr} ` : ''}${part} UPC barcode`)
    }
  }
  return [...queries].slice(0, 8)
}
