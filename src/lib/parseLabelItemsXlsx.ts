import * as XLSX from 'xlsx'
import type { LabelStudioItem } from '../types/labelStudio'

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function cellString(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val).trim()
}

/** Parse any spreadsheet: first row = headers, each row = one label item with merge fields. */
export function parseLabelItemsXlsx(buf: ArrayBuffer): LabelStudioItem[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (rows.length === 0) return []

  const first = rows[0]
  const headers = Object.keys(first).map((k) => ({
    raw: k,
    key: normalizeHeader(k),
  }))

  const titleKey =
    headers.find((h) => ['item', 'name', 'title', 'product', 'description'].includes(h.key))?.key ??
    headers[0]?.key ??
    'item'

  const items: LabelStudioItem[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const fields: Record<string, string> = {}
    for (const { raw, key } of headers) {
      const v = cellString(row[raw])
      if (v) fields[key] = v
    }
    const title = fields[titleKey] || fields.item || fields.name || `Row ${i + 1}`
    if (!title && Object.keys(fields).length === 0) continue
    items.push({
      id: `excel-${i}-${title.slice(0, 24)}`,
      source: 'excel',
      title,
      fields,
    })
  }
  return items
}
