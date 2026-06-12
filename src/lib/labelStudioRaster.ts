/** Max edge DYMO Connect accepts for embedded label images. */
export const MAX_LABEL_RASTER_PX = 320

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
  let width = Math.max(1, Math.round((bounds.width * 96) / 1440))
  let height = Math.max(1, Math.round((bounds.height * 96) / 1440))
  // Independent rounding can skew aspect ratio — DYMO Center+Uniform then shifts the bitmap vs TextObject twips.
  const twipsAspect = bounds.width / bounds.height
  const pxAspect = width / height
  if (Math.abs(twipsAspect - pxAspect) > 0.001) {
    height = Math.max(1, Math.round(width / twipsAspect))
  }
  const maxEdge = Math.max(width, height)
  if (maxEdge > MAX_LABEL_RASTER_PX) {
    const scale = MAX_LABEL_RASTER_PX / maxEdge
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  return { width, height }
}
