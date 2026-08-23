import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { BookOpen, Camera, RotateCcw } from 'lucide-react'
import { identify, REJECTION_TEXT, SAMPLE_SIDE, type IdentifyResult } from '@/data/identify'
import type { Cat } from '@/data/catsRepo'
import { spring } from '@/motion/springs'

/* The scanner: photograph a cat, get told which one it is.

   The honest half and the pretending half are separated in data/identify.ts,
   which is worth reading before this file. In short: the frame check is
   real, the match is a stand-in for a model that needs a server, and the
   seam between them is one async call so the stand-in can be replaced
   without touching anything here.

   ## Why a file input and not getUserMedia

   `<input type="file" accept="image/*" capture="environment">` opens the
   camera directly on a phone and a file picker on a desktop, handles the
   permission prompt, the shutter, the preview and the retake, and rotates
   the result by its EXIF orientation. A hand-built viewfinder would be a
   video element, a stream to acquire and release, a permissions state
   machine, a canvas grab, an orientation fix, and a camera left running if
   any of it throws. The platform already ships all of that.

   ## The status text is on its own clock

   The stages cycle on a timer and stop when the promise resolves, rather
   than being driven by real progress, because there is no real progress to
   report yet. That is also why they survive contact with a real
   recogniser: a fetch that takes 200ms or 6 seconds shows however many
   stages fit, and nothing here assumes a duration. */

type Props = {
  cats: Cat[]
  /** Opens the specimen plate. The only thing this component hands on.

      Reporting a sighting used to be offered here too, and is not any more:
      it lives at the foot of the plate, where it covers every route to a
      cat rather than only this one. Identifying and reporting are two
      errands, and the scanner's is finished once the cat has a name. */
  onOpenRecord: (catId: string) => void
  onBack: () => void
}

const STAGES = [
  'Reading the frame…',
  'Looking for markings…',
  'Matching against the survey…',
]

/* Browser-only, and deliberately not in data/identify.ts: keeping that file
   free of the DOM is what lets its arithmetic be checked outside a browser.

   Drawn small on purpose (see SAMPLE_SIDE). The aspect ratio is not
   preserved because nothing downstream cares about shape, only about the
   distribution of light in the frame. */
async function samplePixels(file: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = SAMPLE_SIDE / Math.max(bitmap.width, bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: false })
    if (!context) throw new Error('no 2d context')
    context.drawImage(bitmap, 0, 0, width, height)
    return context.getImageData(0, 0, width, height).data
  } finally {
    // Frees the decoded image immediately rather than at the next GC. A few
    // full-resolution phone photos held live is tens of megabytes.
    bitmap.close()
  }
}

