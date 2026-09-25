import type { Fill } from 'exceljs'
import Papa from 'papaparse'
import { matchDtoolsCategory } from './categoryMatch'
import type { QtyChoice, CompareLine } from './compareInventory'
import type { ParsedWorkbook } from './parseInventoryFiles'

export type ProductsExport = {
  headers: string[]
  rows: Record<string, string>[]
  qtyHeader: string
  changedQtyRowIndexes: number[]
  addedRowIndexes: number[]
}

function compactHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findHeader(headers: string[], candidates: string[]): string | null {
  const wanted = new Set(candidates.map(compactHeader))
  return headers.find((h) => wanted.has(compactHeader(h))) || null
}

function setField(record: Record<string, string>, headers: string[], candidates: string[], value: string) {
  const header = findHeader(headers, candidates)
  if (header) record[header] = value
}

function blankRow(headers: string[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const header of headers) record[header] = ''
  return record
}

export function canAddAsNew(line: CompareLine): boolean {
  if (line.treatedAsSame || line.ipointSourceIndex == null) return false
  if (!line.ipointPartNumber && !line.ipointItem) return false
  return line.match === 'ipoint-only' || (line.match === 'dtools-only' && line.isSimilar)
}

export function buildProductsExport(
  products: ParsedWorkbook,
  lines: CompareLine[],
  choices: Record<string, QtyChoice>,
  addNew: Record<string, boolean>,
  dtoolsCategories: string[],
): ProductsExport {
  const qtyBySourceIndex = new Map<number, number>()
  for (const line of lines) {
    if (choices[line.id] !== 'use-ipoint') continue
    if (!line.quantitiesCombined) continue
    if (line.dtoolsSourceIndex == null || line.ipointQty == null) continue
    qtyBySourceIndex.set(line.dtoolsSourceIndex, line.ipointQty)
  }

  const changedQtyRowIndexes: number[] = []
  const rows = products.originalRows.map((row, idx) => {
    const next = { ...row.record }
    const override = qtyBySourceIndex.get(row.sourceIndex)
    if (override !== undefined) {
      next[products.qtyHeader] = String(override)
      changedQtyRowIndexes.push(idx)
    }
    return next
  })

  const addedRowIndexes: number[] = []
  const seenIpoint = new Set<number>()
  for (const line of lines) {
    if (!addNew[line.id] || !canAddAsNew(line)) continue
    const sourceIndex = line.ipointSourceIndex
    if (sourceIndex == null || seenIpoint.has(sourceIndex)) continue
    seenIpoint.add(sourceIndex)
    const record = blankRow(products.headers)
    const matched = matchDtoolsCategory(line.ipointCategory, line.ipointType, dtoolsCategories)
    setField(record, products.headers, ['brand'], line.ipointManufacturer)
    setField(record, products.headers, ['model'], line.ipointItem)
    setField(record, products.headers, ['part number', 'partnumber'], line.ipointPartNumber)
    setField(record, products.headers, ['description'], line.ipointDescription)
    setField(record, products.headers, ['short description'], line.ipointDescription)
    setField(record, products.headers, ['category'], matched.category)
    setField(record, products.headers, ['unit cost'], line.ipointUnitCost)
    setField(record, products.headers, ['unit price'], line.ipointUnitPrice)
    setField(record, products.headers, ['quantity on hand', 'qty on hand'], line.ipointRaw || String(line.ipointQty ?? ''))
    setField(record, products.headers, ['active'], 'Yes')
    setField(record, products.headers, ['unit of measure'], 'Each')
    addedRowIndexes.push(rows.length)
    rows.push(record)
  }

  return {
    headers: products.headers,
    rows,
    qtyHeader: products.qtyHeader,
    changedQtyRowIndexes,
    addedRowIndexes,
  }
}

export function exportUpdatedProductsCsv(built: ProductsExport): string {
  return Papa.unparse(built.rows, {
    columns: built.headers,
    header: true,
    newline: '\r\n',
  })
}

export async function exportHighlightedProductsXlsx(built: ProductsExport): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Products')
  sheet.addRow(built.headers)
  for (const row of built.rows) {
    sheet.addRow(built.headers.map((header) => row[header] ?? ''))
  }

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }

  const qtyCol = built.headers.findIndex((header) => header === built.qtyHeader) + 1
  const changedFill: Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF2CC' },
  }
  const addedFill: Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFC6EFCE' },
  }

  for (const idx of built.changedQtyRowIndexes) {
    if (qtyCol < 1) break
    sheet.getRow(idx + 2).getCell(qtyCol).fill = changedFill
  }
  for (const idx of built.addedRowIndexes) {
    const excelRow = sheet.getRow(idx + 2)
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = addedFill
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function countOverrides(choices: Record<string, QtyChoice>): number {
  return Object.values(choices).filter((c) => c === 'use-ipoint').length
}

export function countAdds(lines: CompareLine[], addNew: Record<string, boolean>): number {
  return lines.filter((line) => addNew[line.id] && canAddAsNew(line)).length
}

export function previewAddCategory(line: CompareLine, dtoolsCategories: string[]): string {
  return matchDtoolsCategory(line.ipointCategory, line.ipointType, dtoolsCategories).category
}
