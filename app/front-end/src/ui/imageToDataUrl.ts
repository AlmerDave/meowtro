/* Turns an uploaded photo into a downscaled, re-encoded JPEG, as a data
   URI (compressImage, unchanged call sites: RecordCat's live preview) or
   as a Blob (compressImageToBlob, new: what data/photoUpload.ts actually
   uploads to Storage). Both share one resize calculation so "how big does
   this end up" can never drift between the two output shapes.

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

/** Downscales `file` so its longest edge is at most `maxDim` pixels
    and re-encodes it as a JPEG data URI at `quality` (0-1). Rejects if
    the file cannot be read as an image at all, the caller is expected
    to catch this and show it as a form error. */
export async function compressImage(file: File, maxDim: number, quality: number): Promise<string> {
  const canvas = await drawScaled(file, maxDim)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Same downscale, encoded as a Blob instead of a data URI, what
    data/photoUpload.ts uploads to Storage. A Blob rather than converting
    an existing data URI back to one: canvas.toBlob is the direct route
    and avoids a base64-decode round trip for no reason. */
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
