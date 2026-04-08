import { Html5Qrcode } from 'html5-qrcode'

/**
 * html5-qrcode's live loop used to alternate decoders per frame; we already patch to run robust
 * decoding. For latency, we race native BarcodeDetector vs ZXing on the same canvas in parallel:
 * whichever succeeds first wins (typical speed-up when one engine is slow on a frame).
 */
type ScanSuccess = (decodedText: string, decodedResult?: unknown) => void
type ScanFail = (errorMessage: string, error?: unknown) => void

type Decoder = { decodeAsync: (canvas: HTMLCanvasElement) => Promise<{ text: string }> }

type ScannerInternals = {
  stateManagerProxy: { isPaused: () => boolean }
  qrcode: { primaryDecoder: Decoder; secondaryDecoder?: Decoder }
  possiblyUpdateShaders: (matched: boolean) => void
  canvasElement: HTMLCanvasElement
}

function firstFulfilled<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (promises.length === 0) {
      reject(new Error('no decoders'))
      return
    }
    let settled = false
    let failed = 0
    const n = promises.length
    for (const p of promises) {
      p.then(
        (value) => {
          if (!settled) {
            settled = true
            resolve(value)
          }
        },
        () => {
          failed++
          if (!settled && failed === n) {
            reject(new Error('all decoders failed'))
          }
        }
      )
    }
  })
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
    const shim = self.qrcode as ScannerInternals['qrcode']
    const canvas = self.canvasElement
    const primary = shim.primaryDecoder.decodeAsync(canvas)
    const decode = shim.secondaryDecoder
      ? firstFulfilled([primary, shim.secondaryDecoder.decodeAsync(canvas)])
      : primary

    return decode
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
