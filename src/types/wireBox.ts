export type WireBoxCheckType = 'check_in' | 'check_out'

export interface WireBoxScan {
  id: string
  box_id: string
  job_name: string
  current_footage: string
  /** Present after running add-wire-box-check-type.sql; older rows behave as check-in. */
  check_type?: WireBoxCheckType | string
  scanned_at: string
  created_at: string
  /** Preset id from wire scanner (after add-wire-box-profile-columns.sql). */
  wire_type?: string | null
  /** Display name for wire type (add-wire-box-type-label-default.sql). */
  wire_type_label?: string | null
  /** Catalog default reel length in ft for that type at scan time. */
  wire_type_default_ft?: string | null
  /** Full spool length in ft for this box (after add-wire-box-profile-columns.sql). */
  spool_capacity_ft?: string | null
}

export interface WireBoxSummary {
  box_id: string
  scans: WireBoxScan[]
}
