import QRCode from 'qrcode'
import { qrPrintRasterPxForTwips } from './labelStudioRaster'
import { STUDIO_QR_QUIET_ZONE_MODULES } from './labelStudioGeometry'

/** Crisp-enough preview raster; canvas CSS scales this to the resized element box. */
const QR_PREVIEW_RASTER_PX = 256

/** DieCut + DesktopLabel — Fill maps PNG pixels ~1:1 on LabelWriter thermal dots. */
export const STUDIO_QR_PRINT_IMAGE_OPTIONS = {
  scaleMode: 'Fill' as const,
  horizontalAlignment: 'Left' as const,
  verticalAlignment: 'Top' as const,
}

function qrRenderOptions(width: number) {
  return {
    margin: STUDIO_QR_QUIET_ZONE_MODULES,
    width,
    errorCorrectionLevel: 'M' as const,
    color: { dark: '#000000', light: '#FFFFFF' },
  }
}

/** Force pure black/white modules — thermal printers blur gray antialiased edges. */
function binarizeQrPngBase64(b64: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(b64)
          return
        }
        ctx.drawImage(img, 0, 0)
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const d = id.data
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          const v = lum < 128 ? 0 : 255
          d[i] = v
          d[i + 1] = v
          d[i + 2] = v
          d[i + 3] = 255
        }
        ctx.putImageData(id, 0, 0)
        resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
      } catch {
        resolve(b64)
      }
    }
    img.onerror = () => resolve(b64)
    img.src = `data:image/png;base64,${b64}`
  })
}

/** PNG base64 for DYMO ImageObject — 300 dpi, binarized for thermal scan reliability. */
export async function qrPngBase64ForPrint(
  text: string,
  sideTwips?: number
): Promise<string | null> {
  if (!text || !text.trim()) return null
  const width = sideTwips != null ? qrPrintRasterPxForTwips(sideTwips) : 256
  try {
    const dataUrl = await QRCode.toDataURL(text, qrRenderOptions(width))
    const raw = dataUrl.replace(/^data:image\/png;base64,/, '')
    return await binarizeQrPngBase64(raw)
  } catch {
    return null
  }
}

/** Data URL PNG for canvas preview (scaled via CSS to the element box). */
export async function qrPreviewDataUrl(text: string): Promise<string | null> {
  if (!text || !text.trim()) return null
  try {
    return await QRCode.toDataURL(text, qrRenderOptions(QR_PREVIEW_RASTER_PX))
  } catch {
    return null
  }
}
