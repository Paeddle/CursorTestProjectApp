import { supabase } from '../lib/supabase'
import type { WireReportRow } from '../wireReport'

export type SavedMaterialsReport = {
  id: string
  job_name: string
  count_empty_boxes: boolean
  rows: WireReportRow[]
  created_at: string
}

function parseRows(raw: unknown): WireReportRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r) => {
    const row = r as Partial<WireReportRow>
    return {
      wireType: String(row.wireType ?? ''),
      startFt: row.startFt == null ? null : Number(row.startFt),
      endFt: row.endFt == null ? null : Number(row.endFt),
      usedFt: row.usedFt == null ? null : Number(row.usedFt),
      notes: String(row.notes ?? ''),
    }
  })
}

export async function fetchSavedMaterialsReports(): Promise<SavedMaterialsReport[]> {
  const { data, error } = await supabase
    .from('wire_materials_reports')
    .select('id, job_name, count_empty_boxes, rows, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    job_name: String(r.job_name ?? ''),
    count_empty_boxes: Boolean(r.count_empty_boxes),
    rows: parseRows(r.rows),
    created_at: String(r.created_at ?? ''),
  }))
}

export async function saveMaterialsReport(input: {
  jobName: string
  countEmptyBoxes: boolean
  rows: WireReportRow[]
}): Promise<SavedMaterialsReport> {
  const { data, error } = await supabase
    .from('wire_materials_reports')
    .insert({
      job_name: input.jobName.trim(),
      count_empty_boxes: input.countEmptyBoxes,
      rows: input.rows,
    })
    .select('id, job_name, count_empty_boxes, rows, created_at')
    .single()
  if (error) {
    if (/wire_materials_reports|schema cache|does not exist/i.test(error.message)) {
      throw new Error(
        `${error.message} Run supabase/add-wire-materials-reports.sql in the Supabase SQL Editor.`,
      )
    }
    throw new Error(error.message)
  }
  return {
    id: String(data.id),
    job_name: String(data.job_name ?? ''),
    count_empty_boxes: Boolean(data.count_empty_boxes),
    rows: parseRows(data.rows),
    created_at: String(data.created_at ?? ''),
  }
}

export async function deleteMaterialsReport(id: string): Promise<void> {
  const { error } = await supabase.from('wire_materials_reports').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
