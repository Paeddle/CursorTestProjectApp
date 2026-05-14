/**
 * Load OpenCV.js from CDN (required by jscanify). Resolves when cv is ready.
 * Uses jsDelivr (CORS-friendly) to avoid "NetworkError when attempting to fetch resource"
 * when loading from deployed origins (e.g. DigitalOcean). opencv.js-webassembly is a
 * single-file build so no separate WASM fetch.
 */
function loadOpenCV(): Promise<void> {
  if (typeof (window as unknown as { cv?: unknown }).cv !== 'undefined') {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://cdn.jsdelivr.net/npm/opencv.js-webassembly@4.2.0/opencv.js'
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

// Preload OpenCV + jscanify so the first capture/detection doesn't fail.
export async function warmupDocumentScanner(): Promise<void> {
  await getScanner()
}

const PAPER_WIDTH = 800
const PAPER_HEIGHT = 1100

/** Default shrink toward quad center so the crop trims table background (CamScanner-style). */
export const DEFAULT_DOCUMENT_CROP_INSET = 0.026

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

function hypot(dx: number, dy: number): number {
  return Math.hypot(dx, dy)
}

/** Move each corner toward the quad centroid by `inset` (0–1), trimming outer background. */
export function insetCornerPoints(corners: CornerPoints, inset: number): CornerPoints {
  const k = Math.min(0.12, Math.max(0, inset))
  const pts = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]
  const cx = pts.reduce((a, p) => a + p.x, 0) / 4
  const cy = pts.reduce((a, p) => a + p.y, 0) / 4
  const s = 1 - k
  const q = (p: { x: number; y: number }) => ({
    x: cx + (p.x - cx) * s,
    y: cy + (p.y - cy) * s,
  })
  return {
    topLeftCorner: q(corners.topLeftCorner),
    topRightCorner: q(corners.topRightCorner),
    bottomLeftCorner: q(corners.bottomLeftCorner),
    bottomRightCorner: q(corners.bottomRightCorner),
  }
}

function orderQuad(pts: { x: number; y: number }[]): CornerPoints {
  if (pts.length !== 4) {
    throw new Error('orderQuad expects 4 points')
  }
  const sums = pts.map((p) => p.x + p.y)
  const diffs = pts.map((p) => p.y - p.x)
  const tl = pts[sums.indexOf(Math.min(...sums))]
  const br = pts[sums.indexOf(Math.max(...sums))]
  const tr = pts[diffs.indexOf(Math.min(...diffs))]
  const bl = pts[diffs.indexOf(Math.max(...diffs))]
  return {
    topLeftCorner: { ...tl },
    topRightCorner: { ...tr },
    bottomLeftCorner: { ...bl },
    bottomRightCorner: { ...br },
  }
}

function quadAspectReasonable(cp: CornerPoints): boolean {
  const { topLeftCorner: tl, topRightCorner: tr, bottomLeftCorner: bl, bottomRightCorner: br } = cp
  const wTop = hypot(tr.x - tl.x, tr.y - tl.y)
  const wBot = hypot(br.x - bl.x, br.y - bl.y)
  const hLeft = hypot(bl.x - tl.x, bl.y - tl.y)
  const hRight = hypot(br.x - tr.x, br.y - tr.y)
  const w = (wTop + wBot) / 2
  const h = (hLeft + hRight) / 2
  const r = w / Math.max(h, 1e-6)
  return r > 0.1 && r < 9
}

/** Polygon area (px²) for comparing candidate quads. */
export function quadPolygonArea(cp: CornerPoints): number {
  const { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl } = cp
  const pts = [tl, tr, br, bl]
  let a = 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(a / 2)
}

function pickLargestReasonableQuad(candidates: CornerPoints[], imgW: number, imgH: number): CornerPoints | null {
  const imgArea = imgW * imgH
  const minA = imgArea * 0.015
  const maxA = imgArea * 0.96
  let best: CornerPoints | null = null
  let bestArea = 0
  for (const c of candidates) {
    if (!quadAspectReasonable(c)) continue
    const a = quadPolygonArea(c)
    if (a < minA || a > maxA) continue
    if (a > bestArea) {
      bestArea = a
      best = c
    }
  }
  return best
}

function scaleCorners(cp: CornerPoints, sx: number, sy: number): CornerPoints {
  const m = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy })
  return {
    topLeftCorner: m(cp.topLeftCorner),
    topRightCorner: m(cp.topRightCorner),
    bottomLeftCorner: m(cp.bottomLeftCorner),
    bottomRightCorner: m(cp.bottomRightCorner),
  }
}

function approxToFourPoints(approx: { rows: number; data32S?: Int32Array; data32F?: Float32Array }): {
  x: number
  y: number
}[] {
  const pts: { x: number; y: number }[] = []
  const rows = approx.rows
  if (rows !== 4) return pts
  const s = approx.data32S
  const f = approx.data32F
  if (s && s.length >= 8) {
    for (let i = 0; i < 4; i++) pts.push({ x: s[i * 2], y: s[i * 2 + 1] })
  } else if (f && f.length >= 8) {
    for (let i = 0; i < 4; i++) pts.push({ x: f[i * 2], y: f[i * 2 + 1] })
  }
  return pts
}

