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
