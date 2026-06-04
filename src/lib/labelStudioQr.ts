import QRCode from 'qrcode'

/** Data URL PNG for canvas preview (DYMO print uses its own QR encoder). */
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
