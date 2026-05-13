import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  Html5Qrcode,
  Html5QrcodeCameraScanConfig,
  Html5QrcodeSupportedFormats,
} from 'html5-qrcode'
import { ensureHtml5QrcodeRobustLiveDecode } from '../html5QrcodeRobustPatch'
import './BarcodeScanner.css'

ensureHtml5QrcodeRobustLiveDecode()

/** 1D + common 2D symbologies on packing slips and cartons */
const PO_SCAN_FORMATS: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.PDF_417,
]

const NATIVE_FORMATS_FULL = [
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
  'qr_code',
  'data_matrix',
  'pdf417',
] as const

function createPoBarcodeDetector(): BarcodeDetector | null {
  if (typeof BarcodeDetector === 'undefined') return null
  try {
    return new BarcodeDetector({ formats: [...NATIVE_FORMATS_FULL] })
  } catch {
    try {
      return new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'qr_code'],
      })
    } catch {
      return null
    }
  }
}

type VideoFrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number
  cancelVideoFrameCallback: (handle: number) => void
}

function supportsRequestVideoFrameCallback(v: HTMLVideoElement): v is VideoFrameVideo {
  return (
    typeof (v as VideoFrameVideo).requestVideoFrameCallback === 'function' &&
    typeof (v as VideoFrameVideo).cancelVideoFrameCallback === 'function'
  )
}

/** Native scan on (almost) every decoded video frame — catches codes between ZXing passes. */
function startPerFrameVideoBarcodeDetect(opts: {
  getContainer: () => HTMLElement | null
  detector: BarcodeDetector
  scanDoneRef: MutableRefObject<boolean>
  onFound: (text: string) => void
}): () => void {
  let cancelled = false
  let rvfHandle: number | undefined
  let intervalId = 0

  const { getContainer, detector, scanDoneRef, onFound } = opts

  const runDetect = (video: HTMLVideoElement) => {
    if (scanDoneRef.current || cancelled) return
    detector.detect(video).then((codes: DetectedBarcode[]) => {
      if (cancelled || scanDoneRef.current || !codes?.length) return
      const raw = codes[0]?.rawValue
      if (raw) {
        scanDoneRef.current = true
        onFound(raw.trim())
      }
    })
  }

  const pollFallback = () => {
    if (cancelled || scanDoneRef.current) return
    const video = getContainer()?.querySelector('video')
    if (video instanceof HTMLVideoElement && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      runDetect(video)
    }
    intervalId = window.setTimeout(pollFallback, 8)
  }

  const scheduleNext = () => {
    if (cancelled || scanDoneRef.current) return
    const video = getContainer()?.querySelector('video')
    if (!(video instanceof HTMLVideoElement)) {
      requestAnimationFrame(scheduleNext)
      return
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      requestAnimationFrame(scheduleNext)
      return
    }

    if (supportsRequestVideoFrameCallback(video)) {
      rvfHandle = video.requestVideoFrameCallback(() => {
        if (!cancelled && !scanDoneRef.current) {
          runDetect(video)
          scheduleNext()
        }
      })
    } else {
      pollFallback()
    }
  }

  scheduleNext()

  return () => {
    cancelled = true
    window.clearTimeout(intervalId)
    const video = getContainer()?.querySelector('video')
    if (video != null && supportsRequestVideoFrameCallback(video) && rvfHandle != null) {
      try {
        video.cancelVideoFrameCallback(rvfHandle)
      } catch {
        /* ignore */
      }
    }
  }
}

interface BarcodeScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const scanDoneRef = useRef(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    scanDoneRef.current = false
  }, [])

  useEffect(() => {
    const detector = createPoBarcodeDetector()
    if (!detector || cameraError) return

    return startPerFrameVideoBarcodeDetect({
      getContainer: () => containerRef.current,
      detector,
      scanDoneRef,
      onFound: onScan,
    })
  }, [cameraError, onScan])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setCameraError(null)
    const scanner = new Html5Qrcode(container.id, {
      verbose: false,
      formatsToSupport: PO_SCAN_FORMATS,
      useBarCodeDetectorIfSupported: true,
    })
    scannerRef.current = scanner

    const onSuccess = (decodedText: string) => {
      if (scanDoneRef.current) return
      scanDoneRef.current = true
      onScan(decodedText.trim())
    }
    const onError = () => {}

    // Full frame (no qrbox): small 1D boxes are not clipped; matches dedicated scanner behavior.
    const buildConfig = (videoConstraints?: MediaTrackConstraints): Html5QrcodeCameraScanConfig => ({
      fps: 60,
      disableFlip: true,
      ...(videoConstraints ? { videoConstraints } : {}),
    })

    Html5Qrcode.getCameras()
      .then((cameras) => {
        if (!cameras || cameras.length === 0) {
          setCameraError('No cameras found. Allow camera access and try again.')
          return
        }
        const back = cameras.find(
          (c) =>
            /back|environment|rear/i.test(c.label) ||
            (c as { facingMode?: string }).facingMode === 'environment'
        )
        const cameraId = back?.id ?? cameras[0].id

        const tryHighRes = buildConfig({
          deviceId: { exact: cameraId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
        })

        return scanner.start(cameraId, tryHighRes, onSuccess, onError).catch((firstErr: unknown) => {
          console.warn('Camera start with high-res constraints failed, retrying with defaults:', firstErr)
          scanner.clear()
          return scanner.start(cameraId, buildConfig(), onSuccess, onError)
        })
      })
      .catch((err: unknown) => {
        console.error('Camera start failed:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setCameraError(msg || 'Camera access failed. Allow camera permission and try again.')
      })

    return () => {
      scanner
        .stop()
        .then(() => {
          scanner.clear()
          scannerRef.current = null
        })
        .catch(() => {})
    }
  }, [onScan])

  return (
    <div className="barcode-scanner-overlay">
      <div className="barcode-scanner-header">
        <div className="barcode-scanner-header-text">
          <h3>Scan barcode</h3>
          <p className="barcode-scanner-hint">
            Hold the label steady in good light. The app reads the full camera frame (like a hardware
            scanner). Align long barcodes with the horizontal guide.
          </p>
        </div>
        <button type="button" className="barcode-scanner-close" onClick={onClose}>
          Close
        </button>
      </div>
      {cameraError ? (
        <div className="barcode-scanner-error">
          <p>{cameraError}</p>
          <p className="barcode-scanner-error-hint">Allow camera in browser settings and reload.</p>
        </div>
      ) : (
        <div className="barcode-scanner-stage">
          <div id="barcode-reader" ref={containerRef} className="barcode-scanner-reader" />
          <div className="barcode-scanner-reticle" aria-hidden>
            <div className="barcode-scanner-reticle-slot" />
          </div>
        </div>
      )}
    </div>
  )
}
