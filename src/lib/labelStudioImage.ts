import { supabase } from './supabase'
import {
  labelRasterDimensionsForBounds,
  labelRasterPxForTwips,
  labelWriterRasterDimensionsExactTwips,
  MAX_LABEL_RASTER_PX,
} from './labelStudioRaster'
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

export async function loadImageBlobForPrint(url: string): Promise<Blob | null> {
  return loadImageBlob(url)
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

export async function loadOrientedImageSource(blob: Blob): Promise<OrientedImageSource | null> {
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

function drawImageIntoBoundsAt(
  ctx: CanvasRenderingContext2D,
  src: OrientedImageSource,
  x: number,
  y: number,
  targetW: number,
  targetH: number,
  scaleMode: LabelStudioImageScaleMode
): void {
  const srcW = Math.max(1, src.width)
  const srcH = Math.max(1, src.height)
  const scale =
    scaleMode === 'Fill'
      ? Math.max(targetW / srcW, targetH / srcH)
      : Math.min(targetW / srcW, targetH / srcH)
  const dw = Math.max(1, Math.round(srcW * scale))
  const dh = Math.max(1, Math.round(srcH * scale))
  const dx = x + Math.round((targetW - dw) / 2)
  const dy = y + Math.round((targetH - dh) / 2)
  ctx.drawImage(src.source, dx, dy, dw, dh)
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

export type StudioFaceImageLayer = {
  url: string
  /** Same 0–100% grid as Label Studio canvas CSS (left/top/width/height). */
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
  scaleMode: LabelStudioImageScaleMode
}

/**
 * Composite product photos onto the full printable face at 96 dpi (pixel positions match
 * the Label Studio canvas). Transparent outside image boxes — print as the top layer so
 * text on the left stays visible.
 */
export async function composeStudioFaceImageOverlayBase64(
  layers: StudioFaceImageLayer[],
  face: { width: number; height: number },
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
  if (layers.length === 0) return null

  const { width: faceW, height: faceH } = labelRasterDimensionsForBounds({
    width: face.width,
    height: face.height,
  })

  try {
    const canvas = document.createElement('canvas')
    canvas.width = faceW
    canvas.height = faceH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.clearRect(0, 0, faceW, faceH)

    for (const layer of layers) {
      const blob = await loadImageBlob(layer.url)
      if (!blob) continue
      const oriented = await loadOrientedImageSource(blob)
      if (!oriented) continue

      try {
        const x = Math.round((layer.xPct / 100) * faceW)
        const y = Math.round((layer.yPct / 100) * faceH)
        const w = Math.max(1, Math.round((layer.widthPct / 100) * faceW))
        const h = Math.max(1, Math.round((layer.heightPct / 100) * faceH))
        drawImageIntoBoundsAt(ctx, oriented, x, y, w, h, layer.scaleMode)
        if (thermal && thermalToneNeedsProcessing(thermal.tone)) {
          const imageData = ctx.getImageData(x, y, w, h)
          processThermalImageData(imageData, thermal.tone)
          ctx.putImageData(imageData, x, y)
        }
      } finally {
        oriented.cleanup?.()
      }
    }

    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  }
}

/** Fetch a product photo for DYMO ImageObject. */
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

  // Height-anchored aspect ratio so DYMO Uniform scaling does not letterbox within the element box.
  const { width: targetW, height: targetH } = labelRasterDimensionsForBounds(boundsTwips)

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

/** LW Durable element box — PNG at LabelWriter 300 dpi, Fill maps 1:1 to twips bounds. */
export async function fetchDurableElementImagePngBase64(
  url: string,
  boundsTwips: { width: number; height: number },
  scaleMode: LabelStudioImageScaleMode = 'Uniform',
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
  const blob = await loadImageBlob(url)
  if (!blob) return null
  const oriented = await loadOrientedImageSource(blob)
  if (!oriented) return null

  const { width: targetW, height: targetH } = labelWriterRasterDimensionsExactTwips(boundsTwips)

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

/**
 * @deprecated LW450 ignores Uniform upscale — use fetchDurableElementImagePngBase64.
 */
export async function fetchDymoUpscaleImagePngBase64(
  url: string,
  boundsTwips: { width: number; height: number },
  scaleMode: LabelStudioImageScaleMode = 'Uniform',
  thermal?: ThermalImageProcessOptions
): Promise<string | null> {
  const blob = await loadImageBlob(url)
  if (!blob) return null
  const oriented = await loadOrientedImageSource(blob)
  if (!oriented) return null

  const sidePx = labelRasterPxForTwips(Math.min(boundsTwips.width, boundsTwips.height))

  try {
    const canvas = document.createElement('canvas')
    canvas.width = sidePx
    canvas.height = sidePx
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    drawImageIntoBounds(ctx, oriented, sidePx, sidePx, scaleMode)
    if (thermal && thermalToneNeedsProcessing(thermal.tone)) {
      const imageData = ctx.getImageData(0, 0, sidePx, sidePx)
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
