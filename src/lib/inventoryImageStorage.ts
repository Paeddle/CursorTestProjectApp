import { supabase } from './supabase'
import type { InventoryRecord } from '../types/inventory'

export const INVENTORY_IMAGES_BUCKET = 'inventory-images'

export function formatExternalUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Public URL used in the app and on labels — prefers stored copy in Supabase. */
export function getInventoryPicturePublicUrl(row: {
  picture_path?: string | null
  picture_url?: string | null
}): string | null {
  const path = row.picture_path?.trim()
  if (path && supabase) {
    return supabase.storage.from(INVENTORY_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
  }
  const external = row.picture_url?.trim()
  return external ? formatExternalUrl(external) : null
}

function extFromFile(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  if (file.type.includes('png')) return 'png'
  if (file.type.includes('webp')) return 'webp'
  if (file.type.includes('gif')) return 'gif'
  return 'jpg'
}

export async function uploadInventoryPictureFile(
  inventoryId: string,
  file: File
): Promise<{ picture_path: string; publicUrl: string }> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPEG, WebP, etc.).')

  const path = `${inventoryId}/picture.${extFromFile(file)}`
  const { error: uploadError } = await supabase.storage.from(INVENTORY_IMAGES_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
    cacheControl: '31536000',
  })
  if (uploadError) throw new Error(uploadError.message)

  const publicUrl = supabase.storage.from(INVENTORY_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
  return { picture_path: path, publicUrl }
}

export async function importInventoryPictureFromUrl(
  inventoryId: string,
  sourceUrl: string
): Promise<InventoryRecord> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const url = formatExternalUrl(sourceUrl)
  if (!url) throw new Error('Enter a valid image URL.')

  const { data, error } = await supabase.functions.invoke('inventory-image-import', {
    body: { inventoryId, sourceUrl: url },
  })
  if (error) throw new Error(error.message)
  const payload = data as { error?: string; row?: InventoryRecord }
  if (payload?.error) throw new Error(payload.error)
  if (!payload?.row) throw new Error('Import did not return an updated row.')
  return payload.row
}

export async function removeInventoryStoredPicture(inventoryId: string, picturePath: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.storage.from(INVENTORY_IMAGES_BUCKET).remove([picturePath])
  if (error) throw new Error(error.message)
  await supabase.from('inventory').update({ picture_path: null }).eq('id', inventoryId)
}
