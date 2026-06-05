export type ElementRect = {
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const GRID_STEP_OPTIONS_PCT = [2, 5, 10] as const
export const DEFAULT_GRID_STEP_PCT = 5

const MIN_W = 5
const MIN_H = 5
const PAD = 0

export function snapValueToGrid(value: number, stepPct: number): number {
  if (stepPct <= 0) return value
  return Math.round(value / stepPct) * stepPct
}

export function snapRectToGrid(rect: ElementRect, stepPct: number): ElementRect {
  if (stepPct <= 0) return rect
  return clampRect({
    xPct: snapValueToGrid(rect.xPct, stepPct),
    yPct: snapValueToGrid(rect.yPct, stepPct),
    widthPct: Math.max(MIN_W, snapValueToGrid(rect.widthPct, stepPct)),
    heightPct: Math.max(MIN_H, snapValueToGrid(rect.heightPct, stepPct)),
  })
}

function clampRect(r: ElementRect): ElementRect {
  let { xPct, yPct, widthPct, heightPct } = r
  widthPct = Math.max(MIN_W, Math.min(100 - PAD * 2, widthPct))
  heightPct = Math.max(MIN_H, Math.min(100 - PAD * 2, heightPct))
  xPct = Math.max(PAD, Math.min(100 - PAD - widthPct, xPct))
  yPct = Math.max(PAD, Math.min(100 - PAD - heightPct, yPct))
  return { xPct, yPct, widthPct, heightPct }
}

export function applyMove(orig: ElementRect, dxPct: number, dyPct: number): ElementRect {
  return clampRect({
    ...orig,
    xPct: orig.xPct + dxPct,
    yPct: orig.yPct + dyPct,
  })
}

/** Resize by dragging a handle; dx/dy are delta % of canvas size. */
export function applyResize(
  orig: ElementRect,
  handle: ResizeHandle,
  dxPct: number,
  dyPct: number,
  lockAspect = false
): ElementRect {
  let { xPct, yPct, widthPct, heightPct } = orig
  const aspect = widthPct / Math.max(heightPct, 0.01)

  if (handle.includes('e')) widthPct += dxPct
  if (handle.includes('w')) {
    xPct += dxPct
    widthPct -= dxPct
  }
  if (handle.includes('s')) heightPct += dyPct
  if (handle.includes('n')) {
    yPct += dyPct
    heightPct -= dyPct
  }

  if (lockAspect && handle.length === 2) {
    const dw = Math.abs(dxPct) >= Math.abs(dyPct) ? dxPct : dyPct * aspect
    const dh = dw / aspect
    if (handle === 'se') {
      widthPct = orig.widthPct + dw
      heightPct = orig.heightPct + dh
    } else if (handle === 'nw') {
      xPct = orig.xPct + dw
      yPct = orig.yPct + dh
      widthPct = orig.widthPct - dw
      heightPct = orig.heightPct - dh
    } else if (handle === 'ne') {
      yPct = orig.yPct + dh
      widthPct = orig.widthPct + dw
      heightPct = orig.heightPct - dh
    } else if (handle === 'sw') {
      xPct = orig.xPct + dw
      widthPct = orig.widthPct - dw
      heightPct = orig.heightPct + dh
    }
  }

  return clampRect({ xPct, yPct, widthPct, heightPct })
}

export function alignElement(
  rect: ElementRect,
  align: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom'
): ElementRect {
  const margin = 2
  switch (align) {
    case 'left':
      return clampRect({ ...rect, xPct: margin })
    case 'centerH':
      return clampRect({ ...rect, xPct: (100 - rect.widthPct) / 2 })
    case 'right':
      return clampRect({ ...rect, xPct: 100 - margin - rect.widthPct })
    case 'top':
      return clampRect({ ...rect, yPct: margin })
    case 'centerV':
      return clampRect({ ...rect, yPct: (100 - rect.heightPct) / 2 })
    case 'bottom':
      return clampRect({ ...rect, yPct: 100 - margin - rect.heightPct })
    default:
      return rect
  }
}

export type AlignToReferenceMode =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'centerV'
  | 'bottom'
  | 'matchWidth'
  | 'matchHeight'

/** Align the selected field to another field on the label. */
export function alignElementToReference(
  rect: ElementRect,
  ref: ElementRect,
  mode: AlignToReferenceMode
): ElementRect {
  switch (mode) {
    case 'left':
      return clampRect({ ...rect, xPct: ref.xPct })
    case 'right':
      return clampRect({ ...rect, xPct: ref.xPct + ref.widthPct - rect.widthPct })
    case 'centerH':
      return clampRect({ ...rect, xPct: ref.xPct + (ref.widthPct - rect.widthPct) / 2 })
    case 'top':
      return clampRect({ ...rect, yPct: ref.yPct })
    case 'bottom':
      return clampRect({ ...rect, yPct: ref.yPct + ref.heightPct - rect.heightPct })
    case 'centerV':
      return clampRect({ ...rect, yPct: ref.yPct + (ref.heightPct - rect.heightPct) / 2 })
    case 'matchWidth':
      return clampRect({ ...rect, widthPct: ref.widthPct })
    case 'matchHeight':
      return clampRect({ ...rect, heightPct: ref.heightPct })
    default:
      return rect
  }
}

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
