export type PartFields = {
  manufacturer: string
  vendor: string
  upc_code: string
  part_name: string
  ipn: string
  description: string
  po: string
  link: string
}

export type TrackedPart = PartFields & {
  id: string
  created_at: string
  updated_at: string
}

export type CheckInDocument = {
  name: string
  url: string
}

export type PartCheckIn = PartFields & {
  id: string
  part_id: string | null
  check_in_date: string
  scanned_at: string
  created_at: string
  quantity?: number | null
  documents?: CheckInDocument[] | null
}

export const EMPTY_PART_FIELDS: PartFields = {
  manufacturer: '',
  vendor: '',
  upc_code: '',
  part_name: '',
  ipn: '',
  description: '',
  po: '',
  link: '',
}

export const PART_FIELD_LABELS: { key: keyof PartFields; label: string }[] = [
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'upc_code', label: 'UPC code' },
  { key: 'part_name', label: 'Part name' },
  { key: 'ipn', label: 'IPN' },
  { key: 'description', label: 'Notes' },
  { key: 'po', label: 'PO' },
  { key: 'link', label: 'Link' },
]

export const CATALOG_FIELD_LABELS = PART_FIELD_LABELS.filter(({ key }) => key !== 'po').map((field) =>
  field.key === 'description' ? { ...field, label: 'Description' } : field,
)
