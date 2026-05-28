import type { LabelStudioElement, LabelStudioItem } from '../types/labelStudio'
import { isBarcodeElement } from '../types/labelStudio'

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

export function mergedLinesForElement(content: string, item: LabelStudioItem): string[] {
  const raw = normalizeMergedText(resolveMergeTemplate(content, item.fields))
  if (!raw) return []
  return raw.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** Single-line value for barcode objects (first line only, trimmed). */
export function mergedBarcodeForElement(content: string, item: LabelStudioItem): string {
  const raw = normalizeMergedText(resolveMergeTemplate(content, item.fields))
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean)
  return line ?? ''
}

export function previewTextForTemplate(
  elements: LabelStudioElement[],
  item: LabelStudioItem | null
): string {
  if (!item) return '(select an item to preview)'
  const parts = elements
    .map((el) => {
      if (isBarcodeElement(el)) {
        const v = mergedBarcodeForElement(el.content, item)
        return v ? `[barcode] ${v}` : ''
      }
      return normalizeMergedText(resolveMergeTemplate(el.content, item.fields))
    })
    .filter(Boolean)
  return parts.length ? parts.join('\n\n') : '(no text after merge)'
}