/** Largest 4-vertex contour in `contours` (approxPolyDP), or null. */
function largestQuadFromContourVector(
  contours: any,
  cv: any,
  w: number,
  h: number,
  opts: { minAreaFrac: number; maxAreaFrac: number; epsilonFrac: number }
): CornerPoints | null {
  const imgArea = w * h
  let bestArea = 0
  let bestApprox: any | null = null
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i)
    try {
      const area = cv.contourArea(cnt, false)
      if (area < imgArea * opts.minAreaFrac || area > imgArea * opts.maxAreaFrac) continue
      const peri = cv.arcLength(cnt, true)
      const approx = new cv.Mat()
      cv.approxPolyDP(cnt, approx, opts.epsilonFrac * peri, true)
      if (approx.rows !== 4) {
        approx.delete()
        continue
      }
      if (area > bestArea) {
        if (bestApprox) bestApprox.delete()
        bestApprox = approx
        bestArea = area
      } else {
        approx.delete()
      }
    } finally {
      cnt.delete()
    }
  }
  if (!bestApprox) return null
  try {
    const raw = approxToFourPoints(bestApprox)
    if (raw.length !== 4) return null
    const ordered = orderQuad(raw)
    return quadAspectReasonable(ordered) ? ordered : null
  } finally {
    bestApprox.delete()
  }
}

/** Adaptive threshold + outer contours (tuned for paper vs desk). */
function findQuadAdaptive(work: any, cv: any): CornerPoints | null {
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const thr = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const closed = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    const ch = work.channels()
    if (ch === 4) {
      cv.cvtColor(work, gray, cv.COLOR_RGBA2GRAY, 0)
    } else if (ch === 3) {
      cv.cvtColor(work, gray, cv.COLOR_RGB2GRAY, 0)
    } else {
      work.copyTo(gray)
    }
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
    cv.adaptiveThreshold(
      blur,
      thr,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11,
      3
    )
    cv.morphologyEx(thr, closed, cv.MORPH_CLOSE, kernel)
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    return largestQuadFromContourVector(contours, cv, work.cols, work.rows, {
      minAreaFrac: 0.02,
      maxAreaFrac: 0.97,
      epsilonFrac: 0.022,
    })
  } catch {
    return null
  } finally {
    gray.delete()
    blur.delete()
    thr.delete()
    kernel.delete()
    closed.delete()
    contours.delete()
    hierarchy.delete()
  }
}

/** Otsu + CLAHE when available — strong on white paper vs darker surfaces. */
function findQuadOtsu(work: any, cv: any): CornerPoints | null {
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const eq = new cv.Mat()
  const thr = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const closed = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    const ch = work.channels()
    if (ch === 4) {
      cv.cvtColor(work, gray, cv.COLOR_RGBA2GRAY, 0)
    } else if (ch === 3) {
      cv.cvtColor(work, gray, cv.COLOR_RGB2GRAY, 0)
    } else {
      work.copyTo(gray)
    }
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
    if (typeof cv.createCLAHE === 'function') {
      const clahe = cv.createCLAHE(2.2, new cv.Size(8, 8))
      clahe.apply(blur, eq)
      clahe.delete()
    } else {
      blur.copyTo(eq)
    }
    const m = cv.mean(eq)[0]
    const t = m > 115 ? cv.THRESH_BINARY : cv.THRESH_BINARY_INV
    cv.threshold(eq, thr, 0, 255, t + cv.THRESH_OTSU)
    cv.morphologyEx(thr, closed, cv.MORPH_CLOSE, kernel)
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    return largestQuadFromContourVector(contours, cv, work.cols, work.rows, {
      minAreaFrac: 0.018,
      maxAreaFrac: 0.97,
      epsilonFrac: 0.024,
    })
  } catch {
    return null
  } finally {
    gray.delete()
    blur.delete()
    eq.delete()
    thr.delete()
    kernel.delete()
    closed.delete()
    contours.delete()
    hierarchy.delete()
  }
}

/** Edge-based quad — helps when luminosity threshold is ambiguous. */
function findQuadCanny(work: any, cv: any): CornerPoints | null {
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const edges = new cv.Mat()
  const dilated = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    const ch = work.channels()
    if (ch === 4) {
      cv.cvtColor(work, gray, cv.COLOR_RGBA2GRAY, 0)
    } else if (ch === 3) {
      cv.cvtColor(work, gray, cv.COLOR_RGB2GRAY, 0)
    } else {
      work.copyTo(gray)
    }
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(blur, edges, 35, 95, 3, false)
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 2)
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    return largestQuadFromContourVector(contours, cv, work.cols, work.rows, {
      minAreaFrac: 0.015,
      maxAreaFrac: 0.96,
      epsilonFrac: 0.03,
    })
  } catch {
    return null
  } finally {
    gray.delete()
    blur.delete()
    edges.delete()
    dilated.delete()
    kernel.delete()
    contours.delete()
    hierarchy.delete()
  }
}

