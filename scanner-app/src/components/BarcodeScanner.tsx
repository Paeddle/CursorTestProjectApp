import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import './BarcodeScanner.css'

interface BarcodeScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setCameraError(null)
    const scanner = new Html5Qrcode(container.id)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
            return { width: Math.min(280, minEdge * 0.8), height: Math.min(140, minEdge * 0.4) }
          },
          aspectRatio: 1.333,
        },
        (decodedText) => {
          onScan(decodedText)
        },
        () => {}
      )
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
        <h3>Scan barcode</h3>
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
        <div id="barcode-reader" ref={containerRef} className="barcode-scanner-reader" />
      )}
    </div>
  )
}
