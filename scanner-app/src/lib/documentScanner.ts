/**
 * Load OpenCV.js from CDN (required by jscanify). Resolves when cv is ready.
 */
function loadOpenCV(): Promise<void> {
  if (typeof (window as unknown as { cv?: unknown }).cv !== 'undefined') {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://docs.opencv.org/4.7.0/opencv.js'
    script.onload = () => {
      let attempts = 0
      const maxAttempts = 300
      const check = () => {
        const cv = (window as unknown as { cv?: unknown }).cv
        if (typeof cv !== 'undefined' && cv !== null) {
          resolve()
          return
        }
        attempts++
        if (attempts >= maxAttempts) {
          reject(new Error('OpenCV failed to initialize'))
          return
        }
        setTimeout(check, 100)
      }
      check()
    }
    script.onerror = () => reject(new Error('Failed to load OpenCV'))
    document.head.appendChild(script)
  })
}

type JScanifyClass = new () => {
  findPaperContour: (image: unknown) => unknown
  getCornerPoints: (contour: unknown) => unknown
  extractPaper: (
    image: HTMLImageElement | HTMLCanvasElement,
    resultWidth: number,
    resultHeight: number,
    cornerPoints?: unknown
  ) => HTMLCanvasElement | null
}

let jscanifyClass: JScanifyClass | null = null

async function getScanner(): Promise<InstanceType<JScanifyClass>> {
  await loadOpenCV()
  if (!jscanifyClass) {
    const mod = await import('jscanify/client')
    jscanifyClass = mod.default as JScanifyClass
  }
  return new jscanifyClass()
}

const PAPER_WIDTH = 800
const PAPER_HEIGHT = 1100

export type CornerPoints = {
  topLeftCorner: { x: number; y: number }
  topRightCorner: { x: number; y: number }
  bottomLeftCorner: { x: number; y: number }
  bottomRightCorner: { x: number; y: number }
}

function isCornerPoints(v: unknown): v is CornerPoints {
  const o = v as CornerPoints
  return Boolean(
    o &&
      o.topLeftCorner &&
      o.topRightCorner &&
      o.bottomLeftCorner &&
      o.bottomRightCorner &&
      typeof o.topLeftCorner.x === 'number' &&
      typeof o.topLeftCorner.y === 'number'
  )
}

/**
 * Crop a canvas (e.g. video frame) to detected document edges. Returns blob or null.
 */
export async function cropDocumentFromCanvas(
  canvas: HTMLCanvasElement,
  cornerPoints?: CornerPoints
): Promise<Blob | null> {
  const scanner = await getScanner()
  const resultCanvas = scanner.extractPaper(canvas, PAPER_WIDTH, PAPER_HEIGHT, cornerPoints) ?? null
  if (!resultCanvas) return null
  return new Promise((resolve) => {
    resultCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
  })
}

/**
 * Detect document corner points from a canvas using OpenCV (via jscanify).
 * Returns null if no document is confidently detected.
 */
export async function detectCornersFromCanvas(canvas: HTMLCanvasElement): Promise<CornerPoints | null> {
  const scanner = await getScanner()
  const cv = (window as unknown as { cv?: any }).cv
  if (!cv) return null

  let mat: any | null = null
  let contour: any | null = null
  try {
    mat = cv.imread(canvas)
    contour = scanner.findPaperContour(mat)
    const corners = scanner.getCornerPoints(contour)
    if (!isCornerPoints(corners)) return null
    return corners
  } catch (_) {
    return null
  } finally {
    try {
      contour?.delete?.()
    } catch (_) {}
    try {
      mat?.delete?.()
    } catch (_) {}
  }
}

/**
 * Crop image to detected document (paper) edges. Returns blob of cropped image or null if no document detected.
 */
export async function cropDocumentToBlob(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null

  const scanner = await getScanner()
  const img = await createImageFromFile(file)
  if (!img) return null

  const canvas = scanner.extractPaper(img, PAPER_WIDTH, PAPER_HEIGHT) ?? null
  if (!canvas) return null

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob)
      },
      'image/jpeg',
      0.92
    )
  })
}

function createImageFromFile(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}
