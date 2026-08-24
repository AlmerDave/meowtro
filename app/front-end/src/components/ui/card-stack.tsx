import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'

/* A pile of photographs. Drag, click or arrow the top one away and it goes
   to the back.

   Installed from 21st.dev (motiondotdev/motion-card-stack, the official
   Motion example) and adapted. What changed, and why each change was
   needed rather than preferred:

   - The stylesheet did not come with it. The published source imports
     `./motion-card-stack-utils/index.css`, which the registry payload does
     not contain, so all of this component's styling is ours and lives in
     shell.css against the theme tokens. That is also why nothing here sets
     a colour or a size: the frame is a CSS problem, and a component that
     hard-coded one would only theme in one of the three palettes.

   - The depth maths is re-tuned, and this one was a real defect rather
     than a taste change. The original fades and scales by absolute z-index
     measured against the total, which is correct for the thirteen photos
     it ships with and wrong for the three or four a cat has: at four cards
     its opacity ramp evaluates to 0 for the bottom card and 0.5 for the
     one above it, so a third of the pile is invisible. Depth is counted
     down from the top card here instead, so a stack of three looks like a
     stack of thirteen with ten of them hidden.

   - Advancing is a click and an arrow key as well as a drag. A photograph
     you can only move by dragging it cannot be reached from a keyboard at
     all, and dragging a picture is not an obvious thing to try with a
     mouse. The drag stays: it is the good interaction, it just cannot be
     the only one.

   - Cards are keyed by a caller-supplied id rather than by image URL. Two
     observations can legitimately point at the same photograph, and keying
     on the URL would collapse them into one card.

   Reduced motion is not handled here on purpose. App.tsx wraps the tree in
   <MotionConfig reducedMotion="user">, which drops transforms and keeps
   opacity for every Motion component in the app, this one included. A
   second check here would be a second owner of one decision. */

export type StackCard = {
  /** Stable identity. Not the URL, see above. */
  id: string
  src: string
  /** Read out for the top card only. The rest of the pile is decoration
      and is hidden from the accessibility tree, because "photograph of
      MILO" four times is noise, not information. */
  alt: string
  /** Shown under the stack while this card is on top. */
  caption?: string
}

/** How many cards deep the pile is drawn. Beyond this they are stacked but
    not painted, which is what keeps a long list cheap. */
const VISIBLE = 5

/** How much smaller each card behind the top one sits. */
const DEPTH_SCALE = 0.04

/* Spreads the resting tilt across both directions. sin(index) alone (the
   original) returns 0, 0.84, 0.91, 0.14 for the first four cards, so a
   short stack leans one way and reads as a mistake rather than a pile. */
const TILT_SPREAD = 1.8

/** Fraction of the stack's width a slow drag must cover to advance. A flick
    advances on velocity alone and never reaches this. */
const DRAG_FRACTION = 0.12

function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

function wrap(min: number, max: number, value: number) {
  const range = max - min
  return ((((value - min) % range) + range) % range) + min
}

