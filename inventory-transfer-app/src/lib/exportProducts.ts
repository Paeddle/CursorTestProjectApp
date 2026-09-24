import Papa from 'papaparse'
import type { QtyChoice } from './compareInventory'
import type { CompareLine } from './compareInventory'
import type { ParsedWorkbook } from './parseInventoryFiles'

export function exportUpdatedProductsCsv(
  products: ParsedWorkbook,
  lines: CompareLine[],
  choices: Record<string, QtyChoice>,
): string {
  const qtyBySourceIndex = new Map<number, number>()
  for (const line of lines) {
    if (choices[line.id] !== 'use-ipoint') continue
    if (line.dtoolsSourceIndex == null || line.ipointQty == null) continue
    qtyBySourceIndex.set(line.dtoolsSourceIndex, line.ipointQty)
  }

  const rows = products.originalRows.map((row) => {
    const next = { ...row.record }
    const override = qtyBySourceIndex.get(row.sourceIndex)
    if (override !== undefined) {
      next[products.qtyHeader] = String(override)
    }
    return next
  })

  return Papa.unparse(rows, {
    columns: products.headers,
    header: true,
    newline: '\r\n',
  })
}

export function countOverrides(choices: Record<string, QtyChoice>): number {
  return Object.values(choices).filter((c) => c === 'use-ipoint').length
}
