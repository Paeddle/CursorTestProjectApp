import { supabase } from './supabase'
import { MAX_LABEL_RASTER_PX } from './labelStudioRaster'
import {
  processThermalImageData,
  thermalToneNeedsProcessing,
  type ThermalImageProcessOptions,
} from './labelStudioThermalImage'
import type { LabelStudioImageScaleMode } from '../types/labelStudio'

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

type OrientedImageSource = {
  source: CanvasImageSource
  width: number
  height: number
  cleanup?: () => void
}

async function loadOrientedImageSource(blob: Blob): Promise<OrientedImageSource | null> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    } catch {
      /* fall back to HTMLImageElement */
    }
  }
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    img.src = objectUrl
  })
}

function drawImageIntoBounds(
  ctx: CanvasRenderingContext2D,
  src: OrientedImageSource,
  targetW: number,
  targetH: number,
  scaleMode: LabelStudioImageScaleMode
): void {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  const srcW = Math.max(1, src.width)
  const srcH = Math.max(1, src.height)
  const scale =
    scaleMode === 'Fill'
      ? Math.max(targetW / srcW, targetH / srcH)
      : Math.min(targetW / srcW, targetH / srcH)
  const dw = Math.max(1, Math.round(srcW * scale))
  const dh = Math.max(1, Math.round(srcH * scale))
  const dx = Math.round((targetW - dw) / 2)
  const dy = Math.round((targetH - dh) / 2)
  ctx.drawImage(src.source, dx, dy, dw, dh)
}

/** Fetch a product photo for DYMO ImageObject — high-res raster, same bounds as canvas. */
export async function fetchProductImagePngBase64(
  url: string,
  boundsTwips: { width: number; height: number },
  scaleMode: LabelStudioImageScaleMode = 'Uniform',
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
  const blob = await loadImageBlob(url)
  if (!blob) return null
  const oriented = await loadOrientedImageSource(blob)
  if (!oriented) return null

  const aspect = Math.max(0.05, boundsTwips.width / Math.max(1, boundsTwips.height))
  let targetW = MAX_LABEL_RASTER_PX
  let targetH = Math.max(32, Math.round(MAX_LABEL_RASTER_PX / aspect))
  if (targetH > MAX_LABEL_RASTER_PX) {
    targetH = MAX_LABEL_RASTER_PX
    targetW = Math.max(32, Math.round(MAX_LABEL_RASTER_PX * aspect))
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    drawImageIntoBounds(ctx, oriented, targetW, targetH, scaleMode)
    if (thermal && thermalToneNeedsProcessing(thermal.tone)) {
      const imageData = ctx.getImageData(0, 0, targetW, targetH)
      processThermalImageData(imageData, thermal.tone)
      ctx.putImageData(imageData, 0, 0)
    }
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  } finally {
    oriented.cleanup?.()
  }
}

/** Fetch an image URL and return PNG bytes as base64 for DYMO ImageObject XML. */
export async function fetchUrlAsPngBase64(
  url: string,
  boundsTwips?: { width: number; height: number },
  thermal?: ThermalImageProcessOptions,
  scaleMode: LabelStudioImageScaleMode = 'Uniform'
): Promise<string | null> {
  if (boundsTwips != null) {
    return fetchProductImagePngBase64(url, boundsTwips, scaleMode, thermal)
  }
  const blob = await loadImageBlob(url)
  if (!blob) return null
  return blobToPngBase64(blob, MAX_LABEL_RASTER_PX, thermal)
}

/** Data URL for canvas preview — applies the same thermal tuning as print when enabled. */
export async function fetchUrlAsPreviewDataUrl(
  url: string,
  maxPx: number,
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
  const blob = await loadImageBlob(url)
  if (!blob) return null
  return blobToDataUrl(blob, maxPx, thermal)
}

export function blobToPngBase64(
  blob: Blob,
  maxPx = MAX_LABEL_RASTER_PX,
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
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
        if (thermal && thermalToneNeedsProcessing(thermal.tone)) {
          const imageData = ctx.getImageData(0, 0, w, h)
          processThermalImageData(imageData, thermal.tone)
          ctx.putImageData(imageData, 0, 0)
        }
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

function blobToDataUrl(
  blob: Blob,
  maxPx = MAX_LABEL_RASTER_PX,
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
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
        if (thermal && thermalToneNeedsProcessing(thermal.tone)) {
          const imageData = ctx.getImageData(0, 0, w, h)
          processThermalImageData(imageData, thermal.tone)
          ctx.putImageData(imageData, 0, 0)
        }
        resolve(canvas.toDataURL('image/png'))
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
