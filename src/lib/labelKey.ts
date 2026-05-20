import { normalizePoKey } from './poIpointMatch'

/** Record separator — safe for Postgres/JSON (not NUL, not ambiguous \\u). */
export const LABEL_KEY_SEP = '\x1e'

export function makeLabelKey(poNumber: string, lineId: string, locationName = ''): string {
  return `${normalizePoKey(poNumber)}${LABEL_KEY_SEP}${lineId}${LABEL_KEY_SEP}${(locationName || '').trim()}`
}

export function parseLabelKey(
  key: string
): { poKey: string; lineId: string; locationName: string } | null {
  const normalized = key.replace(/\0/g, LABEL_KEY_SEP)
  const i = normalized.indexOf(LABEL_KEY_SEP)
  if (i === -1) return null
  const j = normalized.indexOf(LABEL_KEY_SEP, i + 1)
  if (j === -1) {
    return { poKey: normalized.slice(0, i), lineId: normalized.slice(i + 1), locationName: '' }
  }
  return {
    poKey: normalized.slice(0, i),
    lineId: normalized.slice(i + 1, j),
    locationName: normalized.slice(j + 1),
  }
}

/** Strip characters that break Supabase/Postgres text + JSON inserts. */
export function sanitizeQueueText(value: string | null | undefined): string | null {
  if (value == null) return null
  return value.replace(/\0/g, '').trim() || null
}
