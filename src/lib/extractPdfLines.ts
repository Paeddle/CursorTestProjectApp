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
 * then sorting by X (left → right). Matches Purchase Manager export layout.
 */
export async function extractPdfLinesFromArrayBuffer(data: ArrayBuffer): Promise<string[]> {
  ensureWorker()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) })
  const pdf = await loadingTask.promise
  const allLines: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const rowBuckets = new Map<number, { x: number; str: string }[]>()

    for (const raw of content.items) {
      const item = raw as TextItem
      if (!item?.str) continue
      const y = Math.round(item.transform[5] ?? 0)
      const x = item.transform[4] ?? 0
      const bucket = Math.round(y / 3) * 3
      if (!rowBuckets.has(bucket)) rowBuckets.set(bucket, [])
      rowBuckets.get(bucket)!.push({ x, str: item.str })
    }

    const ys = [...rowBuckets.keys()].sort((a, b) => b - a)
    for (const y of ys) {
      const cells = rowBuckets.get(y)!.sort((a, b) => a.x - b.x)
      const line = cells.map((c) => c.str.trim()).filter(Boolean).join('\t')
      if (line.trim()) allLines.push(line.trim())
    }
  }

  return allLines
}
