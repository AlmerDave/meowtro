import type { Cat } from './cats.seed'

/* Identification: "point it at a cat and it tells you which one".

   ## What is real here and what is not

   Real: the frame gate below. It reads the pixels of the photo you took and
   refuses the ones there is nothing to read in, and it does that with
   arithmetic, not with a claim.

   Not real, and no longer pretended to be: the match itself. `identify`
   used to answer MILO for any readable frame, a placeholder confidence
   score included, with the honesty carried by one caption at the bottom of
   the panel rather than by the answer itself. Real re-identification needs
   many labelled photos per individual and a trained embedding — worth
   building only once the survey is real (feature roadmap, phase 11) — so
   rather than leave a guessing mock running indefinitely, every readable
   frame now answers `coming-soon` and says so as the result, not as a
   footnote under it.

   ## Why the gate is worth having anyway

   A scanner that says "not built yet" whatever you point it at is still
   worth checking the frame first: it is the difference between "not built
   yet" and "not built yet, and also that was a photo of the ceiling". The
   gate means something real still runs before the honest answer, so a
   person gets useful feedback (too dark, nothing in frame) even with no
   name to give them.

   Be precise about what it catches, though: it rejects EMPTY frames, not
   WRONG ones. A wall, the sky, the inside of a pocket, a lens cap. It
   cannot tell a cat from a dog or from a chair, and nothing in the UI says
   it can.

   ## The seam

   `identify` is one async function returning one of four shapes.
   `coming-soon` is what every readable photo gets today. `match`/`unsure`
   are what a real recogniser returns later (the pattern plate/CatFigure.tsx
   already uses for three.js: a lazily-loaded detector, or a fetch to a
   server) — the shapes stay in the union and ScanCat.tsx's rendering for
   them stays in place, unused but ready, so making this real again is a
   change to this function's body only. Nothing above it changes, because
   nothing above it knows: the UI awaits a promise and renders a result,
   which is exactly what it would do against a real one.

   The staged delay lives in here rather than in the UI for the same reason.
   Take it out and the UI is already awaiting real work. */

export type Rejection = 'dark' | 'flat'

export type IdentifyResult =
  | { status: 'match'; catId: string; confidence: number }
  /** No cats to match against. Not reachable while three are seeded, but a
      real recogniser returns this whenever nothing scores high enough. */
  | { status: 'unsure' }
  | { status: 'no-subject'; reason: Rejection }
  /** Recognition itself: not built yet. Every readable frame lands here
      today, honestly, rather than at a fake `match`. */
  | { status: 'coming-soon' }

/** Longest side the photo is sampled at. Statistics do not need pixels: a
    160px thumbnail of a 12 megapixel photo has the same mean and spread as
    the original, and costs about 25,000 array reads instead of twelve
    million. */
export const SAMPLE_SIDE = 160

export type FrameStats = {
  /** Mean luminance, 0 to 255. */
  mean: number
  /** Standard deviation of luminance. How much is going on in the frame. */
  contrast: number
}

/* Rec. 709 luma. Green carries most of it because eyes do, and a mean over
   raw RGB would call a saturated blue frame far brighter than it looks. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Mean and spread of a frame's luminance, from raw RGBA. Pure, so it can
    be checked against constructed frames without a browser. */
export function frameStats(pixels: Uint8ClampedArray): FrameStats {
  const count = pixels.length / 4
  if (count === 0) return { mean: 0, contrast: 0 }

  let sum = 0
  let sumSquares = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const value = luma(pixels[i], pixels[i + 1], pixels[i + 2])
    sum += value
    sumSquares += value * value
  }
  const mean = sum / count
  // Population variance, clamped: floating point can land a hair below zero
  // on a perfectly uniform frame, and Math.sqrt of that is NaN.
  const variance = Math.max(0, sumSquares / count - mean * mean)
  return { mean, contrast: Math.sqrt(variance) }
}

/* The thresholds, and the bias behind them.

   Every one of these is set to let a doubtful frame THROUGH. A false
   rejection is the expensive mistake here: it tells somebody holding a real
   photo of a real cat that they are wrong, and there is no way for them to
   argue with it. A false acceptance costs a wrong name on a screen with a
   "not this one" button under it.

   So `dark` requires both darkness AND emptiness. A cat photographed at
   night under a street lamp is genuinely dark, mean luminance in the
   twenties, and it is a perfectly readable photograph: what makes a frame
   unreadable is dark with nothing in it, which is a lens cap or a pocket. */
const DARK_MEAN = 24
const DARK_CONTRAST = 18
/** Below this the frame is one flat tone: a wall, the sky, the ground, a
    blown-out white. Nothing in it to be a cat. */
const FLAT_CONTRAST = 10

export function gradeFrame(stats: FrameStats): Rejection | null {
  if (stats.mean < DARK_MEAN && stats.contrast < DARK_CONTRAST) return 'dark'
  if (stats.contrast < FLAT_CONTRAST) return 'flat'
  return null
}

export const REJECTION_TEXT: Record<Rejection, string> = {
  dark: 'Too dark to read. Try again with more light.',
  flat: 'Nothing to read in that frame. Point it at the cat, not past it.',
}

/** How long a readable frame waits before the honest answer lands. Long
    enough for the sweep animation and one status line to read, short
    enough not to feel like a hang over a message that is, in the end,
    "not yet". A real recogniser will take whatever it takes; the UI cycles
    its status text on its own clock and does not assume this number. */
const MOCK_MS = 900

/* Everything above this line is real. `cats` stays a parameter, unused for
   now, so the real recogniser this becomes does not change this function's
   signature when it arrives — it is the thing that will need the survey to
   score against. */
export async function identify(pixels: Uint8ClampedArray, cats: Cat[]): Promise<IdentifyResult> {
  void cats
  const stats = frameStats(pixels)
  const rejection = gradeFrame(stats)

  /* Rejected frames come back fast and honestly. Making a refusal wait as
     long as the coming-soon answer would be theatre applied to the one
     answer here that is not theatre. */
  if (rejection) return { status: 'no-subject', reason: rejection }

  await new Promise((resolve) => setTimeout(resolve, MOCK_MS))
  return { status: 'coming-soon' }
}
