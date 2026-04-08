import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Html5Qrcode, Html5QrcodeCameraScanConfig, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { ensureHtml5QrcodeRobustLiveDecode } from '../html5QrcodeRobustPatch'
import './QRScanner.css'

ensureHtml5QrcodeRobustLiveDecode()

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

function createQrBarcodeDetector(): BarcodeDetector | null {
  if (typeof BarcodeDetector === 'undefined') return null
  try {
    return new BarcodeDetector({ formats: ['qr_code'] })
  } catch {
    return null
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

/** Runs BarcodeDetector on (almost) every camera frame — better than a fixed timer when the hand drifts. */
function startPerFrameVideoQrDetect(opts: {
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
    detector.detect(video).then((codes) => {
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
    intervalId = window.setTimeout(pollFallback, 14)
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

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const scanDoneRef = useRef(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    scanDoneRef.current = false
  }, [])

  useEffect(() => {
    const detector = createQrBarcodeDetector()
    if (!detector || cameraError) return

    return startPerFrameVideoQrDetect({
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
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    })
    scannerRef.current = scanner

    const onSuccess = (decodedText: string) => {
      if (scanDoneRef.current) return
      scanDoneRef.current = true
      onScan(decodedText.trim())
    }
    const onError = () => {}

    // No `qrbox`: decode the full camera preview (same idea as the system Camera app),
    // while a separate CSS reticle shows a square aiming guide only.
    const buildConfig = (videoConstraints?: MediaTrackConstraints): Html5QrcodeCameraScanConfig => ({
      fps: 30,
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
          frameRate: { ideal: 30 },
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
    <div className="qr-scanner-overlay">
      <div className="qr-scanner-header">
        <div className="qr-scanner-header-text">
          <h3>Scan wire box QR code</h3>
          <p className="qr-scanner-hint">
            Small movements are OK: we read on each camera frame when supported, and ask the camera for 30
            fps when possible. Marks next to the QR can still slow decoding.
          </p>
        </div>
        <button type="button" className="qr-scanner-close" onClick={onClose}>
          Close
        </button>
      </div>
      {cameraError ? (
        <div className="qr-scanner-error">
          <p>{cameraError}</p>
          <p className="qr-scanner-error-hint">Allow camera in browser settings and reload.</p>
        </div>
      ) : (
        <div className="qr-scanner-stage">
          <div id="qr-reader" ref={containerRef} className="qr-scanner-reader" />
          <div className="qr-scanner-reticle" aria-hidden>
            <div className="qr-scanner-reticle-square" />
          </div>
        </div>
      )}
    </div>
  )
}
