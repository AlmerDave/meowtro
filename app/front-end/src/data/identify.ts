import type { Cat } from './cats.seed'

/* Identification: "point it at a cat and it tells you which one".

   ## What is real here and what is not

   Real: the frame gate below. It reads the pixels of the photo you took and
   refuses the ones there is nothing to read in, and it does that with
   arithmetic, not with a claim.

   Not real: the match. `identify` returns MILO. There is no model behind it
   and there cannot be one that runs here: telling one cat from another is
   fine-grained re-identification, which needs many labelled photos per
   individual and a trained embedding, and the smallest honest version of
   that is several megabytes of weights this app would have to host.

   ## Why the gate is worth having anyway

   A scanner that answers MILO whatever you point it at answers MILO when
   you point it at a ceiling, and that is the first thing anybody will try.
   The gate means something real is checking, so the part that is pretending
   is not the only part.

   Be precise about what it catches, though, because overstating it would
   put the dishonesty back: it rejects EMPTY frames, not WRONG ones. A wall,
   the sky, the inside of a pocket, a lens cap. It cannot tell a cat from a
   dog or from a chair, and nothing in the UI says it can. Only a model does
   that, and that is the thing this file is shaped to accept later.

   ## The seam

   `identify` is one async function returning one of three shapes. Today it
   is a mock. Tomorrow it is a fetch to a server, or a lazily-loaded
   detector (the pattern plate/CatFigure.tsx already uses for three.js).
   Nothing above it changes, because nothing above it knows: the UI awaits a
   promise and renders a result, which is exactly what it would do against
   a real one.

   The staged delay lives in here rather than in the UI for the same reason.
   Take it out and the UI is already awaiting real work. */

export type Rejection = 'dark' | 'flat'

export type IdentifyResult =
  | { status: 'match'; catId: string; confidence: number }
  /** No cats to match against. Not reachable while three are seeded, but a
      real recogniser returns this whenever nothing scores high enough. */
  | { status: 'unsure' }
  | { status: 'no-subject'; reason: Rejection }

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

/** Roughly how long the mock spends pretending. Long enough to read a line
    of status text, short enough not to be a wait. A real recogniser will
    take whatever it takes; the UI cycles its status text on its own clock
    and does not assume this number. */
const MOCK_MS = 1500

/* The mock. Everything above this line is real.

   MILO by name rather than by position, with a fallback, because "the first
   cat in the list" is a different cat once somebody records one and a
   demo that answers a different name each run is a confusing demo. */
export async function identify(pixels: Uint8ClampedArray, cats: Cat[]): Promise<IdentifyResult> {
  const stats = frameStats(pixels)
  const rejection = gradeFrame(stats)

  /* Rejected frames come back fast and honestly. Making a refusal wait as
     long as a match would be theatre applied to the one answer here that is
     not theatre. */
  if (rejection) return { status: 'no-subject', reason: rejection }

  await new Promise((resolve) => setTimeout(resolve, MOCK_MS))

  const target = cats.find((cat) => cat.id === 'milo') ?? cats[0]
  if (!target) return { status: 'unsure' }

  /* The number is theatre and is labelled as such in the panel. It is tied
     to frame contrast so that two photographs do not report an identical
     figure, which is the detail that makes a fake number look fake.

     The clamp is at 120 rather than at the top of the band. It sat at 60
     once, which is inside the range real photographs actually occupy
     (roughly 30 to 80), so any two ordinary shots saturated it and came
     back with the same figure, which is the exact thing the mapping exists
     to avoid. A ceiling has to sit past the data, not in it.

     Linear, not hashed, so it behaves the way a real score would: similar
     frames read similarly, rather than jumping around. */
  const confidence = 0.86 + Math.min(stats.contrast, 120) / 1200
  return { status: 'match', catId: target.id, confidence }
}
