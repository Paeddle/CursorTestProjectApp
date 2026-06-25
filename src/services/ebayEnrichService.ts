import { findBarcodeForItem } from './barcodeLookup/findBarcodeForItem'
import { findProductImageForItem } from './barcodeLookup/findProductImage'
import { lookupProductByBarcode } from './barcodeLookup/providers'
import { fetchProductPageDetails, scoreProductImageUrl } from './barcodeLookup/htmlExtract'
import { cleanProductTitle } from './barcodeLookup/productPageExtract'
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
  lookupNote: string | null
}

async function safeLookup<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`${label} failed:`, e)
    return null
  }
}

function applyPageDetails(
  purchaseUrl: string,
  details: Awaited<ReturnType<typeof fetchProductPageDetails>>,
  state: {
    partNumber: string | null
    manufacturer: string | null
    itemName: string | null
    pictureUrl: string | null
    purchaseUrl: string | null
  }
) {
  if (details?.partNumber) state.partNumber = details.partNumber
  if (details?.manufacturer) state.manufacturer = details.manufacturer
  if (details?.cleanTitle || details?.title) {
    state.itemName = cleanProductTitle(details.cleanTitle ?? details.title) ?? state.itemName
  }
  if (details?.imageUrl) {
    const newScore = scoreProductImageUrl(details.imageUrl, state.partNumber)
    const oldScore = scoreProductImageUrl(state.pictureUrl ?? '', state.partNumber)
    if (newScore >= oldScore) state.pictureUrl = details.imageUrl
  }
  state.purchaseUrl = purchaseUrl
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

  const lookupErrors: string[] = []

  const reverse = await safeLookup('lookupProductByBarcode', () =>
    lookupProductByBarcode(barcode, { catalog })
  )
  if (reverse === null) {
    lookupErrors.push('external product lookup unavailable')
  }

  let partNumber = reverse?.partNumber ?? existing?.part_number ?? null
  let manufacturer = reverse?.manufacturer ?? existing?.manufacturer ?? null
  let itemName = reverse?.name ?? existing?.item ?? null
  let pictureUrl = reverse?.imageUrl ?? existing?.picture_url ?? null
  let purchaseUrl = reverse?.sourceUrl ?? existing?.purchase_url ?? null
  let barcodeSource = reverse?.sourceLabel ?? null
  let imageSource: string | null = reverse?.imageUrl ? reverse.sourceLabel : null

  // Re-scrape the product page URL for accurate model number and hero image.
  if (purchaseUrl?.trim()) {
    const details = await safeLookup('fetchProductPageDetails', () =>
      fetchProductPageDetails(purchaseUrl!, partNumber)
    )
    if (details) {
      const bag = { partNumber, manufacturer, itemName, pictureUrl, purchaseUrl }
      applyPageDetails(purchaseUrl, details, bag)
      partNumber = bag.partNumber
      manufacturer = bag.manufacturer
      itemName = bag.itemName
      pictureUrl = bag.pictureUrl
      purchaseUrl = bag.purchaseUrl
      if (details.imageUrl) imageSource = 'Product page'
    }
  }

  if (!itemName || (!partNumber && !pictureUrl)) {
    const barcodeResult = await safeLookup('findBarcodeForItem', () =>
      findBarcodeForItem(
        { part_number: partNumber, manufacturer, item: itemName },
        { catalog }
      )
    )
    const barcodeHit = barcodeResult?.best ?? null
    if (barcodeHit) {
      if (!partNumber && barcodeHit.matchedPartNumber) partNumber = barcodeHit.matchedPartNumber
      if (!itemName && barcodeHit.title) itemName = barcodeHit.title
      if (barcodeHit.productUrl && !purchaseUrl) purchaseUrl = barcodeHit.productUrl
      if (barcodeHit.imageUrl) {
        const newScore = scoreProductImageUrl(barcodeHit.imageUrl, partNumber)
        const oldScore = scoreProductImageUrl(pictureUrl ?? '', partNumber)
        if (newScore >= oldScore) pictureUrl = barcodeHit.imageUrl
      }
      barcodeSource = barcodeHit.source
      if (barcodeHit.imageUrl) imageSource = barcodeHit.source
    }
  }

  const pictureScore = scoreProductImageUrl(pictureUrl ?? '', partNumber)
  if (pictureScore < 15) {
    const imageResult = await safeLookup('findProductImageForItem', () =>
      findProductImageForItem(
        { part_number: partNumber, manufacturer, item: itemName },
        { productUrl: purchaseUrl }
      )
    )
    const img = imageResult?.best ?? null
    if (img) {
      const newScore = scoreProductImageUrl(img.imageUrl, partNumber)
      if (newScore > pictureScore) {
        pictureUrl = img.imageUrl
        imageSource = img.source
      }
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

  const foundDetails = Boolean(
    barcodeSource || pictureUrl || (partNumber && itemName !== `eBay item ${barcode}`)
  )
  const lookupNote =
    lookupErrors.length > 0 && !foundDetails
      ? 'Item saved with basic info. Deploy the product-lookup Edge Function in Supabase for full AV/UPC lookup.'
      : lookupErrors.length > 0 && foundDetails
        ? 'Item saved; some lookup sources were unavailable.'
        : null

  return { item, created, barcodeSource, imageSource, lookupNote }
}
