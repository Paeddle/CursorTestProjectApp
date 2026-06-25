import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
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

/** Chromium / WebKit extensions not in baseline TypeScript DOM typings */
type VideoTrackCaps = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step?: number }
  torch?: boolean
}

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

function pickVideoTrack(container: HTMLElement): MediaStreamTrack | null {
  const video = container.querySelector('video')
  const src = video?.srcObject
  if (!(src instanceof MediaStream)) return null
  return src.getVideoTracks()[0] ?? null
}

/** Wait until html5-qrcode has bound the MediaStream to the preview video. */
function whenVideoTrackReady(
  container: HTMLElement,
  onTrack: (track: MediaStreamTrack) => void,
  onGiveUp?: () => void
): () => void {
  let cancelled = false
  let n = 0
  const tick = () => {
    if (cancelled) return
    const track = pickVideoTrack(container)
    if (track && track.readyState === 'live') {
      onTrack(track)
      return
    }
    n++
    if (n >= 80) {
      onGiveUp?.()
      return
    }
    window.setTimeout(tick, 50)
  }
  tick()
  return () => {
    cancelled = true
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
  const videoTrackRef = useRef<MediaStreamTrack | null>(null)
  const stopTrackProbeRef = useRef<(() => void) | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null)
  const [zoomValue, setZoomValue] = useState(1)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [zoomProbeDone, setZoomProbeDone] = useState(false)

  const applyZoomLevel = useCallback(async (value: number) => {
    const track = videoTrackRef.current
    const range = zoomRange
    if (!track || !range) return
    const clamped = Math.min(range.max, Math.max(range.min, value))
    const step = range.step > 0 ? range.step : 0.01
    const snapped = Math.round(clamped / step) * step
    const z = Math.min(range.max, Math.max(range.min, snapped))
    try {
      await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] })
      setZoomValue(z)
    } catch (e) {
      console.warn('apply zoom failed:', e)
    }
  }, [zoomRange])

  const toggleTorch = useCallback(async () => {
    const track = videoTrackRef.current
    if (!track || !torchSupported) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch (e) {
      console.warn('torch toggle failed:', e)
    }
  }, [torchOn, torchSupported])

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
    setZoomRange(null)
    setZoomProbeDone(false)
    setTorchSupported(false)
    setTorchOn(false)
    videoTrackRef.current = null
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

        const try4k = buildConfig({
          deviceId: { exact: cameraId },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 30 },
        })
        const try1080 = buildConfig({
          deviceId: { exact: cameraId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
        })

        const startWithBestResolution = () =>
          scanner
            .start(cameraId, try4k, onSuccess, onError)
            .catch((e4k: unknown) => {
              console.warn('4K camera constraints failed, trying 1080p:', e4k)
              scanner.clear()
              return scanner.start(cameraId, try1080, onSuccess, onError)
            })
            .catch((firstErr: unknown) => {
              console.warn('1080p constraints failed, retrying with defaults:', firstErr)
              scanner.clear()
              return scanner.start(cameraId, buildConfig(), onSuccess, onError)
            })

        return startWithBestResolution().then(() => {
          stopTrackProbeRef.current?.()
          stopTrackProbeRef.current = whenVideoTrackReady(
            container,
            (track) => {
              videoTrackRef.current = track
              const caps = track.getCapabilities() as VideoTrackCaps
              if (caps.zoom && caps.zoom.max > caps.zoom.min) {
                const step =
                  caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : (caps.zoom.max - caps.zoom.min) / 20
                setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step })
                const settings = track.getSettings() as { zoom?: number }
                const initial = settings.zoom ?? caps.zoom.min
                setZoomValue(initial)
              } else {
                setZoomRange(null)
              }
              setTorchSupported(!!caps.torch)
              setTorchOn(!!(track.getSettings() as { torch?: boolean }).torch)

              void (async () => {
                try {
                  await track.applyConstraints({
                    advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
                  })
                } catch {
                  /* optional */
                }
              })()
              setZoomProbeDone(true)
            },
            () => setZoomProbeDone(true)
          )
        })
      })
      .catch((err: unknown) => {
        console.error('Camera start failed:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setCameraError(msg || 'Camera access failed. Allow camera permission and try again.')
      })

    return () => {
      stopTrackProbeRef.current?.()
      stopTrackProbeRef.current = null
      const t = videoTrackRef.current
      if (t) {
        try {
          const caps = t.getCapabilities() as VideoTrackCaps
          if (caps.torch) void t.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
        } catch {
          /* ignore */
        }
      }
      videoTrackRef.current = null
      setZoomRange(null)
      setZoomProbeDone(false)
      setTorchSupported(false)
      setTorchOn(false)
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
            For tiny barcodes: stay far enough that the lines look sharp (phones cannot focus as close as
            a macro lens), then use zoom below if available. Align narrow codes with the horizontal guide.
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
          {(zoomRange || torchSupported) && (
            <div className="barcode-scanner-controls">
              {zoomRange && (
                <label className="barcode-scanner-zoom">
                  <span className="barcode-scanner-zoom-label">Zoom</span>
                  <input
                    type="range"
                    className="barcode-scanner-zoom-slider"
                    min={zoomRange.min}
                    max={zoomRange.max}
                    step={zoomRange.step}
                    value={zoomValue}
                    onChange={(e) => void applyZoomLevel(Number(e.target.value))}
                  />
                  <div className="barcode-scanner-zoom-presets">
                    <button type="button" className="barcode-scanner-chip" onClick={() => void applyZoomLevel(zoomRange.min)}>
                      Min
                    </button>
                    <button
                      type="button"
                      className="barcode-scanner-chip"
                      onClick={() => void applyZoomLevel((zoomRange.min + zoomRange.max) / 2)}
                    >
                      Mid
                    </button>
                    <button type="button" className="barcode-scanner-chip" onClick={() => void applyZoomLevel(zoomRange.max)}>
                      Max
                    </button>
                  </div>
                </label>
              )}
              {torchSupported && (
                <button
                  type="button"
                  className={`barcode-scanner-torch ${torchOn ? 'barcode-scanner-torch-on' : ''}`}
                  onClick={() => void toggleTorch()}
                >
                  {torchOn ? 'Light on' : 'Light'}
                </button>
              )}
            </div>
          )}
          {zoomProbeDone && !zoomRange && !torchSupported && !cameraError && (
            <p className="barcode-scanner-footnote">
              No digital zoom on this device — use distance so the barcode stays sharp, then hold steady.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
