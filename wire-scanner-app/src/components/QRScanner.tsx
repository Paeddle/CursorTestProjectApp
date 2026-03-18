import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
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
    const scanner = new Html5Qrcode(container.id)
    scannerRef.current = scanner

    const config = {
      fps: 10,
      qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
        const size = Math.min(260, minEdge * 0.85)
        return { width: size, height: size }
      },
      aspectRatio: 1,
    }
    const onSuccess = (decodedText: string) => onScan(decodedText.trim())
    const onError = () => {}

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
        return scanner.start(cameraId, config, onSuccess, onError)
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
        <h3>Scan wire box QR code</h3>
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
        <div id="qr-reader" ref={containerRef} className="qr-scanner-reader" />
      )}
    </div>
  )
}
