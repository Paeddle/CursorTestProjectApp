import { Html5Qrcode } from 'html5-qrcode'

/**
 * html5-qrcode's live camera loop calls `decodeAsync`, which alternates BarcodeDetector and ZXing
 * per frame. When one fails on noisy QRs (e.g. sharpie near the code), the other often would
 * succeed on that same frame — but may not run until later. `decodeRobustlyAsync` runs native
 * first, then ZXing on the same frame if needed (same path used for file scans).
 */
type ScanSuccess = (decodedText: string, decodedResult?: unknown) => void
type ScanFail = (errorMessage: string, error?: unknown) => void

type ScannerInternals = {
  stateManagerProxy: { isPaused: () => boolean }
  qrcode: { decodeRobustlyAsync: (canvas: HTMLCanvasElement) => Promise<{ text: string }> }
  possiblyUpdateShaders: (matched: boolean) => void
  canvasElement: HTMLCanvasElement
}

let applied = false

export function ensureHtml5QrcodeRobustLiveDecode(): void {
  if (applied) return
  applied = true

  const proto = Html5Qrcode.prototype as unknown as {
    scanContext: (
      this: Html5Qrcode,
      success: ScanSuccess,
      fail: ScanFail
    ) => Promise<boolean>
  }

  proto.scanContext = function (
    this: Html5Qrcode,
    qrCodeSuccessCallback: ScanSuccess,
    qrCodeErrorCallback: ScanFail
  ): Promise<boolean> {
    const self = this as unknown as ScannerInternals
    if (self.stateManagerProxy.isPaused()) {
      return Promise.resolve(false)
    }
    return self.qrcode
      .decodeRobustlyAsync(self.canvasElement)
      .then((result) => {
        qrCodeSuccessCallback(result.text, undefined)
        self.possiblyUpdateShaders(true)
        return true
      })
      .catch((error: unknown) => {
        self.possiblyUpdateShaders(false)
        const message = error instanceof Error ? error.message : String(error)
        qrCodeErrorCallback(message || 'QR parse error', error)
        return false
      })
  }
}