/** Stable corners for a noisy contour (better than jscanify's quadrant extremes). */
function cornersFromMinAreaRect(contour: any, cv: any): CornerPoints | null {
  if (!contour || contour.rows === 0) return null
  const rect = cv.minAreaRect(contour)
  const box = new cv.Mat()
  try {
    if (typeof cv.boxPoints === 'function') {
      cv.boxPoints(rect, box)
    } else {
      return null
    }
    const f = box.data32F
    if (!f || f.length < 8) return null
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i < 4; i++) {
      pts.push({ x: f[i * 2], y: f[i * 2 + 1] })
    }
    const ordered = orderQuad(pts)
    return quadAspectReasonable(ordered) ? ordered : null
  } catch {
    return null
  } finally {
    box.delete()
  }
}

/**
 * Crop a canvas (e.g. video frame) to detected document edges. Returns blob or null.
 * `cropInset` shrinks the quad slightly toward the center so the crop omits background beyond the page.
 */
export async function cropDocumentFromCanvas(
  canvas: HTMLCanvasElement,
  cornerPoints?: CornerPoints,
  opts?: { cropInset?: number }
): Promise<Blob | null> {
  const scanner = await getScanner()
  const inset = opts?.cropInset ?? DEFAULT_DOCUMENT_CROP_INSET
  const pts = cornerPoints ? insetCornerPoints(cornerPoints, inset) : undefined
  const resultCanvas = scanner.extractPaper(canvas, PAPER_WIDTH, PAPER_HEIGHT, pts) ?? null
  if (!resultCanvas) return null
  return new Promise((resolve) => {
    resultCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
  })
}

/**
 * Detect document corner points (outer page outline) using OpenCV.
 * Returns null if no document is confidently detected.
 * @param opts.maxWorkDim — downscale long edge for speed (preview ~1280); use ~1920 on final capture frame.
 */
export async function detectCornersFromCanvas(
  canvas: HTMLCanvasElement,
  opts?: { maxWorkDim?: number }
): Promise<CornerPoints | null> {
  const scanner = await getScanner()
  const cv = (window as unknown as { cv?: any }).cv
  if (!cv) return null

  let fullMat: any | null = null
  let resized: any | null = null
  let result: CornerPoints | null = null
  try {
    fullMat = cv.imread(canvas)
    const W = fullMat.cols
    const H = fullMat.rows
    const maxDim = opts?.maxWorkDim ?? 1280
    const scale = Math.min(1, maxDim / Math.max(W, H))

    let work = fullMat
    if (scale < 1) {
      resized = new cv.Mat()
      const nw = Math.max(1, Math.round(W * scale))
      const nh = Math.max(1, Math.round(H * scale))
      cv.resize(fullMat, resized, new cv.Size(nw, nh), 0, 0, cv.INTER_AREA)
      work = resized
    }

    const cands: CornerPoints[] = []
    const a = findQuadAdaptive(work, cv)
    if (a) cands.push(a)
    const b = findQuadOtsu(work, cv)
    if (b) cands.push(b)
    const c = findQuadCanny(work, cv)
    if (c) cands.push(c)

    let quadWork = pickLargestReasonableQuad(cands, work.cols, work.rows)

    if (!quadWork) {
      const contour = scanner.findPaperContour(fullMat) as { delete?: () => void } | null
      if (contour) {
        try {
          const box = cornersFromMinAreaRect(contour, cv)
          if (box) quadWork = box
          else {
            const legacy = scanner.getCornerPoints(contour)
            quadWork = isCornerPoints(legacy) ? legacy : null
          }
        } finally {
          try {
            contour.delete?.()
          } catch (_) {}
        }
      }
    }

    if (quadWork) {
      const sx = W / work.cols
      const sy = H / work.rows
      result = scaleCorners(quadWork, sx, sy)
    }
  } catch (_) {
    result = null
  } finally {
    try {
      resized?.delete?.()
    } catch (_) {}
    try {
      fullMat?.delete?.()
    } catch (_) {}
  }
  return result
}

/**
 * Crop image to detected document (paper) edges. Returns blob of cropped image or null if no document detected.
 */
export async function cropDocumentToBlob(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null

  const scanner = await getScanner()
  const img = await createImageFromFile(file)
  if (!img) return null

  const canvasEl = document.createElement('canvas')
  canvasEl.width = img.naturalWidth || img.width
  canvasEl.height = img.naturalHeight || img.height
  const ctx = canvasEl.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)

  const corners = await detectCornersFromCanvas(canvasEl)
  if (corners) {
    const blob = await cropDocumentFromCanvas(canvasEl, corners, { cropInset: DEFAULT_DOCUMENT_CROP_INSET })
    return blob
  }

  const out = scanner.extractPaper(img, PAPER_WIDTH, PAPER_HEIGHT) ?? null
  if (!out) return null
  return new Promise((resolve) => {
    out.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
  })
}

function createImageFromFile(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}
