/* Turns an uploaded photo into a compressed data-URI string, small enough
   that a handful of them still fit in the 5-10MB localStorage quota this
   whole app is built around (root CLAUDE.md: no backend). Without this
   step a single modern phone photo (often several MB) could use up most
   of that quota on its own - this is load-bearing, not a nicety, per the
   design spec's §3.

   No check script: FileReader, Image and canvas have no node equivalent,
   the same reason nothing under src/map/ has one either. Verified by
   tsc -b plus the manual gate where ui/RecordCat.tsx first calls this. */

/** The longest edge and JPEG quality every uploaded photo is compressed to,
    matching the seeded photos' own size (data/cats.seed.ts's CATAAS
    helper). Shared by every uploader (ui/RecordCat.tsx, ui/ReportSighting.tsx,
    plate/Plate.tsx's admin sighting uploader) so a phone photo lands at the
    same size wherever it enters the survey. */
export const PHOTO_MAX_DIM = 640
export const PHOTO_QUALITY = 0.75

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image'))
    img.src = src
  })
}

/** Downscales `file` so its longest edge is at most `maxDim` pixels
    (never upscales a smaller image) and re-encodes it as JPEG at
    `quality` (0-1). Rejects if the file cannot be read as an image at
    all - the caller is expected to catch this and show it as a form
    error, the same way ui/RecordCat.tsx already surfaces a storage
    failure. */
export async function compressImage(file: File, maxDim: number, quality: number): Promise<string> {
  const raw = await readAsDataUrl(file)
  const img = await loadImage(raw)

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not compress the image')
  ctx.drawImage(img, 0, 0, width, height)

  return canvas.toDataURL('image/jpeg', quality)
}
