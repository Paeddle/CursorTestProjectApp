/** Left/right roll on LabelWriter Twin Turbo (and similar dual-roll models). */
export type DymoTwinTurboRoll = 'Auto' | 'Left' | 'Right'

export const DYMO_TWIN_TURBO_ROLL_STORAGE_KEY = 'dymo-twin-turbo-roll'

export function loadDymoTwinTurboRoll(): DymoTwinTurboRoll {
  try {
    const v = localStorage.getItem(DYMO_TWIN_TURBO_ROLL_STORAGE_KEY)
    if (v === 'Left' || v === 'Right' || v === 'Auto') return v
  } catch {
    /* ignore */
  }
  return 'Auto'
}

export function saveDymoTwinTurboRoll(roll: DymoTwinTurboRoll): void {
  try {
    localStorage.setItem(DYMO_TWIN_TURBO_ROLL_STORAGE_KEY, roll)
  } catch {
    /* ignore */
  }
}

export function dymoTwinTurboRollLabel(roll: DymoTwinTurboRoll): string {
  if (roll === 'Left') return 'Left roll'
  if (roll === 'Right') return 'Right roll'
  return 'Auto (printer picks)'
}

export type DymoPrintQuality = 'Auto' | 'Text' | 'BarcodeAndGraphics'

/** DYMO Connect / Label Framework print params XML. */
export function buildLabelWriterPrintParamsXml(options?: {
  copies?: number
  twinTurboRoll?: DymoTwinTurboRoll
  printQuality?: DymoPrintQuality
}): string {
  const copies = options?.copies ?? 1
  const roll = options?.twinTurboRoll ?? loadDymoTwinTurboRoll()
  const printQuality = options?.printQuality ?? 'Text'
  return (
    '<LabelWriterPrintParams>' +
    `<Copies>${copies}</Copies>` +
    `<PrintQuality>${printQuality}</PrintQuality>` +
    `<TwinTurboRoll>${roll}</TwinTurboRoll>` +
    '</LabelWriterPrintParams>'
  )
}
