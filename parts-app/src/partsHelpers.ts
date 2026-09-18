import type { CheckInDocument, PartCheckIn, PartFields, TrackedPart } from './types'
import { EMPTY_PART_FIELDS } from './types'

export function trimField(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export function normalizeLookupKey(value: string): string {
  return trimField(value).replace(/\s+/g, '')
}

export function todayLocalDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fieldsFromRecord(row: Partial<PartFields> | null | undefined): PartFields {
  return {
    manufacturer: trimField(row?.manufacturer),
    vendor: trimField(row?.vendor),
    upc_code: trimField(row?.upc_code),
    part_name: trimField(row?.part_name),
    ipn: trimField(row?.ipn),
    description: trimField(row?.description),
    po: trimField(row?.po),
    link: trimField(row?.link),
  }
}

export function nullableFields(fields: PartFields): Record<keyof PartFields, string | null> {
  const out = {} as Record<keyof PartFields, string | null>
  for (const key of Object.keys(EMPTY_PART_FIELDS) as (keyof PartFields)[]) {
    let v = trimField(fields[key])
    if (key === 'upc_code' || key === 'ipn') v = normalizeLookupKey(v)
    out[key] = v || null
  }
  return out
}

export function displayPartTitle(row: Partial<PartFields>): string {
  return (
    trimField(row.part_name) ||
    trimField(row.ipn) ||
    trimField(row.upc_code) ||
    'Untitled part'
  )
}

export function displayCheckInTitle(row: Partial<PartFields>): string {
  return (
    trimField(row.ipn) ||
    trimField(row.part_name) ||
    trimField(row.upc_code) ||
    'Untitled part'
  )
}

export function displayPartMeta(row: Partial<PartFields>): string {
  const bits: string[] = []
  const manufacturer = trimField(row.manufacturer)
  const vendor = trimField(row.vendor)
  const ipn = trimField(row.ipn)
  const upc = trimField(row.upc_code)
  if (manufacturer) bits.push(manufacturer)
  if (vendor && vendor !== manufacturer) bits.push(vendor)
  if (ipn) bits.push(`IPN ${ipn}`)
  if (upc) bits.push(`UPC ${upc}`)
  return bits.join(' · ') || 'No details'
}

export function formatDate(isoDate: string): string {
  if (!isoDate) return '—'
  const dateOnly = isoDate.slice(0, 10)
  const [y, m, d] = dateOnly.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  try {
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return dateOnly
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function formatCheckInWhen(checkInDate: string, scannedAt: string): string {
  const date = formatDate(checkInDate)
  const time = formatTime(scannedAt)
  if (date === '—' && !scannedAt) return '—'
  if (!scannedAt) return date
  return `${date} · ${time}`
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function matchesQuery(row: Partial<PartFields>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [
    row.manufacturer,
    row.vendor,
    row.upc_code,
    row.part_name,
    row.ipn,
    row.description,
    row.po,
    row.link,
  ]
    .map((v) => (v ?? '').toLowerCase())
    .join(' ')
  return hay.includes(q)
}

export function parseCheckInDocuments(value: unknown): CheckInDocument[] {
  if (!Array.isArray(value)) return []
  const out: CheckInDocument[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { name?: unknown; url?: unknown }
    const url = typeof rec.url === 'string' ? rec.url.trim() : ''
    if (!url) continue
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'Document'
    out.push({ name, url })
  }
  return out
}

export function checkInQuantity(row: Pick<PartCheckIn, 'quantity'>): number {
  const n = Number(row.quantity)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function checkInDateKey(value: string | null | undefined): string {
  return (value ?? '').slice(0, 10)
}

export function checkInMatchesQuery(row: PartCheckIn, query: string): boolean {
  if (matchesQuery(row, query)) return true
  const q = query.trim().toLowerCase()
  if (row.check_in_date.toLowerCase().includes(q)) return true
  if (String(checkInQuantity(row)).includes(q)) return true
  return parseCheckInDocuments(row.documents).some(
    (doc) => doc.name.toLowerCase().includes(q) || doc.url.toLowerCase().includes(q),
  )
}

export function partMatchesQuery(row: TrackedPart, query: string): boolean {
  return matchesQuery(row, query)
}
