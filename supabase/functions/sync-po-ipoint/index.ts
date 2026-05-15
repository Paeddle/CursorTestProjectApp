/**
 * Sync iPoint exports from a OneDrive folder into po_job_refs, po_line_items, po_item_locations.
 * Invoked from PO Info (Supabase client) — no manual file upload required.
 *
 * Place files in ONEDRIVE_PO_IPOINT_FOLDER (default POInfo):
 *   JobRef.xlsx
 *   POLineReport.pdf | POLineReport.xlsx | POLineReport.csv
 *   4152.xlsx, 4973.xlsx, … (numeric ref = item locations)
 *
 * See supabase/ONEDRIVE_PO_IPOINT_SETUP.txt
 */
import { downloadOneDriveFile, listOneDriveFolderChildren } from '../_shared/graphDrive.ts'
import {
  getSupabaseAdmin,
  importItemLocationsDb,
  importJobRefsDb,
  importPoLineReportDb,
} from '../_shared/poIpointDbImport.ts'
import {
  parseItemLocationsXlsx,
  parseJobRefXlsx,
  parsePoLineReportPdf,
  parsePoLineReportText,
  parsePoLineReportXlsx,
  refNumberFromFilename,
} from '../_shared/poIpointParsers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SyncResult = {
  ok: true
  folder: string
  jobRefs: number
  poLines: number
  locations: number
  files: string[]
  skipped: string[]
}

function poIpointFolder(): string {
  return (Deno.env.get('ONEDRIVE_PO_IPOINT_FOLDER') || 'POInfo').trim().replace(/^\/+|\/+$/g, '')
}

function isTempOfficeFile(name: string): boolean {
  return name.startsWith('~$')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    if (body.action && body.action !== 'sync') {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const folder = poIpointFolder()
    const children = await listOneDriveFolderChildren(folder)
    const files = children
      .map((c) => c.name)
      .filter((n) => n && !isTempOfficeFile(n))

    const supabase = getSupabaseAdmin()
    const processed: string[] = []
    const skipped: string[] = []
    let jobRefs = 0
    let poLines = 0
    let locations = 0

    const jobRefFile = files.find((n) => /^jobref\.xlsx?$/i.test(n))
    if (jobRefFile) {
      const buf = await downloadOneDriveFile(folder, jobRefFile)
      const rows = parseJobRefXlsx(buf)
      jobRefs = await importJobRefsDb(supabase, rows)
      processed.push(jobRefFile)
    } else {
      skipped.push('JobRef.xlsx not found')
    }

    const poLineFile = files.find((n) => /^polinereport\.(pdf|xlsx?|csv)$/i.test(n))
    if (poLineFile) {
      const buf = await downloadOneDriveFile(folder, poLineFile)
      const lower = poLineFile.toLowerCase()
      let rows
      if (lower.endsWith('.pdf')) {
        rows = await parsePoLineReportPdf(buf)
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        rows = parsePoLineReportXlsx(buf)
      } else {
        rows = parsePoLineReportText(new TextDecoder().decode(buf))
      }
      if (rows.length === 0) throw new Error(`No PO lines parsed from ${poLineFile}`)
      poLines = await importPoLineReportDb(supabase, rows, poLineFile)
      processed.push(poLineFile)
    } else {
      skipped.push('POLineReport (.pdf/.xlsx/.csv) not found')
    }

    const locationFiles = files.filter((n) => /^\d{3,6}\.xlsx?$/i.test(n))
    for (const name of locationFiles) {
      const ref = refNumberFromFilename(name)
      if (!ref) continue
      const buf = await downloadOneDriveFile(folder, name)
      const rows = parseItemLocationsXlsx(buf)
      if (rows.length === 0) {
        skipped.push(`${name}: no location rows`)
        continue
      }
      locations += await importItemLocationsDb(supabase, ref, rows, name)
      processed.push(name)
    }

    if (locationFiles.length === 0) {
      skipped.push('No numeric ref location files (e.g. 4152.xlsx)')
    }

    const result: SyncResult = {
      ok: true,
      folder,
      jobRefs,
      poLines,
      locations,
      files: processed,
      skipped,
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('sync-po-ipoint failed:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
