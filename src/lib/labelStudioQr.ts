import QRCode from 'qrcode'
import { labelRasterPxForTwips, MAX_LABEL_RASTER_PX } from './labelStudioRaster'

export { labelRasterPxForTwips } from './labelStudioRaster'

/** Crisp-enough preview raster; canvas CSS scales this to the resized element box. */
const QR_PREVIEW_RASTER_PX = 256

/** PNG base64 for DYMO ImageObject — raster sized to the print bounds edge. */
export async function qrPngBase64ForPrint(
  text: string,
  sideTwips?: number
): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const width = sideTwips != null ? labelRasterPxForTwips(sideTwips) : MAX_LABEL_RASTER_PX
  try {
    const dataUrl = await QRCode.toDataURL(trimmed, {
      margin: 1,
      width,
      errorCorrectionLevel: 'M',
    })
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  }
}

/** Data URL PNG for canvas preview (scaled via CSS to the element box). */
export async function qrPreviewDataUrl(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return await QRCode.toDataURL(trimmed, {
      margin: 1,
      width: QR_PREVIEW_RASTER_PX,
      errorCorrectionLevel: 'M',
    })
  } catch {
    return null
  }
}