export function ScanCat({ cats, onOpenRecord, onBack }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [stage, setStage] = useState(0)
  const [result, setResult] = useState<IdentifyResult | null>(null)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /* Object URLs are a manual allocation: the browser holds the whole file
     alive until it is revoked, and a person retaking a photo five times
     would otherwise leave five phone-sized images in memory. Revoked when
     the URL is replaced and when the component goes. */
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  // Cosmetic, and stopped the moment there is a real answer.
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setStage((n) => (n + 1) % STAGES.length), 700)
    return () => clearInterval(timer)
  }, [working])

  const run = async (file: File) => {
    /* Created here, never inside the setState updater. React double-invokes
       updater functions under StrictMode, so allocating in one produced two
       object URLs per photo and leaked whichever it discarded, holding a
       full-resolution image alive for the life of the page. Releasing is
       the effect above's job, and it is the only place that does it. */
    setPreview(URL.createObjectURL(file))
    setResult(null)
    setFailed(false)
    setStage(0)
    setWorking(true)
    try {
      setResult(await identify(await samplePixels(file), cats))
    } catch {
      /* A file that is not an image, a codec the browser will not decode, a
         canvas the OS refuses. All the same to somebody standing outside:
         the photo did not work, take another. */
      setFailed(true)
    } finally {
      setWorking(false)
    }
  }

  const retake = () => {
    /* Nothing is cleared here on purpose. Somebody who opens the camera and
       backs out of it should come back to the photo and the answer they
       already had, not to a blank frame; run() resets the state when a new
       photo actually arrives.

       The value has to be cleared or picking the SAME file twice fires no
       change event at all, and the retake button silently does nothing. */
    if (inputRef.current) inputRef.current.value = ''
    inputRef.current?.click()
  }

  const matched =
    result?.status === 'match' ? (cats.find((c) => c.id === result.catId) ?? null) : null

  return (
    <div className="scan">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        /* Out of the tab order and out of the accessibility tree: it is
           driven entirely by the visible buttons below, and left in it
           would be a control a keyboard user lands on and cannot see. */
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void run(file)
        }}
      />

      <div className="scan-stage" data-working={String(working)}>
        {preview ? (
          <img src={preview} alt="The photo you took" />
        ) : (
          <div className="scan-empty">
            <Camera size={22} aria-hidden />
          </div>
        )}
        {/* The sweep. Purely a readout of "something is happening", so it is
            aria-hidden and it stops when the work does. */}
        {working && <span className="scan-sweep" aria-hidden />}
      </div>

      {/* One live region for every outcome, so a screen reader is told the
          answer whichever of the four it turns out to be. */}
      <div className="scan-status" role="status" aria-live="polite">
        {working && <p className="scan-stage-text">{STAGES[stage]}</p>}

        {!working && !preview && (
          <p className="scan-prompt">
            Photograph the cat and the survey will try to name it.
          </p>
        )}

        {!working && failed && <p className="scan-bad">That photo could not be read. Try another.</p>}

        {!working && result?.status === 'no-subject' && (
          <p className="scan-bad">{REJECTION_TEXT[result.reason]}</p>
        )}

        {!working && result?.status === 'unsure' && (
          <p className="scan-bad">No match in the survey. Pick from the list instead.</p>
        )}

        {/* The card. An answer to "what is that cat", which is the question
            that was actually asked, and nothing more: identifying a cat is
            not the same act as reporting where it was, and running the two
            together made the scanner commit somebody to a second task they
            had not chosen. What to do next is under the card, optional, and
            phrased as two different intentions. */}
        {!working && result?.status === 'match' && matched && (
          <motion.div
            className="scan-card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
          >
            <div className="scan-card-head">
              <img src={matched.photo} alt="" />
              <div>
                <p className="scan-card-name">{matched.name}</p>
                <p className="scan-card-plate">
                  {matched.plate} · {matched.line}
                </p>
                <p className="scan-card-confidence">
                  <span
                    className="scan-bar"
                    aria-hidden
                    style={
                      { '--fill': `${Math.round(result.confidence * 100)}%` } as React.CSSProperties
                    }
                  />
                  {Math.round(result.confidence * 100)}% match
                </p>
              </div>
            </div>

            {/* The identifying facts, not the whole record. These are the
                ones somebody standing in front of the animal can check
                against it, which is what makes a match believable or not.
                Everything else stays in the plate, one button away, rather
                than being restated here as a second detail view to keep in
                step with the first. */}
            <dl className="scan-card-facts">
              <dt>Markings</dt>
              <dd>{matched.description}</dd>
              <dt>Disposition</dt>
              <dd>{matched.disposition}</dd>
              {matched.lastSeen && (
                <>
                  <dt>Last seen</dt>
                  <dd>{matched.lastSeen}</dd>
                </>
              )}
              {matched.note && (
                <>
                  <dt>Field note</dt>
                  <dd>{matched.note}</dd>
                </>
              )}
            </dl>
          </motion.div>
        )}
      </div>

      <div className="scan-actions">
        {!preview && (
          <button type="button" className="sight-go" onClick={() => inputRef.current?.click()}>
            <Camera size={14} />
            Take a photo
          </button>
        )}

        {preview && !working && matched && result?.status === 'match' && (
          <>
            {/* One action, because there is one thing left to do: read the
                record. Anything further, including saying where the cat was
                seen, is offered on the record itself. */}
            <button type="button" className="sight-go" onClick={() => onOpenRecord(result.catId)}>
              <BookOpen size={14} />
              Open {matched.name}&apos;s record
            </button>
          </>
        )}

        {preview && !working && (
          <button type="button" className="scan-retake" onClick={retake}>
            <RotateCcw size={13} />
            Retake
          </button>
        )}

        <button type="button" className="scan-manual" onClick={onBack}>
          {matched ? 'Not this one' : 'Pick from the list'}
        </button>
      </div>

      {/* Said plainly rather than buried, for the same reason the sighting
          panel says nobody reviews sightings yet. The frame check above is
          real; the name is not. */}
      <p className="sight-hint">Recognition is not live yet. This match is a stand-in.</p>
    </div>
  )
}
