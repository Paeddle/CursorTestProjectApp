import QRCode from 'qrcode'

/** Data URL PNG for canvas preview (DYMO print uses its own QR encoder). */
export async function qrPreviewDataUrl(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return await QRCode.toDataURL(trimmed, {
      margin: 1,
      width: 200,
      errorCorrectionLevel: 'M',
    })
  } catch {
    return null
  }
}
