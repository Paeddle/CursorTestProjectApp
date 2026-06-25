import { findBarcodeForItem } from './barcodeLookup/findBarcodeForItem'
import { findProductImageForItem } from './barcodeLookup/findProductImage'
import { lookupProductByBarcode } from './barcodeLookup/providers'
import { fetchProductPageDetails, scoreProductImageUrl } from './barcodeLookup/htmlExtract'
import { cleanProductTitle, extractModelFromUrl } from './barcodeLookup/productPageExtract'
import {
  applyBarcodeLookupToItem,
  createItemRow,
  fetchItemByBarcode,
  fetchItemById,
  fetchItemsAsCatalog,
  updateItemRow,
} from './itemsService'
import { importItemPictureFromUrl } from '../lib/itemsImageStorage'
import { linkEbayScansToItem } from './ebayScansService'
import type { ItemRecord } from '../types/items'

export type EbayEnrichOptions = {
  /** Overwrite existing item fields when lookup finds better data. */
  forceRefresh?: boolean
  existingItemId?: string | null
  knownProductUrl?: string | null
}

export type EbayEnrichResult = {
  item: ItemRecord
  created: boolean
  updated: boolean
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

function shouldSet(
  existingVal: string | null | undefined,
  newVal: string | null | undefined,
  force: boolean
): boolean {
  const next = (newVal ?? '').trim()
  if (!next) return false
  const prev = (existingVal ?? '').trim()
  if (!prev) return true
  if (!force) return false
  return next !== prev
}

function inferBrandFromProductUrl(pageUrl: string): string | null {
  try {
    const slug = decodeURIComponent(new URL(pageUrl).pathname).split('/').filter(Boolean).pop() ?? ''
    const brand = slug.split(/[-_]/)[0]?.trim()
    if (!brand || brand.length < 2 || !/^[a-z]+$/i.test(brand)) return null
    const lower = brand.toLowerCase()
    const known: Record<string, string> = {
      samsung: 'Samsung',
      lg: 'LG',
      sony: 'Sony',
      vizio: 'Vizio',
      tcl: 'TCL',
      hisense: 'Hisense',
    }
    return known[lower] ?? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()
  } catch {
    return null
  }
}

/** Parse model/brand from a retailer URL without network (works when Edge Function is down). */
function localDetailsFromProductUrl(pageUrl: string): {
  partNumber: string | null
  manufacturer: string | null
} {
  return {
    partNumber: extractModelFromUrl(pageUrl),
    manufacturer: inferBrandFromProductUrl(pageUrl),
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
  },
  force: boolean
) {
  if (details?.partNumber && (force || !state.partNumber)) state.partNumber = details.partNumber
  if (details?.manufacturer && (force || !state.manufacturer)) state.manufacturer = details.manufacturer
  if (details?.cleanTitle || details?.title) {
    const title = cleanProductTitle(details.cleanTitle ?? details.title)
    if (title && (force || !state.itemName)) state.itemName = title
  }
  if (details?.imageUrl) {
    const newScore = scoreProductImageUrl(details.imageUrl, state.partNumber)
    const oldScore = scoreProductImageUrl(state.pictureUrl ?? '', state.partNumber)
    if (force ? newScore >= oldScore : newScore > oldScore || !state.pictureUrl) {
      state.pictureUrl = details.imageUrl
    }
  }
  state.purchaseUrl = purchaseUrl
}

/**
 * Look up product info for a scanned eBay barcode, create or update an items row,
 * and link all matching ebay_scans to that item.
 */
export async function enrichEbayBarcodeToItem(
  barcodeValue: string,
  options?: EbayEnrichOptions
): Promise<EbayEnrichResult> {
  const barcode = barcodeValue.trim()
  if (!barcode) throw new Error('Barcode is required.')
  const force = Boolean(options?.forceRefresh)

  const catalog = await fetchItemsAsCatalog()
  const digits = barcode.replace(/\D/g, '')

  let existing: ItemRecord | null = null
  if (options?.existingItemId) {
    existing = await fetchItemById(options.existingItemId)
  }
  if (!existing) {
    existing = await fetchItemByBarcode(barcode)
  }

  const lookupErrors: string[] = []
  let partNumber = existing?.part_number ?? null
  let manufacturer = existing?.manufacturer ?? null
  let itemName = existing?.item ?? null
  let pictureUrl = existing?.picture_url ?? null
  let purchaseUrl = options?.knownProductUrl?.trim() || existing?.purchase_url || null
  let barcodeSource = existing?.barcode_lookup_source ?? null
  let imageSource: string | null = null

  // Scrape known product URL first (e.g. B&H link already on the item).
  if (purchaseUrl) {
    const local = localDetailsFromProductUrl(purchaseUrl)
    if (local.partNumber && (force || !partNumber)) partNumber = local.partNumber
    if (local.manufacturer && (force || !manufacturer)) manufacturer = local.manufacturer

    const details = await safeLookup('fetchProductPageDetails', () =>
      fetchProductPageDetails(purchaseUrl!, partNumber)
    )
    if (details) {
      const bag = { partNumber, manufacturer, itemName, pictureUrl, purchaseUrl }
      applyPageDetails(purchaseUrl, details, bag, force)
      partNumber = bag.partNumber
      manufacturer = bag.manufacturer
      itemName = bag.itemName
      pictureUrl = bag.pictureUrl
      purchaseUrl = bag.purchaseUrl
      if (details.imageUrl) imageSource = 'Product page'
      barcodeSource = barcodeSource ?? 'ebay:product_page'
    } else {
      lookupErrors.push('could not scrape product page')
    }
  }

  const reverse = await safeLookup('lookupProductByBarcode', () =>
    lookupProductByBarcode(barcode, { catalog })
  )
  if (reverse) {
    if (shouldSet(partNumber, reverse.partNumber, force)) partNumber = reverse.partNumber
    if (shouldSet(manufacturer, reverse.manufacturer, force)) manufacturer = reverse.manufacturer
    if (shouldSet(itemName, reverse.name, force)) itemName = reverse.name ?? null
    if (reverse.sourceUrl && (force || !purchaseUrl)) purchaseUrl = reverse.sourceUrl
    if (reverse.imageUrl) {
      const newScore = scoreProductImageUrl(reverse.imageUrl, partNumber)
      const oldScore = scoreProductImageUrl(pictureUrl ?? '', partNumber)
      if (force ? newScore >= oldScore : newScore > oldScore || !pictureUrl) {
        pictureUrl = reverse.imageUrl
        imageSource = reverse.sourceLabel
      }
    }
    barcodeSource = reverse.sourceLabel
  } else if (!purchaseUrl) {
    lookupErrors.push('external product lookup unavailable')
  }

  // Re-scrape product URL after reverse lookup may have found a better link.
  if (purchaseUrl) {
    const details = await safeLookup('fetchProductPageDetails-2', () =>
      fetchProductPageDetails(purchaseUrl!, partNumber)
    )
    if (details) {
      const bag = { partNumber, manufacturer, itemName, pictureUrl, purchaseUrl }
      applyPageDetails(purchaseUrl, details, bag, force)
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
      findBarcodeForItem({ part_number: partNumber, manufacturer, item: itemName }, { catalog })
    )
    const barcodeHit = barcodeResult?.best ?? null
    if (barcodeHit) {
      if (shouldSet(partNumber, barcodeHit.matchedPartNumber, force)) {
        partNumber = barcodeHit.matchedPartNumber
      }
      if (shouldSet(itemName, barcodeHit.title, force)) itemName = barcodeHit.title
      if (barcodeHit.productUrl && (force || !purchaseUrl)) purchaseUrl = barcodeHit.productUrl
      if (barcodeHit.imageUrl) {
        const newScore = scoreProductImageUrl(barcodeHit.imageUrl, partNumber)
        const oldScore = scoreProductImageUrl(pictureUrl ?? '', partNumber)
        if (force ? newScore >= oldScore : newScore > oldScore || !pictureUrl) {
          pictureUrl = barcodeHit.imageUrl
          imageSource = barcodeHit.source
        }
      }
      barcodeSource = barcodeHit.source
    }
  }

  const pictureScore = scoreProductImageUrl(pictureUrl ?? '', partNumber)
  if (pictureScore < 20 || force) {
    const imageResult = await safeLookup('findProductImageForItem', () =>
      findProductImageForItem(
        { part_number: partNumber, manufacturer, item: itemName },
        { productUrl: purchaseUrl }
      )
    )
    const img = imageResult?.best ?? null
    if (img) {
      const newScore = scoreProductImageUrl(img.imageUrl, partNumber)
      if (force ? newScore >= pictureScore : newScore > pictureScore) {
        pictureUrl = img.imageUrl
        imageSource = img.source
      }
      if (img.productUrl && (force || !purchaseUrl)) purchaseUrl = img.productUrl
      if (shouldSet(itemName, img.title, force)) itemName = img.title
    }
  }

  if (!itemName) {
    itemName = partNumber ? `eBay item ${partNumber}` : `eBay item ${barcode}`
  }

  const barcodeToSave = digits.length >= 8 ? digits : barcode.replace(/\D/g, '') || barcode
  let item: ItemRecord
  let created = false
  let updated = false

  if (existing) {
    const patch: Parameters<typeof updateItemRow>[1] = {}
    if (shouldSet(existing.item, itemName, force)) patch.item = itemName
    if (shouldSet(existing.part_number, partNumber, force)) patch.part_number = partNumber
    if (shouldSet(existing.manufacturer, manufacturer, force)) patch.manufacturer = manufacturer
    if (shouldSet(existing.barcode, barcodeToSave, force)) patch.barcode = barcodeToSave
    if (shouldSet(existing.picture_url, pictureUrl, force)) patch.picture_url = pictureUrl
    if (shouldSet(existing.purchase_url, purchaseUrl, force)) patch.purchase_url = purchaseUrl
    if (barcodeSource) {
      patch.barcode_lookup_source = `ebay:${barcodeSource}`
      patch.barcode_lookup_at = new Date().toISOString()
    }

    if (Object.keys(patch).length > 0) {
      item = await updateItemRow(existing.id, patch)
      updated = true
    } else {
      item = existing
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
    updated = true
  }

  const shouldImportImage =
    Boolean(pictureUrl) &&
    (force || !item.picture_path) &&
    (force || shouldSet(existing?.picture_url, pictureUrl, true))

  if (shouldImportImage && pictureUrl) {
    try {
      item = await importItemPictureFromUrl(item.id, pictureUrl)
      updated = true
    } catch {
      /* external URL kept on row */
    }
  }

  await linkEbayScansToItem(barcodeValue, item.id)

  const foundDetails = Boolean(
    barcodeSource || pictureUrl || (partNumber && itemName !== `eBay item ${barcode}`)
  )
  let lookupNote: string | null = null
  if (!updated && force) {
    lookupNote = 'Lookup ran but no fields changed. Deploy product-lookup Edge Function if lookups fail silently.'
  } else if (lookupErrors.length > 0 && !foundDetails) {
    lookupNote =
      'Item saved with basic info. Deploy the product-lookup Edge Function in Supabase for full AV/UPC lookup.'
  } else if (lookupErrors.length > 0 && foundDetails) {
    lookupNote = 'Item saved; some lookup sources were unavailable.'
  }

  return { item, created, updated, barcodeSource, imageSource, lookupNote }
}
