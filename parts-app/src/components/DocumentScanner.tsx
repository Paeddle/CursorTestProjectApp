import { useEffect, useRef, useState } from 'react'
import {
  CornerPoints,
  cropDocumentFromCanvas,
  DEFAULT_DOCUMENT_CROP_INSET,
  detectCornersFromCanvas,
  quadPolygonArea,
  warmupDocumentScanner,
} from '../lib/documentScanner'
import './DocumentScanner.css'

interface DocumentScannerProps {
  onCapture: (blob: Blob) => void
  onClose: () => void
}

function lerpCorners(a: CornerPoints, b: CornerPoints, t: number): CornerPoints {
  const mix = (pa: { x: number; y: number }, pb: { x: number; y: number }) => ({
    x: pa.x + (pb.x - pa.x) * t,
    y: pa.y + (pb.y - pa.y) * t,
  })
  return {
    topLeftCorner: mix(a.topLeftCorner, b.topLeftCorner),
    topRightCorner: mix(a.topRightCorner, b.topRightCorner),
    bottomLeftCorner: mix(a.bottomLeftCorner, b.bottomLeftCorner),
    bottomRightCorner: mix(a.bottomRightCorner, b.bottomRightCorner),
  }
}

function maxCornerJump(a: CornerPoints, b: CornerPoints): number {
  const d = (k: keyof CornerPoints) =>
    Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)
  return Math.max(
    d('topLeftCorner'),
    d('topRightCorner'),
    d('bottomLeftCorner'),
    d('bottomRightCorner')
  )
}

export default function DocumentScanner({ onCapture, onClose }: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const detectCanvasRef = useRef<HTMLCanvasElement>(null)
  const smoothedOuterRef = useRef<CornerPoints | null>(null)
  const lostFramesRef = useRef(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [processing, setProcessing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [scannerReady, setScannerReady] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)

  const hasVideo = Boolean(stream)

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not available. Use HTTPS or localhost.')
      return
    }
    let s: MediaStream | null = null
    const tryStream = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints)

    tryStream({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30, max: 60 },
      },
    })
      .catch(() =>
        tryStream({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 60 },
          },
        })
      )
      .catch(() =>
        tryStream({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      )
      .then((media) => {
        s = media
        setStream(media)
        setError(null)
        if (videoRef.current) {
          videoRef.current.srcObject = media
        }

        const track = media.getVideoTracks()[0]
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities() as MediaTrackCapabilities & {
            focusMode?: string[]
          }
          const advanced: MediaTrackConstraintSet[] = []
          if (caps.focusMode?.includes('continuous')) {
            advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet)
          }
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

  useEffect(() => {
    if (capturedBlob !== null || !stream) return
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    video.play().catch(() => {})
  }, [capturedBlob, stream])

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

  useEffect(() => {
    if (!hasVideo) return
    if (!scannerReady) return
    if (capturedBlob !== null) return
    const video = videoRef.current
    const overlay = overlayCanvasRef.current
    const detectCanvas = detectCanvasRef.current
    if (!video || !overlay || !detectCanvas) return

    let cancelled = false
    let raf = 0
    let lastDetect = 0
    const minDetectMs = 130

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

      const vr = video.getBoundingClientRect()
      const or = overlay.getBoundingClientRect()
      const scaleCssToBacking = targetW / Math.max(clientW, 1)

      const map = (p: { x: number; y: number }) => {
        const u = p.x / vw
        const v = p.y / vh
        const cssX = vr.left - or.left + u * vr.width
        const cssY = vr.top - or.top + v * vr.height
        return { x: cssX * scaleCssToBacking, y: cssY * scaleCssToBacking }
      }

      const tl = map(points.topLeftCorner)
      const tr = map(points.topRightCorner)
      const br = map(points.bottomRightCorner)
      const bl = map(points.bottomLeftCorner)

      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.lineWidth = 2.5 * dpr
      ctx.strokeStyle = '#60a5fa'
      ctx.shadowColor = 'rgba(37, 99, 235, 0.35)'
      ctx.shadowBlur = 6 * dpr

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
      if (processing) {
        drawOutline(smoothedOuterRef.current)
        return
      }
      if (video.readyState < 2) return

      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return

      drawOutline(smoothedOuterRef.current)

      if (now - lastDetect < minDetectMs) return
      lastDetect = now

      const maxW = 1280
      const detScale = Math.min(1, maxW / vw)
      const dw = Math.max(1, Math.round(vw * detScale))
      const dh = Math.max(1, Math.round(vh * detScale))
      detectCanvas.width = dw
      detectCanvas.height = dh
      const dctx = detectCanvas.getContext('2d')
      if (!dctx) return
      dctx.drawImage(video, 0, 0, dw, dh)

      const detected = await detectCornersFromCanvas(detectCanvas, { maxWorkDim: 1280 })
      if (cancelled) return

      const diag = Math.hypot(vw, vh)
      const jumpReject = 0.14 * diag

      if (!detected) {
        lostFramesRef.current++
        if (lostFramesRef.current >= 6) {
          smoothedOuterRef.current = null
          clearOverlay()
        }
        return
      }

      lostFramesRef.current = 0

      const sx = vw / dw
      const sy = vh / dh
      const raw: CornerPoints = {
        topLeftCorner: { x: detected.topLeftCorner.x * sx, y: detected.topLeftCorner.y * sy },
        topRightCorner: { x: detected.topRightCorner.x * sx, y: detected.topRightCorner.y * sy },
        bottomLeftCorner: { x: detected.bottomLeftCorner.x * sx, y: detected.bottomLeftCorner.y * sy },
        bottomRightCorner: { x: detected.bottomRightCorner.x * sx, y: detected.bottomRightCorner.y * sy },
      }

      const prev = smoothedOuterRef.current
      let use = raw
      if (prev) {
        const jump = maxCornerJump(prev, raw)
        const rawArea = quadPolygonArea(raw)
        const prevArea = quadPolygonArea(prev)
        const expanding = rawArea > prevArea * 1.12
        if (jump > jumpReject) {
          const t = expanding ? 0.62 : 0.32
          use = lerpCorners(prev, raw, t)
        } else {
          const t = expanding ? 0.48 : 0.36
          use = lerpCorners(prev, raw, t)
        }
      }
      smoothedOuterRef.current = use
      drawOutline(use)
    }

    smoothedOuterRef.current = null
    lostFramesRef.current = 0
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      smoothedOuterRef.current = null
      clearOverlay()
    }
  }, [hasVideo, processing, scannerReady, capturedBlob])

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

      const freshCorners = await detectCornersFromCanvas(captureCanvas, { maxWorkDim: 2200 })
      const outer = freshCorners ?? smoothedOuterRef.current
      const blob = await cropDocumentFromCanvas(captureCanvas, outer ?? undefined, {
        cropInset: DEFAULT_DOCUMENT_CROP_INSET,
      })
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
          <p className="document-scanner-hint">
            Blue outline tracks the page. Fill most of the frame with the paper; hold steady briefly. Capture
            re-detects corners on the full frame and snaps them to the page edge for a tight crop.
          </p>
          <div className="document-scanner-camera">
            <video ref={videoRef} autoPlay playsInline muted />
            <canvas ref={overlayCanvasRef} className="document-scanner-outline" />
            {!scannerReady && (
              <div className="document-scanner-loading">
                <p>{scannerError ? `Scanner init failed: ${scannerError}` : 'Loading scanner…'}</p>
              </div>
            )}
          </div>
          {captureError && <p className="document-scanner-capture-error">{captureError}</p>}
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
