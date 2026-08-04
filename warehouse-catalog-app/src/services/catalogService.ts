import { supabase } from '../lib/supabase'
import type {
  FieldSuggestions,
  FormFieldKey,
  WarehouseCatalogForm,
  WarehouseCatalogItem,
} from '../types'
import { FORM_FIELD_KEYS, emptySuggestions } from '../types'

function normalizeBarcode(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const digits = trimmed.replace(/\D/g, '')
  return digits || trimmed
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function rowFromForm(form: WarehouseCatalogForm) {
  return {
    part_number: optionalText(form.part_number),
    name: optionalText(form.name),
    upc_code: optionalText(normalizeBarcode(form.upc_code)),
    alt_upc_code: optionalText(normalizeBarcode(form.alt_upc_code)),
    vendor: optionalText(form.vendor),
    manufacturer: optionalText(form.manufacturer),
    category: optionalText(form.category),
    maximum_stock: optionalNumber(form.maximum_stock),
    notes: optionalText(form.notes),
  }
}

export function hasMinimumData(form: WarehouseCatalogForm): boolean {
  return Boolean(
    form.part_number.trim() ||
      form.name.trim() ||
      form.upc_code.trim() ||
      form.alt_upc_code.trim()
  )
}

export async function insertCatalogItem(form: WarehouseCatalogForm): Promise<WarehouseCatalogItem> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!hasMinimumData(form)) {
    throw new Error('Enter at least a part number, name, or barcode.')
  }

  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .insert(rowFromForm(form))
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as WarehouseCatalogItem
}

export async function updateCatalogItem(
  id: string,
  form: WarehouseCatalogForm
): Promise<WarehouseCatalogItem> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!hasMinimumData(form)) {
    throw new Error('Enter at least a part number, name, or barcode.')
  }

  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .update(rowFromForm(form))
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as WarehouseCatalogItem
}

export async function fetchRecentItems(limit = 50): Promise<WarehouseCatalogItem[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as WarehouseCatalogItem[]
}

export async function findItemByBarcode(barcode: string): Promise<WarehouseCatalogItem | null> {
  if (!supabase) return null
  const normalized = normalizeBarcode(barcode)
  if (!normalized) return null

  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .select('*')
    .or(`upc_code.eq.${normalized},alt_upc_code.eq.${normalized}`)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as WarehouseCatalogItem | null) ?? null
}

export async function findItemByPartNumber(partNumber: string): Promise<WarehouseCatalogItem | null> {
  if (!supabase) return null
  const trimmed = partNumber.trim()
  if (!trimmed) return null

  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .select('*')
    .ilike('part_number', trimmed)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as WarehouseCatalogItem | null) ?? null
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  for (const v of values) {
    const trimmed = (v ?? '').trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export async function fetchFieldSuggestions(): Promise<FieldSuggestions> {
  if (!supabase) return emptySuggestions()

  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .select(
      'part_number, name, upc_code, alt_upc_code, vendor, manufacturer, category, maximum_stock, notes'
    )
    .order('updated_at', { ascending: false })
    .limit(5000)

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Pick<WarehouseCatalogItem, FormFieldKey>[]

  const out = emptySuggestions()
  for (const key of FORM_FIELD_KEYS) {
    if (key === 'maximum_stock') {
      out.maximum_stock = uniqueSorted(
        rows.map((r) =>
          r.maximum_stock != null && !Number.isNaN(r.maximum_stock) ? String(r.maximum_stock) : null
        )
      )
    } else {
      out[key] = uniqueSorted(rows.map((r) => r[key]))
    }
  }
  return out
}

function sanitizeSearchTerm(query: string): string {
  return query.trim().replace(/[,()]/g, ' ')
}

export async function searchItems(query: string, limit = 40): Promise<WarehouseCatalogItem[]> {
  if (!supabase) return []
  const q = sanitizeSearchTerm(query)
  if (!q) return fetchRecentItems(limit)

  const pattern = `%${q}%`
  const { data, error } = await supabase
    .from('warehouse_catalog_items')
    .select('*')
    .or(
      [
        `part_number.ilike.${pattern}`,
        `name.ilike.${pattern}`,
        `upc_code.ilike.${pattern}`,
        `alt_upc_code.ilike.${pattern}`,
        `vendor.ilike.${pattern}`,
        `manufacturer.ilike.${pattern}`,
        `category.ilike.${pattern}`,
      ].join(',')
    )
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as WarehouseCatalogItem[]
}
