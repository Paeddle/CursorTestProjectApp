import { supabase, isSupabaseConfigured } from '../../lib/supabase'

type LookupAction = 'upc_lookup' | 'upc_search' | 'serper_search' | 'serper_images' | 'page_meta'

export async function invokeProductLookup<T>(
  action: LookupAction,
  payload: Record<string, unknown>
): Promise<T | null> {
  if (!isSupabaseConfigured || !supabase) return null
  try {
    const serperApiKey = import.meta.env.VITE_SERPER_API_KEY as string | undefined
    const upcUserKey = import.meta.env.VITE_UPCITEMDB_USER_KEY as string | undefined
    const { data, error } = await supabase.functions.invoke('product-lookup', {
      body: {
        action,
        ...payload,
        serperApiKey: serperApiKey?.trim() || undefined,
        upcUserKey: upcUserKey?.trim() || undefined,
      },
    })
    if (error) {
      console.warn(`product-lookup ${action}:`, error.message)
      return null
    }
    const result = data as T & { error?: string }
    if (result?.error) {
      console.warn(`product-lookup ${action}:`, result.error)
      return null
    }
    return result as T
  } catch (e) {
    console.warn(`product-lookup ${action} failed:`, e)
    return null
  }
}

/** Safe browser fetch — returns null on CORS / network failure instead of throwing. */
export async function safeFetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function safeFetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}
