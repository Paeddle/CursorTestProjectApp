/** Barcode Detection API (Chromium; not in all TypeScript DOM libs). */
interface DetectedBarcode {
  format: string
  rawValue: string
}

declare class BarcodeDetector {
  constructor(options: { formats: string[] })
  detect(image: CanvasImageSource): Promise<DetectedBarcode[]>
}
