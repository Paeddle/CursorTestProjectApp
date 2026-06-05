import { labelRasterPxForTwips } from './labelStudioQr'

/** Keep embedded label images small so DYMO Connect accepts the XML. */
const MAX_PRINT_IMAGE_PX = 320

/** Fetch an image URL and return PNG bytes as base64 for DYMO ImageObject XML. */
export async function fetchUrlAsPngBase64(
  url: string,
  boundsTwips?: { width: number; height: number }
): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const maxPx =
      boundsTwips != null
        ? labelRasterPxForTwips(Math.min(boundsTwips.width, boundsTwips.height))
        : MAX_PRINT_IMAGE_PX
    return blobToPngBase64(blob, maxPx)
  } catch {
    return null
  }
}

export function blobToPngBase64(blob: Blob, maxPx = MAX_PRINT_IMAGE_PX): Promise<string | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        let w = Math.max(1, img.naturalWidth)
        let h = Math.max(1, img.naturalHeight)
        if (maxPx > 0 && (w > maxPx || h > maxPx)) {
          const scale = maxPx / Math.max(w, h)
          w = Math.max(1, Math.round(w * scale))
          h = Math.max(1, Math.round(h * scale))
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        resolve(dataUrl.replace(/^data:image\/png;base64,/, ''))
      } catch {
        resolve(null)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    img.src = objectUrl
  })
}
