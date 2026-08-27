import { useEffect, useState } from 'react'
import { photoAt, THUMB_PX } from '@/data/cats.seed'
import { motion } from 'motion/react'
import type { Cat } from '@/data/catsRepo'
import { LoadingCube } from '@/ui/LoadingCube'

/* The loading screen. Holds the app until there is something worth showing,
   then peels off the top to reveal it.

   ## The reveal is borrowed, the timing is not

   The exit is the curtain technique from the "Preloader" component on
   21st.dev (@info-mdshakeeb): an SVG path whose bottom edge is a downward
   bulge, flattened first and then slid off the top, so the sheet reads as a
   sheet of paper being lifted rather than a div fading out.

   Only that technique was taken, deliberately. The original is a fixed
   two-and-a-half second timeline of setTimeouts that never observes
   anything: it is an animation dressed as a loader. Everything below the
   variants is this app's own, because the entire point of a loading screen
   is that it ends when the thing has loaded.

   ## What "loaded" means here

   Three real signals and two escape hatches:

     map painted   MapCanvas' onReady, fired on the map's `idle` event.
                   `load` would not do: it means the style parsed, and a
                   parsed style can still be a blank viewport.
     cats resolved data/catsRepo is async by design.
     photos in     so the rail's rows do not shimmer in a beat after the
                   reveal, which would undo the reveal. Only the first
                   handful, see WAIT_FOR_PHOTOS.

     MIN_MS        a floor, so a warm cache flashes a sheet of paper at you
                   for 80ms instead of just appearing to stutter.
     MAX_MS        a ceiling, and the important one. The photos come from a
                   third-party host and the tiles are 10MB; without this,
                   one slow asset holds the whole app hostage forever. The
                   app is perfectly usable with a photo still in flight, so
                   past this we stop waiting and let it arrive late. */

/** Shortest time the sheet stays up.

    It was raised to 2000 when the mark was a cube, because at 600ms you saw
    about a fifth of one revolution, which does not read as a cube at all.
    The cat has no revolution to complete: it is legible in the first frame
    and everything after that is it breathing. 1400 is two tail sweeps and a
    blink, which is enough to register as a thing that is alive rather than
    a picture, and 600ms cheaper than the cube needed.

    This is the number to turn if it starts feeling like a toll rather than
    a title card. */
const MIN_MS = 1400

/** Longest. After this the app opens regardless of what has not arrived. */
const MAX_MS = 8000

/** How many photos the reveal actually waits for.

    It used to be all of them, which was right for three cats and gets worse
    with every one added: at fifty, from a third-party host, the app would
    hit the MAX_MS ceiling on nearly every cold load and the ceiling would
    stop being a safety net and start being the normal path.

    Six is roughly what the rail shows before you scroll it. The point of
    waiting at all is that the visible rows do not shimmer in a beat after
    the reveal; rows you cannot see yet are free to arrive late, because
    CatRow already fades each photo in as it lands. */
const WAIT_FOR_PHOTOS = 6

/** How far the curtain's bulge hangs below the fold, in px. */
const BULGE = 300

type Props = {
  cats: Cat[]
  /** MapCanvas has painted. */
  mapReady: boolean
  /** Called after the sheet has finished leaving, not when it starts. */
  onDone: () => void
}

