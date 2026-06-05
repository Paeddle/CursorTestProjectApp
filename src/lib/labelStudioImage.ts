import { supabase } from './supabase'
import { labelRasterPxForTwips, MAX_LABEL_RASTER_PX } from './labelStudioRaster'

/** Parse Supabase public storage URL → bucket + object path. */
export function parseSupabaseStoragePublicUrl(url: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (!m) return null
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

async function loadImageBlob(url: string): Promise<Blob | null> {
  const storage = parseSupabaseStoragePublicUrl(url)
  if (storage && supabase) {
    const { data, error } = await supabase.storage.from(storage.bucket).download(storage.path)
    if (!error && data) return data
  }
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

/** Fetch an image URL and return PNG bytes as base64 for DYMO ImageObject XML. */
export async function fetchUrlAsPngBase64(
  url: string,
  boundsTwips?: { width: number; height: number }
): Promise<string | null> {
  const maxPx =
    boundsTwips != null
      ? labelRasterPxForTwips(Math.min(boundsTwips.width, boundsTwips.height))
      : MAX_LABEL_RASTER_PX
  const blob = await loadImageBlob(url)
  if (!blob) return null
  return blobToPngBase64(blob, maxPx)
}

export function blobToPngBase64(blob: Blob, maxPx = MAX_LABEL_RASTER_PX): Promise<string | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
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
        ctx.drawImage(img, 0, 0, w, h)
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
