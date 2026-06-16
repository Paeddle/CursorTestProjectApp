import type { LabelStudioElement, LabelStudioItem } from '../types/labelStudio'
import { isBarcodeElement, isImageElement, type LabelStudioBarcodeType } from '../types/labelStudio'

const MERGE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** Replace `{{field}}` tokens; unknown keys become empty. */
export function resolveMergeTemplate(content: string, fields: Record<string, string>): string {
  return content.replace(MERGE_RE, (_, key: string) => {
    const v = fields[key.toLowerCase()] ?? fields[key]
    return v != null ? String(v) : ''
  })
}

/** Collapse blank lines from empty merge fields. */
export function normalizeMergedText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** QR payload — keep spaces and line breaks from the designer field after merge. */
export function mergedQrContentForElement(content: string, item: LabelStudioItem): string {
  return resolveMergeTemplate(content, item.fields)
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

export function mergedLinesForElement(content: string, item: LabelStudioItem): string[] {
  const raw = normalizeMergedText(resolveMergeTemplate(content, item.fields))
  if (!raw) return []
  return raw.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** Single-line value for linear barcode symbologies (first non-empty line). */
export function mergedBarcodeForElement(content: string, item: LabelStudioItem): string {
  const raw = normalizeMergedText(resolveMergeTemplate(content, item.fields))
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean)
  return line ?? ''
}

/** Merged barcode/QR payload — QR keeps full multiline text; linear codes use one line. */
export function mergedBarcodePayloadForElement(
  content: string,
  item: LabelStudioItem,
  barcodeType: LabelStudioBarcodeType
): string {
  if (barcodeType === 'QrCode') {
    const raw = mergedQrContentForElement(content, item)
    return raw.trim().length > 0 ? raw : ''
  }
  return mergedBarcodeForElement(content, item)
}

/** Resolved image URL for image objects (from {{picture}} or a direct URL). */
export function mergedImageUrlForElement(content: string, item: LabelStudioItem): string {
  const raw = normalizeMergedText(resolveMergeTemplate(content, item.fields))
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean)
  if (!line) return ''
  if (/^https?:\/\//i.test(line)) return line
  return item.fields.picture ?? ''
}

export function previewTextForTemplate(
  elements: LabelStudioElement[],
  item: LabelStudioItem | null
): string {
  if (!item) return '(select an item to preview)'
  const parts = elements
    .map((el) => {
      if (isBarcodeElement(el)) {
        const v =
          el.barcodeType === 'QrCode'
            ? mergedQrContentForElement(el.content, item)
            : mergedBarcodeForElement(el.content, item)
        return v.trim() ? `[barcode] ${v}` : ''
      }
      if (isImageElement(el)) {
        const v = mergedImageUrlForElement(el.content, item)
        return v ? '[image]' : ''
      }
      return normalizeMergedText(resolveMergeTemplate(el.content, item.fields))
    })
    .filter(Boolean)
  return parts.length ? parts.join('\n\n') : '(no text after merge)'
}
