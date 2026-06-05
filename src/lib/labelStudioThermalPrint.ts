import type { DymoPrintQuality } from './dymoPrintParams'
import {
  DEFAULT_THERMAL_IMAGE_TONE,
  type ThermalImageTone,
} from './labelStudioThermalImage'

export type { DymoPrintQuality } from './dymoPrintParams'

export const DYMO_PRINT_QUALITY_STORAGE_KEY = 'ls-print-quality'
export const THERMAL_IMAGE_TONE_STORAGE_KEY = 'ls-thermal-image-tone'

export const DYMO_PRINT_QUALITY_OPTIONS: { value: DymoPrintQuality; label: string; hint: string }[] = [
  { value: 'BarcodeAndGraphics', label: 'Graphics (best for photos)', hint: 'Slower; darker heat for images and barcodes.' },
  { value: 'Auto', label: 'Auto', hint: 'Printer picks based on label contents.' },
  { value: 'Text', label: 'Text (fast)', hint: 'Fastest; photos may look washed out.' },
]

export const DEFAULT_LABEL_STUDIO_PRINT_QUALITY: DymoPrintQuality = 'BarcodeAndGraphics'

const PRINT_QUALITIES = new Set<DymoPrintQuality>(['Auto', 'Text', 'BarcodeAndGraphics'])
const IMAGE_TONES = new Set<ThermalImageTone>(['natural', 'boost', 'highContrast', 'bw'])

export function loadLabelStudioPrintQuality(): DymoPrintQuality {
  try {
    const v = localStorage.getItem(DYMO_PRINT_QUALITY_STORAGE_KEY)
    if (v && PRINT_QUALITIES.has(v as DymoPrintQuality)) return v as DymoPrintQuality
  } catch {
    /* ignore */
  }
  return DEFAULT_LABEL_STUDIO_PRINT_QUALITY
}

export function saveLabelStudioPrintQuality(quality: DymoPrintQuality): void {
  try {
    localStorage.setItem(DYMO_PRINT_QUALITY_STORAGE_KEY, quality)
  } catch {
    /* ignore */
  }
}

export function loadThermalImageTone(): ThermalImageTone {
  try {
    const v = localStorage.getItem(THERMAL_IMAGE_TONE_STORAGE_KEY)
    if (v && IMAGE_TONES.has(v as ThermalImageTone)) return v as ThermalImageTone
  } catch {
    /* ignore */
  }
  return DEFAULT_THERMAL_IMAGE_TONE
}

export function saveThermalImageTone(tone: ThermalImageTone): void {
  try {
    localStorage.setItem(THERMAL_IMAGE_TONE_STORAGE_KEY, tone)
  } catch {
    /* ignore */
  }
}

export function dymoPrintQualityLabel(quality: DymoPrintQuality): string {
  return DYMO_PRINT_QUALITY_OPTIONS.find((o) => o.value === quality)?.label ?? quality
}
