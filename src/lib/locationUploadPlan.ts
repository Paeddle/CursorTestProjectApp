import { refNumberFromFilename } from './parseItemLocationsXlsx'
import { normalizeRefNumber } from './poIpointMatch'

export type LocationFileUploadStatus =
  | 'upload'
  | 'skip-existing'
  | 'skip-duplicate'
  | 'invalid'

export type LocationFileUploadPlan = {
  file: File
  ref: string
  status: LocationFileUploadStatus
  reason: string
}

/** Ref numbers that already have location data in Supabase. */
export function uploadedLocationRefs(summaries: { ref_number: string }[]): Set<string> {
  const set = new Set<string>()
  for (const s of summaries) {
    const ref = normalizeRefNumber(s.ref_number)
    if (ref) set.add(ref)
  }
  return set
}

/**
 * Plan a multi-file location upload: skip refs already in Supabase and duplicate refs in the batch.
 */
export function planLocationFileUploads(
  files: File[],
  alreadyUploaded: Set<string>
): LocationFileUploadPlan[] {
  const seenInBatch = new Set<string>()
  const plans: LocationFileUploadPlan[] = []

  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )

  for (const file of sorted) {
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      plans.push({
        file,
        ref: '',
        status: 'invalid',
        reason: 'Not an Excel file (.xlsx or .xls)',
      })
      continue
    }

    const refRaw = refNumberFromFilename(file.name)
    if (!refRaw) {
      plans.push({
        file,
        ref: '',
        status: 'invalid',
        reason: 'Filename must include a ref number (e.g. 4152.xlsx)',
      })
      continue
    }

    const ref = normalizeRefNumber(refRaw)
    if (alreadyUploaded.has(ref)) {
      plans.push({
        file,
        ref,
        status: 'skip-existing',
        reason: `Ref ${ref} is already uploaded`,
      })
      continue
    }

    if (seenInBatch.has(ref)) {
      plans.push({
        file,
        ref,
        status: 'skip-duplicate',
        reason: `Duplicate ref ${ref} in this selection`,
      })
      continue
    }

    seenInBatch.add(ref)
    plans.push({ file, ref, status: 'upload', reason: '' })
  }

  return plans
}

export function summarizeLocationUploadPlans(plans: LocationFileUploadPlan[]): {
  toUpload: LocationFileUploadPlan[]
  skipped: LocationFileUploadPlan[]
  invalid: LocationFileUploadPlan[]
} {
  return {
    toUpload: plans.filter((p) => p.status === 'upload'),
    skipped: plans.filter((p) => p.status === 'skip-existing' || p.status === 'skip-duplicate'),
    invalid: plans.filter((p) => p.status === 'invalid'),
  }
}
