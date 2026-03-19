import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves worker as URL for the browser bundle
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let workerConfigured = false

function ensureWorker() {
  if (workerConfigured) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
  workerConfigured = true
}

type TextItem = { str: string; transform: number[] }

/**
 * Turn each PDF page into tab-separated "rows" by grouping text items with similar Y,
 * then sorting by X (left → right).
 *
 * Notes:
 * - PDF text item Y coordinates are not perfectly aligned between rows; we use a small
 *   tolerance instead of fixed bucketing.
 * - We sort by Y descending then X ascending to mimic reading order in tables.
 */
export async function extractPdfLinesFromArrayBuffer(data: ArrayBuffer): Promise<string[]> {
  ensureWorker()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) })
  const pdf = await loadingTask.promise
  const allLines: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items: { x: number; y: number; str: string }[] = []

    for (const raw of content.items) {
      const item = raw as TextItem
      if (!item?.str) continue
      const x = Number(item.transform?.[4] ?? 0)
      const y = Number(item.transform?.[5] ?? 0)
      const str = item.str?.toString?.().trim()
      if (!str) continue
      items.push({ x, y, str })
    }

    // Reading order in the table: top-to-bottom, left-to-right.
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x))

    // Group rows by Y proximity.
    const tolerance = 2.5
    const rows: { y: number; cells: { x: number; str: string }[] }[] = []

    for (const it of items) {
      const last = rows[rows.length - 1]
      if (!last || Math.abs(last.y - it.y) > tolerance) {
        rows.push({ y: it.y, cells: [{ x: it.x, str: it.str }] })
      } else {
        last.cells.push({ x: it.x, str: it.str })
        // Keep a running average y to avoid drift.
        last.y = (last.y * 0.8) + (it.y * 0.2)
      }
    }

    for (const row of rows) {
      const cells = row.cells.sort((a, b) => a.x - b.x)
      const line = cells.map((c) => c.str.trim()).filter(Boolean).join('\t')
      if (line.trim()) allLines.push(line.trim())
    }
  }

  return allLines
}
