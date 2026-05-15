import * as XLSX from 'xlsx'

export type ParsedJobRefRow = {
  job_name: string
  ref_number: string
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function normalizeRef(v: unknown): string {
  const s = cellStr(v)
  if (!s) return ''
  const n = Number.parseFloat(s)
  if (Number.isFinite(n) && Number.isInteger(n)) return String(Math.trunc(n))
  return s.replace(/\D/g, '').slice(0, 8) || s
}

/** Parse JobRef.xlsx (Job Name | Ref Number). */
export function parseJobRefXlsx(buf: ArrayBuffer): ParsedJobRefRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedJobRefRow[] = []

  for (const row of rows) {
    const keys = Object.keys(row)
    let jobName = ''
    let ref = ''
    for (const k of keys) {
      const nk = k.trim().toLowerCase().replace(/\s+/g, '_')
      const val = cellStr(row[k])
      if (!val) continue
      if (nk.includes('job') && nk.includes('name')) jobName = val
      else if (nk === 'job_name' || nk === 'jobname') jobName = val
      else if (nk.includes('ref')) ref = normalizeRef(row[k])
    }
    if (!jobName && keys.length >= 2) {
      jobName = cellStr(row[keys[0]!])
      ref = normalizeRef(row[keys[1]!])
    }
    if (!jobName || !ref) continue
    out.push({ job_name: jobName, ref_number: ref })
  }
  return out
}