export function Loading({ cats, mapReady, onDone }: Props) {
  /* Measured in the initialiser, not in the effect. Starting at zero meant
     one frame where the curtain had no dimensions and this returned null,
     which is a frame of half-drawn map flashing past before the sheet that
     is supposed to be hiding it appears. There is no SSR here, so window is
     always available on first render. */
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const [photosReady, setPhotosReady] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  const [expired, setExpired] = useState(false)
  const [exiting, setExiting] = useState(false)

  /* Measured, not assumed, and re-measured on resize: the curtain's path is
     in pixels, so a device rotated mid-load would otherwise tear a hole in
     the sheet where the viewport grew. */
  useEffect(() => {
    const measure = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const floor = setTimeout(() => setMinElapsed(true), MIN_MS)
    const ceiling = setTimeout(() => setExpired(true), MAX_MS)
    return () => {
      clearTimeout(floor)
      clearTimeout(ceiling)
    }
  }, [])

  /* Preloaded through the cache rather than by rendering them: the browser
     dedupes by URL, so the <img> in each row resolves instantly from this.

     onerror counts as done on purpose. A photo that failed is a photo that
     has finished loading, and CatRow already degrades to a text row when one
     does. Waiting on it would be waiting for something that is never
     coming. */
  useEffect(() => {
    if (!cats.length) return
    const wanted = cats.slice(0, WAIT_FOR_PHOTOS)
    let live = true
    let settled = 0
    const done = () => {
      if (live && ++settled >= wanted.length) setPhotosReady(true)
    }
    for (const cat of wanted) {
      const img = new Image()
      img.onload = done
      img.onerror = done
      /* The thumbnail URL, not the seeded one. This preload exists so the
         first rows resolve out of cache instead of visibly filling in after
         the curtain lifts, and a row now renders photoAt(_, THUMB_PX)
         (ui/CatRow.tsx). Warming 640x480 would warm a file nothing on the
         first screen asks for and leave the rows to fetch theirs anyway,
         which is the reveal this component exists to prevent. */
      img.src = photoAt(cat.photo, THUMB_PX)
    }
    return () => {
      live = false
    }
  }, [cats])

  /* A survey with no cats in it has no photos to wait for, and treating an
     empty list as "not loaded yet" would park it behind the 8 second ceiling
     for nothing. The map is the app; cats are its contents. */
  const photosSettled = cats.length === 0 || photosReady
  const ready = expired || (mapReady && photosSettled && minElapsed)

  useEffect(() => {
    if (ready) setExiting(true)
  }, [ready])

  /* The whole app is behind onAnimationComplete, which makes one Motion
     callback a single point of failure for the page ever appearing. An
     animation that is interrupted, or a transition the browser optimises
     away, would leave the sheet up forever with nothing underneath it
     reachable.

     So the exit gets its own deadline: comfortably longer than the 0.25s
     delay plus the 0.8s slide, short enough that a failure is a hitch rather
     than a hang. onDone is idempotent, it only sets a flag, so whichever of
     the two arrives first is fine. */
  useEffect(() => {
    if (!exiting) return
    const failsafe = setTimeout(onDone, 1600)
    return () => clearTimeout(failsafe)
  }, [exiting, onDone])

  /* Two paths over the same rectangle: one with a bulge hanging below the
     fold, one with a flat bottom edge. Morphing between them is what makes
     the sheet look like it has weight as it is lifted. */
  const curved = `M0 0 L${size.width} 0 L${size.width} ${size.height} Q${size.width / 2} ${
    size.height + BULGE
  } 0 ${size.height} L0 0`
  const flat = `M0 0 L${size.width} 0 L${size.width} ${size.height} Q${size.width / 2} ${
    size.height
  } 0 ${size.height} L0 0`

  const label = exiting
    ? 'Survey open'
    : mapReady
      ? 'Reading the survey'
      : 'Surveying Bonifacio Global City'

  return (
    <motion.div
      className="loading"
      data-exiting={String(exiting)}
      initial={{ y: 0 }}
      animate={exiting ? { y: '-100%', opacity: 0 } : { y: 0, opacity: 1 }}
      /* y for the lift, opacity so the same exit still reads as an exit for
         anyone on reduced motion, where MotionConfig drops the transform and
         keeps the fade. Without it they would get a hard cut.

         Percentage translate rather than the source's `top: -100vh`: this is
         a transform, so it composites, and 100% of its own height is correct
         on a mobile browser whose vh does not match its visible viewport. */
      transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1], delay: exiting ? 0.25 : 0 }}
      onAnimationComplete={() => exiting && onDone()}
      /* The sheet is over everything, so it has to be announced or a screen
         reader is handed an app that is not there yet.

         No aria-label here, deliberately: a label would override the region's
         own text, and a live region announces changes to its CONTENT. Naming
         it would have left it announcing nothing when the phase changed,
         which is the only thing here worth announcing. */
      role="status"
      aria-live="polite"
    >
      <div className="loading-mark">
        {/* The mark. Two other animations were tried here and both were
            reverted (user direction, 2026-08-23): a hand-drawn SVG cat, and
            the real illustrated Lottie now sitting unused in public/
            (cat-loading.json, dotlottie-player.wasm) with @lottiefiles/
            dotlottie-react removed from package.json. The cube is what the
            loading screen has actually shipped with; see LoadingCube.tsx
            for why it looks the way it does. */}
        <LoadingCube />
        <span className="loading-word">
          Meowtro
          <span className="rail-live" aria-hidden />
        </span>
        <span className="loading-label">{label}</span>
        <span className="loading-bar" aria-hidden />
      </div>

      {/* The curtain itself. Taller than the viewport by exactly the bulge,
          so the curve has somewhere to hang. */}
      <svg className="loading-curtain" aria-hidden>
        <motion.path
          fill="var(--loading-bg)"
          initial={{ d: curved }}
          animate={{ d: exiting ? flat : curved }}
          transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
        />
      </svg>
    </motion.div>
  )
}
