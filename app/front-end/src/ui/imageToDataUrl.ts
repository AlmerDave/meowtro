/* Turns an uploaded photo into a downscaled, re-encoded JPEG Blob, which
   is what data/photoUpload.ts hands to Storage.

   The file name is a fossil: it once exported a data-URI version too
   (compressImage), for when a photo's whole life was a base64 string in
   localStorage. Phase 9 moved every caller to the Blob, and the data-URI
   half is deleted rather than parked, unlike plate/CatFigure.tsx: that one
   is a working feature somebody may want back, this was a storage detail
   for a store that no longer exists.

   ponytail: a fixed max-dimension downscale, not a real image pipeline,
   no format negotiation, no multiple sizes generated. Upgrade to a resize
   Cloud Function/extension if storage cost or quality becomes a real
   problem; out of scope while this phase avoids Cloud Functions
   entirely (design doc, "Platform").

   No check script for the browser-only pieces (FileReader, Image,
   canvas.toDataURL/toBlob have no node equivalent). computeScaledSize is
   pure and does have one (imageToDataUrl.check.ts). Verified otherwise by
   tsc -b plus the manual gate where RecordCat.tsx first calls this. */

/** The longest edge and JPEG quality every uploaded photo is compressed to,
    matching the seeded photos' own size (data/cats.seed.ts's CATAAS
    helper). Shared by every uploader (ui/RecordCat.tsx, ui/ReportSighting.tsx,
    plate/Plate.tsx's admin sighting uploader) so a phone photo lands at the
    same size wherever it enters the survey. */
export const PHOTO_MAX_DIM = 640
export const PHOTO_QUALITY = 0.75

/** Pure: the only part of this file that can run under node. Never
    upscales a smaller image, `Math.min(1, ...)` is the whole rule. */
export function computeScaledSize(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

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

async function drawScaled(file: File, maxDim: number): Promise<HTMLCanvasElement> {
  const raw = await readAsDataUrl(file)
  const img = await loadImage(raw)
  const { width, height } = computeScaledSize(img.width, img.height, maxDim)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not compress the image')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

/** Downscales `file` so its longest edge is at most `maxDim` pixels and
    re-encodes it as a JPEG Blob at `quality` (0-1), which is what
    data/photoUpload.ts uploads to Storage. Rejects if the file cannot be
    read as an image at all, and every caller catches that and shows it as
    a form error. canvas.toBlob directly rather than a data URI converted
    back into one: it is the route the platform provides, and it avoids a
    base64 round trip for no reason. */
export function compressImageToBlob(file: File, maxDim: number, quality: number): Promise<Blob> {
  return drawScaled(file, maxDim).then(
    (canvas) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not compress the image'))),
          'image/jpeg',
          quality
        )
      })
  )
}
