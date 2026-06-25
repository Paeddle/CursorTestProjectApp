import { findBarcodeForItem } from './barcodeLookup/findBarcodeForItem'
import { findProductImageForItem } from './barcodeLookup/findProductImage'
import { lookupProductByBarcode } from './barcodeLookup/providers'
import { fetchItemsAsCatalog } from './itemsService'
import {
  applyBarcodeLookupToItem,
  createItemRow,
  fetchItemsList,
  updateItemRow,
} from './itemsService'
import { importItemPictureFromUrl } from '../lib/itemsImageStorage'
import { linkEbayScansToItem } from './ebayScansService'
import type { ItemRecord } from '../types/items'

export type EbayEnrichResult = {
  item: ItemRecord
  created: boolean
  barcodeSource: string | null
  imageSource: string | null
}

/**
 * Look up product info for a scanned eBay barcode, create or update an items row,
 * and link all matching ebay_scans to that item.
 */
export async function enrichEbayBarcodeToItem(barcodeValue: string): Promise<EbayEnrichResult> {
  const barcode = barcodeValue.trim()
  if (!barcode) throw new Error('Barcode is required.')

  const catalog = await fetchItemsAsCatalog()
  const digits = barcode.replace(/\D/g, '')

  let existing: ItemRecord | null = null
  const { rows } = await fetchItemsList({ search: digits || barcode, filter: 'all', limit: 20 })
  existing =
    rows.find((r) => (r.barcode ?? '').replace(/\D/g, '') === digits && digits.length > 0) ??
    rows.find((r) => (r.barcode ?? '').trim() === barcode) ??
    null

  const reverse = await lookupProductByBarcode(barcode, { catalog })
  let partNumber = reverse?.partNumber ?? existing?.part_number ?? null
  let manufacturer = reverse?.manufacturer ?? existing?.manufacturer ?? null
  let itemName = reverse?.name ?? existing?.item ?? null
  let pictureUrl = reverse?.imageUrl ?? existing?.picture_url ?? null
  let purchaseUrl = reverse?.sourceUrl ?? existing?.purchase_url ?? null
  let barcodeSource = reverse?.sourceLabel ?? null
  let imageSource: string | null = reverse?.imageUrl ? reverse.sourceLabel : null

  if (!itemName || (!partNumber && !pictureUrl)) {
    const lookupInput = {
      part_number: partNumber,
      manufacturer,
      item: itemName,
    }
    const { best: barcodeHit } = await findBarcodeForItem(lookupInput, { catalog })
    if (barcodeHit) {
      if (!partNumber && barcodeHit.matchedPartNumber) partNumber = barcodeHit.matchedPartNumber
      if (!itemName && barcodeHit.title) itemName = barcodeHit.title
      if (!pictureUrl && barcodeHit.imageUrl) pictureUrl = barcodeHit.imageUrl
      if (!purchaseUrl && barcodeHit.productUrl) purchaseUrl = barcodeHit.productUrl
      barcodeSource = barcodeHit.source
      if (barcodeHit.imageUrl) imageSource = barcodeHit.source
    }
  }

  if (!pictureUrl) {
    const { best: img } = await findProductImageForItem({
      part_number: partNumber,
      manufacturer,
      item: itemName,
    })
    if (img) {
      pictureUrl = img.imageUrl
      imageSource = img.source
      if (!purchaseUrl && img.productUrl) purchaseUrl = img.productUrl
      if (!itemName && img.title) itemName = img.title
    }
  }

  if (!itemName) {
    itemName = partNumber ? `eBay item ${partNumber}` : `eBay item ${barcode}`
  }

  const barcodeToSave = digits.length >= 8 ? digits : barcode.replace(/\D/g, '') || barcode
  let item: ItemRecord
  let created = false

  if (existing) {
    const patch: Parameters<typeof updateItemRow>[1] = {}
    if (!existing.item?.trim()) patch.item = itemName
    if (!existing.part_number?.trim() && partNumber) patch.part_number = partNumber
    if (!existing.manufacturer?.trim() && manufacturer) patch.manufacturer = manufacturer
    if (!existing.barcode?.trim() && barcodeToSave) patch.barcode = barcodeToSave
    if (!existing.picture_url?.trim() && pictureUrl) patch.picture_url = pictureUrl
    if (!existing.purchase_url?.trim() && purchaseUrl) patch.purchase_url = purchaseUrl
    if (barcodeSource && !existing.barcode_lookup_source) {
      patch.barcode_lookup_source = `ebay:${barcodeSource}`
      patch.barcode_lookup_at = new Date().toISOString()
    }
    item = Object.keys(patch).length > 0 ? await updateItemRow(existing.id, patch) : existing
    if (barcodeToSave && !existing.barcode?.trim()) {
      item = await applyBarcodeLookupToItem(item.id, barcodeToSave, `ebay:${barcodeSource ?? 'lookup'}`, {
        purchaseUrl: purchaseUrl ?? undefined,
        pictureUrl: pictureUrl ?? undefined,
      })
    }
  } else {
    item = await createItemRow({
      item: itemName,
      part_number: partNumber,
      manufacturer,
      barcode: barcodeToSave,
      picture_url: pictureUrl,
      purchase_url: purchaseUrl,
    })
    if (barcodeSource) {
      item = await applyBarcodeLookupToItem(item.id, barcodeToSave, `ebay:${barcodeSource}`, {
        purchaseUrl: purchaseUrl ?? undefined,
        pictureUrl: pictureUrl ?? undefined,
      })
    }
    created = true
  }

  if (pictureUrl && !item.picture_path) {
    try {
      item = await importItemPictureFromUrl(item.id, pictureUrl)
    } catch {
      /* external URL kept on row */
    }
  }

  await linkEbayScansToItem(barcodeValue, item.id)

  return { item, created, barcodeSource, imageSource }
}
