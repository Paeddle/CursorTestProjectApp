export type LabelStudioBarcodePreviewFormat = 'qr' | 'linear'

export type LabelStudioBarcodePreview = {
  format: LabelStudioBarcodePreviewFormat
  dataUrl: string
}
