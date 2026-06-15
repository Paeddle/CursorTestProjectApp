/** Max edge DYMO Connect accepts for embedded label images. */
export const MAX_LABEL_RASTER_PX = 320

/** Twips → pixels at 96 dpi (DYMO ImageObject native resolution). */
export const LABEL_RASTER_TWIPS_PER_PX = 1440 / 96

/** Map DYMO twips on a printed edge → PNG pixel width (96 dpi). */
export function labelRasterPxForTwips(sideTwips: number): number {
  const px = Math.round((sideTwips * 96) / 1440)
  return Math.max(64, Math.min(MAX_LABEL_RASTER_PX, px))
}

/** Raster size for an ImageObject box — use the longer edge so wide product photos stay sharp. */
export function labelRasterPxForBounds(bounds: { width: number; height: number }): number {
  const short = labelRasterPxForTwips(Math.min(bounds.width, bounds.height))
  const long = labelRasterPxForTwips(Math.max(bounds.width, bounds.height))
  return Math.min(MAX_LABEL_RASTER_PX, Math.max(short, long))
}

/** PNG pixel size for a DYMO bounds box at 96 dpi (matches twips on the printed label). */
export function labelRasterDimensionsForBounds(bounds: {
  width: number
  height: number
}): { width: number; height: number } {
  // Anchor the short edge so aspect ratio matches twips exactly (width anchor skews wide labels).
  const height = Math.max(1, Math.round((bounds.height * 96) / 1440))
  const width = Math.max(1, Math.round((bounds.width * height) / bounds.height))
  const maxEdge = Math.max(width, height)
  if (maxEdge > MAX_LABEL_RASTER_PX) {
    const scale = MAX_LABEL_RASTER_PX / maxEdge
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
  }
  return { width, height }
}

/** Per-edge 96 dpi sizing for element ImageObjects (each bounds edge rounded independently). */
export function labelRasterDimensionsExactTwips(bounds: {
  width: number
  height: number
}): { width: number; height: number } {
  let width = Math.max(1, Math.round((bounds.width * 96) / 1440))
  let height = Math.max(1, Math.round((bounds.height * 96) / 1440))
  const maxEdge = Math.max(width, height)
  if (maxEdge > MAX_LABEL_RASTER_PX) {
    const scale = MAX_LABEL_RASTER_PX / maxEdge
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  return { width, height }
}

/**
 * ImageObject XML for studio element boxes (non-durable fallback) — Uniform preserves aspect;
 * Center matches DYMO Connect defaults and our probe scripts.
 */
export const STUDIO_ELEMENT_IMAGE_OBJECT_OPTIONS = {
  scaleMode: 'Uniform' as const,
  horizontalAlignment: 'Center' as const,
  verticalAlignment: 'Center' as const,
}
