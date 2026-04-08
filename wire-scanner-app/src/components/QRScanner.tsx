import { useEffect, useRef, useState } from 'react'
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

    const tick = () => {
      if (scanDoneRef.current) return
      const video = containerRef.current?.querySelector('video')
      if (!(video instanceof HTMLVideoElement) || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return
      }
      detector.detect(video).then((codes) => {
        if (scanDoneRef.current || !codes?.length) return
        const raw = codes[0].rawValue
        if (raw) {
          scanDoneRef.current = true
          onScan(raw.trim())
        }
      })
    }

    const id = window.setInterval(tick, 28)
    return () => window.clearInterval(id)
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
      fps: 24,
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
            The full preview is scanned. Hold steady; sharpie or handwriting next to the code may need an
            extra moment.
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
