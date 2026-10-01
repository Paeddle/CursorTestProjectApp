import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfPageText, PdfTextItem } from './estimateRoughIn'

let workerConfigured = false

function ensureWorker() {
  if (workerConfigured) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
  workerConfigured = true
}

type TextItem = { str?: string; transform?: number[] }

export type RoughInDocument = {
  pages: PdfPageText[]
  renderPage: (pageIndex: number, scale: number) => Promise<HTMLCanvasElement>
}

export async function openRoughInPdf(data: ArrayBuffer): Promise<RoughInDocument> {
  ensureWorker()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise
  const pages: PdfPageText[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: PdfTextItem[] = []
    for (const raw of content.items) {
      const item = raw as TextItem
      const str = item.str?.trim() ?? ''
      if (!str) continue
      items.push({
        str,
        x: Number(item.transform?.[4] ?? 0),
        y: Number(item.transform?.[5] ?? 0),
      })
    }
    pages.push({
      pageIndex: pageNumber - 1,
      width: viewport.width,
      height: viewport.height,
      items,
    })
  }

  return {
    pages,
    renderPage: async (pageIndex: number, scale: number) => {
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) throw new Error('Could not draw the plan page.')
      await page.render({ canvasContext, viewport }).promise
      return canvas
    },
  }
}