function Card({
  card,
  index,
  currentIndex,
  total,
  maxRotate,
  minDistance,
  minSpeed,
  bounds,
  onAdvance,
}: {
  card: StackCard
  index: number
  currentIndex: number
  total: number
  maxRotate: number
  minDistance: number
  minSpeed: number
  bounds: React.RefObject<HTMLUListElement | null>
  onAdvance: () => void
}) {
  const restRotate = mix(0, maxRotate, Math.sin(index * TILT_SPREAD))
  const x = useMotionValue(0)
  /* 200 rather than the original's 400: the drag is held near home by the
     elastic constraint below, so the card never travels far enough for a
     400px ramp to produce a visible tilt. */
  const rotate = useTransform(x, [0, 200], [restRotate, restRotate + 10], { clamp: false })

  const offset = wrap(0, total, index - currentIndex)
  const isTop = offset === 0
  const scale = 1 - Math.min(offset, VISIBLE) * DEPTH_SCALE

  /* A drag that ends in a swipe also fires a click. The flag suppresses
     that one, and is cleared a frame later so the next real click is not
     eaten with it. */
  const dragged = useRef(false)

  const onDragEnd = () => {
    const distance = Math.abs(x.get())
    const speed = Math.abs(x.getVelocity())
    if (distance > minDistance || speed > minSpeed) {
      onAdvance()
      /* Snapped home stiffly while the card is on its way to the back of
         the pile, where it is small and behind everything, so the return
         trip is never actually seen. */
      animate(x, 0, { type: 'spring', stiffness: 600, damping: 50 })
    } else {
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 50 })
    }
    requestAnimationFrame(() => {
      dragged.current = false
    })
  }

  return (
    <motion.li
      className="card-stack-item"
      data-top={String(isTop)}
      aria-hidden={!isTop}
      style={{ zIndex: total - offset, rotate, x }}
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{ opacity: offset < VISIBLE ? 1 : 0, scale }}
      whileTap={isTop ? { scale: scale * 0.98 } : undefined}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      drag={isTop ? 'x' : false}
      /* Bounded to the stack's own box, which the original does not do at
         all. The stack sits inside .plate-body, and .plate-body scrolls, so
         a card dragged past the panel edge would put a horizontal scrollbar
         on the record. Constraining to the element rather than to a pixel
         figure is also what keeps this working at any panel width: the
         travel is whatever room the frame leaves, which the stylesheet
         states as a ratio and never as a number.

         Small elasticity rather than none, so the edge of the travel feels
         like resistance instead of a wall, but small enough that the
         overshoot stays inside .plate-body's own padding. */
      dragConstraints={bounds}
      dragElastic={0.1}
      onDragStart={() => {
        dragged.current = true
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (isTop && !dragged.current) onAdvance()
      }}
    >
      <img
        src={card.src}
        alt={isTop ? card.alt : ''}
        draggable={false}
        loading="lazy"
        decoding="async"
        /* Dragging an image is a browser behaviour of its own and it fights
           the gesture. */
        onPointerDown={(event) => event.preventDefault()}
        /* Same fallback as every other photo in the app: the frame stays,
           the picture does not arrive. A frame with nothing in it reads as
           a missing photograph; a broken-image glyph reads as a bug. */
        onError={(event) => {
          event.currentTarget.style.visibility = 'hidden'
        }}
      />
    </motion.li>
  )
}

export function CardStack({
  cards,
  label,
  maxRotate = 5,
  minSpeed = 50,
}: {
  cards: StackCard[]
  /** Names the pile for a screen reader, e.g. "Sightings of MILO". */
  label: string
  maxRotate?: number
  minSpeed?: number
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const stackRef = useRef<HTMLUListElement>(null)
  /* Infinity until measured, so a drag started in the first frame after
     mount falls through to the velocity test rather than advancing on any
     movement at all, which is what a zero threshold would do. */
  const [minDistance, setMinDistance] = useState(Infinity)

  /* Measured from the element rather than the window. The stack is a panel
     component and its width has nothing to do with the viewport's.

     Observed rather than read once, because this panel genuinely resizes
     under a running app: the plate is a fixed-width card above 900px and a
     full-width sheet below it, and App.tsx subscribes to that breakpoint
     specifically so rotating a tablet moves between the two. A threshold
     measured once at mount would be calibrated to the layout the plate was
     opened in, not the one it is being dragged in. ResizeObserver is the
     platform's own answer to this and costs no polling. */
  useEffect(() => {
    const element = stackRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width) setMinDistance(width * DRAG_FRACTION)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (!cards.length) return null

  const step = (by: number) => setCurrentIndex((n) => wrap(0, cards.length, n + by))
  const current = cards[currentIndex]

  return (
    <div className="card-stack-root">
      <ul
        className="card-stack"
        ref={stackRef}
        /* Focusable as one control rather than one per card: the pile has a
           single top card, so it has a single thing to act on. */
        tabIndex={0}
        role="group"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') step(1)
          else if (event.key === 'ArrowLeft') step(-1)
          else return
          event.preventDefault()
        }}
      >
        {cards.map((card, index) => (
          <Card
            key={card.id}
            card={card}
            index={index}
            currentIndex={currentIndex}
            total={cards.length}
            maxRotate={maxRotate}
            minDistance={minDistance}
            minSpeed={minSpeed}
            bounds={stackRef}
            onAdvance={() => step(1)}
          />
        ))}
      </ul>

      {/* aria-live because advancing the pile changes nothing else a screen
          reader would notice: the alt text moves to a different card, but
          nothing announces that it did. */}
      <p className="card-stack-caption" aria-live="polite">
        <span>{current.caption}</span>
        <span className="card-stack-count">
          {currentIndex + 1}/{cards.length}
        </span>
      </p>
    </div>
  )
}
