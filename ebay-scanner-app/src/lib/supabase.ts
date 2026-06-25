import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isSupabaseConfigured = Boolean(url && key)

export const supabase = (() => {
  if (!isSupabaseConfigured) return null
  try {
    return createClient(url, key)
  } catch (_) {
    return null
  }
})()

export const STORAGE_BUCKET = 'po-documents'
