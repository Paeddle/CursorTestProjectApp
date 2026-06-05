/** How product images are tuned before embedding in DYMO print XML. */
export type ThermalImageTone = 'natural' | 'boost' | 'highContrast' | 'bw'

export type ThermalImageProcessOptions = {
  tone: ThermalImageTone
}

export const THERMAL_IMAGE_TONE_OPTIONS: { value: ThermalImageTone; label: string; hint: string }[] = [
  { value: 'natural', label: 'Original', hint: 'No adjustment — matches the source photo.' },
  { value: 'boost', label: 'Thermal boost', hint: 'Darker, sharper — good default for product photos on heat labels.' },
  { value: 'highContrast', label: 'High contrast', hint: 'Strong punch; best when the photo is still hard to read.' },
  { value: 'bw', label: 'Black & white', hint: 'Pure black/white — clearest on thermal paper, less photo detail.' },
]

export const DEFAULT_THERMAL_IMAGE_TONE: ThermalImageTone = 'boost'

type TonePreset = {
  contrast: number
  brightness: number
  gamma: number
  threshold: number | null
  sharpen: boolean
}

const TONE_PRESETS: Record<ThermalImageTone, TonePreset> = {
  natural: { contrast: 1, brightness: 0, gamma: 1, threshold: null, sharpen: false },
  boost: { contrast: 1.4, brightness: -14, gamma: 0.88, threshold: null, sharpen: true },
  highContrast: { contrast: 1.9, brightness: -22, gamma: 0.82, threshold: null, sharpen: true },
  bw: { contrast: 1.6, brightness: -12, gamma: 0.85, threshold: 150, sharpen: false },
}

export function thermalToneNeedsProcessing(tone: ThermalImageTone): boolean {
  return tone !== 'natural'
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function applyGamma(gray: number, gamma: number): number {
  const n = gray / 255
  return clamp255(255 * Math.pow(n, gamma))
}

function applySharpen(data: Uint8ClampedArray, width: number, height: number): void {
  const source = new Uint8ClampedArray(data)
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0
      let ki = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4
          sum += source[idx] * kernel[ki++]
        }
      }
      const out = (y * width + x) * 4
      const v = clamp255(sum)
      data[out] = v
      data[out + 1] = v
      data[out + 2] = v
    }
  }
}

/** In-place thermal tuning on canvas ImageData (grayscale, contrast, optional B&W). */
export function processThermalImageData(imageData: ImageData, tone: ThermalImageTone): void {
  if (tone === 'natural') return
  const preset = TONE_PRESETS[tone]
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let g = luminance(data[i], data[i + 1], data[i + 2])
    g = applyGamma(g, preset.gamma)
    g = (g - 128) * preset.contrast + 128 + preset.brightness
    gray[p] = Math.max(0, Math.min(255, g))
  }

  for (let p = 0; p < gray.length; p++) {
    let v = gray[p]
    if (preset.threshold != null) {
      v = v >= preset.threshold ? 255 : 0
    }
    const i = p * 4
    const out = clamp255(v)
    data[i] = out
    data[i + 1] = out
    data[i + 2] = out
  }

  if (preset.sharpen) applySharpen(data, width, height)
}
