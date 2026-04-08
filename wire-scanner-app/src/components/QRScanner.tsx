import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeCameraScanConfig, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import './QRScanner.css'

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setCameraError(null)
    const scanner = new Html5Qrcode(container.id, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    })
    scannerRef.current = scanner

    const onSuccess = (decodedText: string) => onScan(decodedText.trim())
    const onError = () => {}

    // No `qrbox`: decode the full camera preview (same idea as the system Camera app),
    // while a separate CSS reticle shows a square aiming guide only.
    const buildConfig = (videoConstraints?: MediaTrackConstraints): Html5QrcodeCameraScanConfig => ({
      fps: 20,
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
            Like your built-in camera, the whole view is scanned. Center the QR in the square for best
            results.
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
