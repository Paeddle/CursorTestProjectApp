import { supabase } from './supabase'

export async function fetchPartsTrackerCategories(): Promise<string[]> {
  if (!supabase) return []
  const pageSize = 1000
  const found = new Set<string>()
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('dtools_products')
      .select('category')
      .order('csv_row', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    for (const row of batch) {
      const category = String((row as { category?: string | null }).category ?? '').trim()
      if (category) found.add(category)
    }
    if (batch.length < pageSize) break
  }
  return [...found]
}
