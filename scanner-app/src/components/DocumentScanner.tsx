import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CornerPoints,
  cropDocumentFromCanvas,
  detectCornersFromCanvas,
  warmupDocumentScanner,
} from '../lib/documentScanner'
import './DocumentScanner.css'

interface DocumentScannerProps {
  onCapture: (blob: Blob) => void
  onClose: () => void
}

export default function DocumentScanner({ onCapture, onClose }: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const detectCanvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [processing, setProcessing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [cornerPoints, setCornerPoints] = useState<CornerPoints | null>(null)
  const [scannerReady, setScannerReady] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)

  const hasVideo = useMemo(() => Boolean(stream), [stream])

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not available. Use HTTPS or localhost.')
      return
    }
    let s: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          // Request highest practical quality; browsers will downshift if needed.
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 30 },
        },
      })
      .then((stream) => {
        s = stream
        setStream(stream)
        setError(null)
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }

        // Try to improve quality on supported devices (focus/zoom, etc.)
        const track = stream.getVideoTracks()[0]
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities() as MediaTrackCapabilities & {
            focusMode?: string[]
            zoom?: { min: number; max: number; step: number }
          }
          const advanced: MediaTrackConstraintSet[] = []

          if (caps.focusMode?.includes('continuous')) {
            advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet)
          }

          // If zoom is supported, leave it as-is (user zoom later is possible).
          if (advanced.length > 0) {
            track.applyConstraints({ advanced }).catch(() => {})
          }
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not access camera.')
      })
    return () => {
      s?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  // Ensure OpenCV + jscanify are loaded in production before we start detecting/cropping.
  useEffect(() => {
    let cancelled = false
    setScannerReady(false)
    setScannerError(null)
    warmupDocumentScanner()
      .then(() => {
        if (!cancelled) setScannerReady(true)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!cancelled) setScannerError(msg || 'Failed to initialize scanner')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Live detection + blue outline overlay
  useEffect(() => {
    if (!hasVideo) return
    if (!scannerReady) return
    const video = videoRef.current
    const overlay = overlayCanvasRef.current
    const detectCanvas = detectCanvasRef.current
    if (!video || !overlay || !detectCanvas) return

    let cancelled = false
    let raf = 0
    let lastRun = 0
    const minIntervalMs = 220

    const clearOverlay = () => {
      const ctx = overlay.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, overlay.width, overlay.height)
    }

    const drawOutline = (points: CornerPoints | null) => {
      const ctx = overlay.getContext('2d')
      if (!ctx) return

      const clientW = overlay.clientWidth
      const clientH = overlay.clientHeight
      if (clientW <= 0 || clientH <= 0) return

      // Ensure backing store matches CSS pixels for crisp lines
      const dpr = window.devicePixelRatio || 1
      const targetW = Math.round(clientW * dpr)
      const targetH = Math.round(clientH * dpr)
      if (overlay.width !== targetW || overlay.height !== targetH) {
        overlay.width = targetW
        overlay.height = targetH
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, overlay.width, overlay.height)
      if (!points) return

      const vw = video.videoWidth || 0
      const vh = video.videoHeight || 0
      if (vw === 0 || vh === 0) return

      // Match object-fit: contain mapping
      const scale = Math.min(targetW / vw, targetH / vh)
      const drawnW = vw * scale
      const drawnH = vh * scale
      const offsetX = (targetW - drawnW) / 2
      const offsetY = (targetH - drawnH) / 2

      const map = (p: { x: number; y: number }) => ({
        x: offsetX + p.x * scale,
        y: offsetY + p.y * scale,
      })

      const tl = map(points.topLeftCorner)
      const tr = map(points.topRightCorner)
      const br = map(points.bottomRightCorner)
      const bl = map(points.bottomLeftCorner)

      ctx.lineWidth = 3 * dpr
      ctx.strokeStyle = '#3b82f6'
      ctx.shadowColor = 'rgba(59,130,246,0.45)'
      ctx.shadowBlur = 10 * dpr

      ctx.beginPath()
      ctx.moveTo(tl.x, tl.y)
      ctx.lineTo(tr.x, tr.y)
      ctx.lineTo(br.x, br.y)
      ctx.lineTo(bl.x, bl.y)
      ctx.closePath()
      ctx.stroke()
    }

    const tick = async (now: number) => {
      raf = requestAnimationFrame(tick)
      if (cancelled) return
      if (processing) return
      if (video.readyState < 2) return
      if (now - lastRun < minIntervalMs) return
      lastRun = now

      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return

      // Downscale for faster detection
      const maxW = 640
      const scale = Math.min(1, maxW / vw)
      const dw = Math.max(1, Math.round(vw * scale))
      const dh = Math.max(1, Math.round(vh * scale))
      detectCanvas.width = dw
      detectCanvas.height = dh
      const dctx = detectCanvas.getContext('2d')
      if (!dctx) return
      dctx.drawImage(video, 0, 0, dw, dh)

      const detected = await detectCornersFromCanvas(detectCanvas)
      if (cancelled) return

      if (!detected) {
        setCornerPoints(null)
        clearOverlay()
        return
      }

      // Scale corner points back up to full video coordinates for capture-time cropping
      const sx = vw / dw
      const sy = vh / dh
      const scaled: CornerPoints = {
        topLeftCorner: { x: detected.topLeftCorner.x * sx, y: detected.topLeftCorner.y * sy },
        topRightCorner: { x: detected.topRightCorner.x * sx, y: detected.topRightCorner.y * sy },
        bottomLeftCorner: { x: detected.bottomLeftCorner.x * sx, y: detected.bottomLeftCorner.y * sy },
        bottomRightCorner: { x: detected.bottomRightCorner.x * sx, y: detected.bottomRightCorner.y * sy },
      }

      setCornerPoints(scaled)
      drawOutline(scaled)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      clearOverlay()
      setCornerPoints(null)
    }
  }, [hasVideo, processing, scannerReady])

  const handleCapture = async () => {
    const video = videoRef.current
    const captureCanvas = captureCanvasRef.current
    if (!video || !captureCanvas || !stream || video.readyState < 2) return

    setCaptureError(null)
    if (!scannerReady) {
      setCaptureError(scannerError ? `Scanner not ready: ${scannerError}` : 'Loading scanner… try again in a moment.')
      return
    }
    setProcessing(true)

    try {
      const w = video.videoWidth
      const h = video.videoHeight
      captureCanvas.width = w
      captureCanvas.height = h
      const ctx = captureCanvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0)

      const blob = await cropDocumentFromCanvas(captureCanvas, cornerPoints ?? undefined)
      if (blob) {
        setCapturedBlob(blob)
      } else {
        setCaptureError('No document detected. Point the camera at the paper and try again.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCaptureError(msg ? `Could not process image: ${msg}` : 'Could not process image. Try again.')
    } finally {
      setProcessing(false)
    }
  }

  const handleUseThis = () => {
    if (capturedBlob) {
      onCapture(capturedBlob)
      onClose()
    }
  }

  const handleRetake = () => {
    setCapturedBlob(null)
    setCaptureError(null)
  }

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (capturedBlob) {
      const url = URL.createObjectURL(capturedBlob)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setPreviewUrl(null)
    }
  }, [capturedBlob])

  return (
    <div className="document-scanner-overlay">
      <div className="document-scanner-header">
        <h3>Scan document</h3>
        <button type="button" className="document-scanner-close" onClick={onClose}>
          Close
        </button>
      </div>

      {error ? (
        <div className="document-scanner-error">
          <p>{error}</p>
        </div>
      ) : capturedBlob && previewUrl ? (
        <div className="document-scanner-preview">
          <img src={previewUrl} alt="Cropped document" />
          <div className="document-scanner-actions">
            <button type="button" className="btn btn-primary" onClick={handleUseThis}>
              Use this
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleRetake}>
              Retake
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="document-scanner-camera">
            <video ref={videoRef} autoPlay playsInline muted />
            <canvas ref={overlayCanvasRef} className="document-scanner-outline" />
            {!scannerReady && (
              <div className="document-scanner-loading">
                <p>{scannerError ? `Scanner init failed: ${scannerError}` : 'Loading scanner…'}</p>
              </div>
            )}
          </div>
          {captureError && (
            <p className="document-scanner-capture-error">{captureError}</p>
          )}
          <div className="document-scanner-actions document-scanner-actions-bottom">
            <button
              type="button"
              className="btn btn-primary btn-capture"
              onClick={handleCapture}
              disabled={processing || !stream || !scannerReady}
            >
              {processing ? 'Processing…' : 'Capture'}
            </button>
          </div>
        </>
      )}

      <canvas ref={captureCanvasRef} className="document-scanner-hidden-canvas" />
      <canvas ref={detectCanvasRef} className="document-scanner-hidden-canvas" />
    </div>
  )
}
