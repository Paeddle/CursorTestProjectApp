/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Chromium Shape Detection API — not in older TypeScript DOM libs. */
interface DetectedBarcode {
  rawValue: string
  format: string
  cornerPoints: readonly { x: number; y: number }[]
  boundingBox: DOMRectReadOnly
}

declare class BarcodeDetector {
  constructor(barcodeDetectorOptions?: { formats?: readonly string[] })
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>
  static getSupportedFormats(): Promise<string[]>
}
