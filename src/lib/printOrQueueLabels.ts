import type { PoLabelPrintRow } from '../types/poIpoint'
import {
  initDymoFramework,
  isDymoAvailable,
  isRemoteAppOrigin,
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
 * Tablet / deployed app → always queue for Print Station.
 * Localhost → print with DYMO when available, otherwise queue (or browser fallback).
 */
export async function printOrQueueLabels(rows: PoLabelPrintRow[]): Promise<PrintOrQueueResult> {
  if (rows.length === 0) {
    return { method: 'browser', message: 'No labels selected.' }
  }

  if (isRemoteAppOrigin()) {
    if (!isSupabaseConfigured()) {
      throw new Error(
        'This site cannot reach a local DYMO printer. Configure Supabase so labels can be queued for Print Station on your laptop.'
      )
    }
    const { batchId, queued } = await queueLabelsForPrint(rows)
    return {
      method: 'queue',
      queued,
      batchId,
      message: `Queued ${queued} label${queued !== 1 ? 's' : ''} for Print Station. On the laptop with the printer, open Print Station and leave it open.`,
    }
  }

  const localDymo = await canPrintLocallyWithDymo()
  if (localDymo) {
    try {
      const result = await printLabelsWithDymo(rows)
      return {
        method: 'dymo',
        printed: result.printed,
        message: `Printed ${result.printed} label${result.printed !== 1 ? 's' : ''} on this computer.`,
      }
    } catch (err) {
      if (isSupabaseConfigured()) {
        const { batchId, queued } = await queueLabelsForPrint(rows)
        const detail = err instanceof Error ? err.message : 'DYMO print failed'
        return {
          method: 'queue',
          queued,
          batchId,
          message: `DYMO could not print (${detail}). Queued ${queued} label${queued !== 1 ? 's' : ''} for Print Station instead.`,
        }
      }
      throw err
    }
  }

  if (isSupabaseConfigured()) {
    const { batchId, queued } = await queueLabelsForPrint(rows)
    return {
      method: 'queue',
      queued,
      batchId,
      message: `Queued ${queued} label${queued !== 1 ? 's' : ''}. Open Print Station on the laptop with DYMO Connect.`,
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
