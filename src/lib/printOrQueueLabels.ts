import type { PoLabelPrintRow } from '../types/poIpoint'
import {
  initDymoFramework,
  isDymoAvailable,
  loadDymoSdk,
  printLabelsWithDymo,
  getDymoPrinterNames,
} from './dymoLabelPrint'
import { isSupabaseConfigured, queueLabelsForPrint } from './labelPrintQueue'

export type PrintOrQueueResult = {
  method: 'dymo' | 'queue' | 'browser'
  printed?: number
  queued?: number
  batchId?: string
  message: string
}

export async function canPrintLocallyWithDymo(): Promise<boolean> {
  await loadDymoSdk()
  await initDymoFramework()
  if (!isDymoAvailable()) return false
  return getDymoPrinterNames().length > 0
}

/**
 * Print on this device when DYMO Connect is available; otherwise queue for the Print Station.
 */
export async function printOrQueueLabels(rows: PoLabelPrintRow[]): Promise<PrintOrQueueResult> {
  if (rows.length === 0) {
    return { method: 'browser', message: 'No labels selected.' }
  }

  const localDymo = await canPrintLocallyWithDymo()
  if (localDymo) {
    const result = await printLabelsWithDymo(rows)
    return {
      method: 'dymo',
      printed: result.printed,
      message: `Printed ${result.printed} label${result.printed !== 1 ? 's' : ''} on this computer.`,
    }
  }

  if (isSupabaseConfigured()) {
    const { batchId, queued } = await queueLabelsForPrint(rows)
    return {
      method: 'queue',
      queued,
      batchId,
      message: `Queued ${queued} label${queued !== 1 ? 's' : ''}. On the laptop with the DYMO printer, open Print Station in this app and leave it open.`,
    }
  }

  const result = await printLabelsWithDymo(rows)
  return {
    method: result.method,
    printed: result.printed,
    message:
      result.method === 'dymo'
        ? `Printed ${result.printed} label${result.printed !== 1 ? 's' : ''}.`
        : `Opened browser print dialog for ${result.printed} label${result.printed !== 1 ? 's' : ''}. Install DYMO Connect or configure Supabase to use the print queue.`,
  }
}
