import QRCode from 'qrcode'

/** Max edge DYMO Connect accepts for embedded label images. */
const MAX_PRINT_QR_PX = 320

/** PNG base64 for DYMO ImageObject — fills print bounds (BarcodeObject Size is capped). */
export async function qrPngBase64ForPrint(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const dataUrl = await QRCode.toDataURL(trimmed, {
      margin: 1,
      width: MAX_PRINT_QR_PX,
      errorCorrectionLevel: 'M',
    })
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch {
    return null
  }
}

/** Data URL PNG for canvas preview. */
export async function qrPreviewDataUrl(text: string, maxBoxPx?: number): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const side = Math.max(48, Math.min(320, Math.floor((maxBoxPx ?? 200) * 0.9)))
  try {
    return await QRCode.toDataURL(trimmed, {
      margin: 1,
      width: side,
      errorCorrectionLevel: 'M',
    })
  } catch {
    return null
  }
}
