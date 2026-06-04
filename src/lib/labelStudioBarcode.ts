import type { DymoLabelBounds } from './labelStudioGeometry'
import type { LabelStudioBarcodeSize, LabelStudioBarcodeType } from '../types/labelStudio'

export function inferBarcodeType(value: string): Exclude<LabelStudioBarcodeType, 'Auto'> {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12) return 'UpcA'
  if (digits.length === 13) return 'Ean13'
  return 'Code128Auto'
}

export function resolveBarcodeType(
  configured: LabelStudioBarcodeType,
  value: string
): Exclude<LabelStudioBarcodeType, 'Auto'> {
  if (configured !== 'Auto') return configured
  return inferBarcodeType(value)
}

/** Symbology name as required in DYMO label XML (&lt;Type&gt;). */
export function dymoBarcodeSymbologyXml(
  type: Exclude<LabelStudioBarcodeType, 'Auto'>
): string {
  if (type === 'QrCode') return 'QRCode'
  return type
}

/** Normalize barcode payload for the selected symbology. */
export function barcodeTextForPrint(
  value: string,
  type: Exclude<LabelStudioBarcodeType, 'Auto'>
): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (type === 'QrCode') return trimmed
  if (type === 'UpcA') return trimmed.replace(/\D/g, '').slice(0, 12)
  if (type === 'Ean13') return trimmed.replace(/\D/g, '').slice(0, 13)
  return trimmed
}

/**
 * DYMO &lt;Size&gt; is a multiplier, not shrink-to-fit — pick from printable bounds so the code stays inside the box.
 */
export function dymoBarcodeSizeForBounds(
  bounds: DymoLabelBounds,
  symbology: Exclude<LabelStudioBarcodeType, 'Auto'>
): LabelStudioBarcodeSize {
  const h = bounds.height
  const w = bounds.width
  const metric =
    symbology === 'QrCode' ? Math.min(h, w) : Math.min(h, Math.round(w / 2.5))

  if (metric < 520) return 'Small'
  if (metric < 820) return 'Medium'
  if (metric < 1200) return 'Large'
  return 'ExtraLarge'
}
