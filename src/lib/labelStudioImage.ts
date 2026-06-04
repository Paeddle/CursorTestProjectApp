/** Fetch an image URL and return PNG bytes as base64 for DYMO ImageObject XML. */
export async function fetchUrlAsPngBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return blobToPngBase64(blob)
  } catch {
    return null
  }
}

export function blobToPngBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, img.naturalWidth)
        canvas.height = Math.max(1, img.naturalHeight)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        resolve(dataUrl.replace(/^data:image\/png;base64,/, ''))
      } catch {
        resolve(null)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    img.src = objectUrl
  })
}
