export interface WireBoxScan {
  id: string
  box_id: string
  job_name: string
  current_footage: string
  scanned_at: string
  created_at: string
}

export interface WireBoxSummary {
  box_id: string
  scans: WireBoxScan[]
}
