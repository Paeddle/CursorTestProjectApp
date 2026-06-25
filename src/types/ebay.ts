import type { ItemRecord } from './items'

export type EbayScanRow = {
  id: string
  barcode_value: string
  item_id: string | null
  scanned_at: string
  created_at: string
}

export type EbayScanGroup = {
  barcode_value: string
  scan_count: number
  first_scanned_at: string
  last_scanned_at: string
  item_id: string | null
  item: ItemRecord | null
  scan_ids: string[]
}
