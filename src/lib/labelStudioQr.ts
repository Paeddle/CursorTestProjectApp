import QRCode from 'qrcode'
import { labelRasterPxForTwips, MAX_LABEL_RASTER_PX } from './labelStudioRaster'
import { STUDIO_QR_QUIET_ZONE_MODULES } from './labelStudioGeometry'

export { labelRasterPxForTwips } from './labelStudioRaster'

/** Crisp-enough preview raster; canvas CSS scales this to the resized element box. */
const QR_PREVIEW_RASTER_PX = 256

const QR_RENDER_OPTIONS = {
  margin: STUDIO_QR_QUIET_ZONE_MODULES,
  errorCorrectionLevel: 'M' as const,
}

/** PNG base64 for DYMO ImageObject — raster sized to the print bounds edge. */
export async function qrPngBase64ForPrint(
  text: string,
  sideTwips?: number
): Promise<string | null> {
  if (!text || !text.trim()) return null
  const width = sideTwips != null ? labelRasterPxForTwips(sideTwips) : MAX_LABEL_RASTER_PX
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      ...QR_RENDER_OPTIONS,
      width,
    })
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  }
}

/** Data URL PNG for canvas preview (scaled via CSS to the element box). */
export async function qrPreviewDataUrl(text: string): Promise<string | null> {
  if (!text || !text.trim()) return null
  try {
    return await QRCode.toDataURL(text, {
      ...QR_RENDER_OPTIONS,
      width: QR_PREVIEW_RASTER_PX,
    })
  } catch {
    return null
  }
}
