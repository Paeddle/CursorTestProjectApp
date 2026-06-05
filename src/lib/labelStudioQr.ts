import QRCode from 'qrcode'

/** Max edge DYMO Connect accepts for embedded label images. */
const MAX_PRINT_QR_PX = 320

/** Crisp-enough preview raster; canvas CSS scales this to the resized element box. */
const QR_PREVIEW_RASTER_PX = 256

/** Map DYMO twips on the printed square edge → PNG pixel width (96 dpi). */
export function qrRasterPxForTwips(sideTwips: number): number {
  const px = Math.round((sideTwips * 96) / 1440)
  return Math.max(64, Math.min(MAX_PRINT_QR_PX, px))
}

/** PNG base64 for DYMO ImageObject — raster sized to the print bounds edge. */
export async function qrPngBase64ForPrint(
  text: string,
  sideTwips?: number
): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const width = sideTwips != null ? qrRasterPxForTwips(sideTwips) : MAX_PRINT_QR_PX
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
