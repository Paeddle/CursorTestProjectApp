// CSV Service - single source: PO Line Report (po_line_report.csv)
import Papa from 'papaparse'
import { aggregatePoLineReportRows, stockJobLabel } from '../lib/poLineAggregate'

export interface TrackingInfo {
  id: string
  tracking_number: string
  slug: string
  tag: string
  title?: string
  order_id?: string
  po_number?: string
  destination_city?: string
  destination_state?: string
  last_updated_at?: string
  estimated_delivery?: string
  checkpoint_message?: string
  checkpoint_location?: string
  checkpoint_date?: string
  recipient_name?: string
  from_company?: string
  job_or_customer?: string
  [key: string]: any
}

export interface POItem {
  po_number: string
  item_name: string
  part_number: string
  description: string
  color: string
  quantity: string | number
  job_or_customer?: string
}

const PO_LINE_REPORT_PATH = '/po_line_report.csv'
/** Browser-only: uploaded PO Line Report CSV overrides the static `public` file until cleared. */
const PO_LINE_REPORT_STORAGE_KEY = 'po_line_report_csv_v1'

class CSVService {
  hasLocalPoLineReport(): boolean {
    if (typeof localStorage === 'undefined') return false
    try {
      const s = localStorage.getItem(PO_LINE_REPORT_STORAGE_KEY)
      return Boolean(s && s.trim())
    } catch {
      return false
    }
  }

  saveLocalPoLineReport(csv: string): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PO_LINE_REPORT_STORAGE_KEY, csv)
  }

  clearLocalPoLineReport(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(PO_LINE_REPORT_STORAGE_KEY)
  }

  private parseCsvText(csvText: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => {
          return header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '')
        },
        complete: (results) => {
          resolve(results.data || [])
        },
        error: (error: any) => {
          reject(error)
        }
      })
    })
  }

  private async loadCSVFile(path: string): Promise<any[]> {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(PO_LINE_REPORT_STORAGE_KEY)
        if (stored != null && stored.trim() !== '') {
          return this.parseCsvText(stored)
        }
      } catch {
        /* use network */
      }
    }

    const timestamp = new Date().getTime()
    const response = await fetch(`${path}?t=${timestamp}`, {
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new Error(`Failed to load CSV: ${response.statusText}`)
    }

    const csvText = await response.text()
    return this.parseCsvText(csvText)
  }

  async loadTrackings(): Promise<TrackingInfo[]> {
    try {
      const rows = await this.loadCSVFile(PO_LINE_REPORT_PATH)
      const seenPO = new Set<string>()
      const trackings: TrackingInfo[] = []

      for (const row of rows) {
        const poNumber = (row.po_number || '').toString().trim()
        if (!poNumber) continue

        const key = poNumber.toLowerCase()
        if (seenPO.has(key)) continue
        seenPO.add(key)

        trackings.push({
          id: poNumber,
          tracking_number: '',
          slug: '',
          tag: 'in_transit',
          title: `PO ${poNumber}`,
          order_id: poNumber,
          po_number: poNumber,
          job_or_customer: (row.job_or_customer || '').toString().trim(),
          destination_city: '',
          destination_state: '',
          last_updated_at: '',
          estimated_delivery: '',
          checkpoint_message: '',
          checkpoint_location: '',
          checkpoint_date: '',
          recipient_name: '',
          from_company: '',
        })
      }

      return trackings
    } catch (error: any) {
      throw new Error(`Failed to load PO line report: ${error.message}`)
    }
  }

  async loadPOItems(): Promise<Map<string, POItem[]>> {
    try {
      const rows = await this.loadCSVFile(PO_LINE_REPORT_PATH)
      const parsed = rows
        .map((row) => {
          const poNumber = (row.po_number || '').toString().trim()
          const item_name = (row.item_name || '').toString().trim()
          if (!poNumber || !item_name) return null
          return {
            po_number: poNumber,
            item_name,
            part_number: (row.part_number || '').toString().trim(),
            description: (row.description || '').toString().trim(),
            color: (row.color || '').toString().trim(),
            quantity: String(row.quantity != null && row.quantity !== '' ? row.quantity : '0'),
            job_or_customer: stockJobLabel((row.job_or_customer || '').toString()),
          }
        })
        .filter(Boolean) as import('../lib/parsePoLineReport').PoLineReportCsvRow[]

      const aggregated = aggregatePoLineReportRows(parsed)
      const itemsMap = new Map<string, POItem[]>()

      for (const row of aggregated) {
        const poNumber = row.po_number
        const item: POItem = {
          po_number: poNumber,
          item_name: row.item_name,
          part_number: row.part_number,
          description: row.description,
          color: row.color,
          quantity: row.quantity,
          job_or_customer: row.job_or_customer,
        }

        const key = poNumber.toLowerCase()
        if (!itemsMap.has(key)) {
          itemsMap.set(key, [])
        }
        itemsMap.get(key)!.push(item)
      }

      return itemsMap
    } catch (error: any) {
      console.warn('Failed to load PO line report:', error.message)
      return new Map()
    }
  }
}

export const csvService = new CSVService()
