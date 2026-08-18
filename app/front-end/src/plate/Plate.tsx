import { Suspense, lazy, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, X } from 'lucide-react'
import type { Cat } from '@/data/catsRepo'
import { FigureBoundary } from '@/plate/FigureBoundary'
import { TerritoryGlyph } from '@/plate/TerritoryGlyph'
import { Specular } from '@/ui/Specular'
import { spring, springSoft } from '@/motion/springs'

/* three.js is ~1.4 MB and nothing needs it until someone asks for the 3D
   view. Lazy import keeps it out of the initial load of a page whose first
   screen is a map. The Photo/3D toggle pushes that one step further: the
   plate opens on the photo, so the chunk is not even requested until the 3D
   tab is pressed. */
const CatFigure = lazy(() =>
  import('@/plate/CatFigure').then((m) => ({ default: m.CatFigure })),
)

/* The specimen plate. Motion owns the enter *and the exit* — the exit
   is the whole reason this library is here (React unmounts a component before
   you can animate it). App.tsx keeps the <AnimatePresence>; this file must
   stay conditionally mounted for the exit to ever run. No CSS transition on
   .plate: two owners of one animation is exactly the class of bug phase 4
   spent a session on.

   The hero photo carries layoutId="cat-photo-<id>", the same id the rail's
   thumbnail carries (ui/CatRow.tsx). That is the one bold move in the
   redesign: the photo is a single object that travels between the two, so the
   card visibly comes from the row you pressed instead of sliding in from
   off-screen with no stated origin.

   It stays mounted (opacity 0) behind the 3D view rather than unmounting,
   because a layoutId with no live element to hand back to has nothing to
   morph into on close. */

type Props = {
  cat: Cat
  onClose: () => void
}

const body = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.045, delayChildren: 0.14 } },
}
const line = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: spring },
}

export function Plate({ cat, onClose }: Props) {
  const [view, setView] = useState<'photo' | 'model'>('photo')
  /* Three states, not a boolean. Copying can genuinely fail, see the
     handler, and a button that silently does nothing is worse than one
     that says so. */
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')

  // Escape closes. A panel this size that can only be dismissed by finding
  // one small button is the single most common complaint about card UIs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 1800)
    return () => clearTimeout(t)
  }, [copyState])

  return (
    <motion.article
      className="plate"
      /* The cat's territory token themes the whole card: the plate number,
         the hero glow, the rules beside each field, the copy button's hover.
         Set once here, read everywhere in CSS. */
      style={{ '--accent': `var(${cat.colour})` } as React.CSSProperties}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      /* Fast, flat exit on purpose. The photo is flying home on its own
         timeline underneath this; a slow card exit would still be on screen
         while it lands, and the two would read as one confused movement. */
      exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
      transition={springSoft}
    >
      <Specular />

      <div className="plate-hero">
        <motion.img
          layoutId={`cat-photo-${cat.id}`}
          transition={springSoft}
          className="plate-hero-photo"
          src={cat.photo}
          alt={`${cat.name}, recorded on ${cat.line}`}
          animate={{ opacity: view === 'photo' ? 1 : 0 }}
          /* Stays mounted at opacity 0 behind the 3D view (see the header
             note on why it may not unmount), so it has to be hidden from a
             screen reader explicitly, otherwise the plate announces a photo
             that is not on screen. */
          aria-hidden={view !== 'photo'}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />

        {/* Mounted only while asked for, so an unopened 3D tab costs nothing.
            Absolutely positioned over the photo rather than replacing it: see
            the header note on why the photo may not unmount. */}
        <AnimatePresence>
          {view === 'model' && (
            <motion.div
              className="plate-hero-model"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* three.js is a megabyte, so this fallback is on screen for a
                  real second or two on a first press, not a frame. It says
                  what is happening and shows that something still is,
                  the same sweep the rail's photo slots use, because it is the
                  same fact being reported. */}
              <FigureBoundary
                fallback={
                  <span className="plate-hero-loading">
                    <span>The 3D view could not load.</span>
                    <button type="button" onClick={() => setView('photo')}>
                      Show the photo
                    </button>
                  </span>
                }
              >
                {/* role="status" so the wait is announced. A visual-only
                    loading state is silence to a screen reader, and this one
                    can run for a second or two. */}
                <Suspense
                  fallback={
                    <span className="plate-hero-loading" role="status">
                      <span className="plate-hero-loading-bar" aria-hidden />
                      <span>Rendering specimen</span>
                    </span>
                  }
                >
                  <CatFigure colour={cat.colour} />
                </Suspense>
              </FigureBoundary>
            </motion.div>
          )}
        </AnimatePresence>

        <span className="plate-number">{cat.plate}</span>

        <div className="plate-views" role="group" aria-label="Specimen view">
          {(['photo', 'model'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="plate-view"
              data-on={String(view === v)}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {/* One pill that slides between the two, rather than two pills
                  crossfading. Safe to share an id: mode="wait" upstream means
                  only one plate is ever mounted. */}
              {view === v && (
                <motion.span layoutId="plate-view-pill" className="plate-view-pill" transition={spring} />
              )}
              <span>{v === 'photo' ? 'Photo' : '3D'}</span>
            </button>
          ))}
        </div>

        <motion.button
          type="button"
          className="plate-close"
          aria-label={`Close ${cat.name}`}
          onClick={onClose}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          transition={spring}
        >
          <X size={16} />
        </motion.button>
      </div>

      <motion.div className="plate-body" data-lenis-prevent variants={body} initial="hidden" animate="shown">
        {/* The survey line used to sit in the footer, below three
            fields nobody scrolls to. It is the second most identifying thing
            about a cat after its name, so it sits above the name now, where
            an eyebrow states which record you have open before you read
            whose it is. */}
        <motion.p className="plate-eyebrow" variants={line}>
          {cat.line}
        </motion.p>
        <motion.h2 variants={line}>{cat.name}</motion.h2>
        <motion.p className="plate-sub" variants={line}>
          {cat.description}
        </motion.p>

        {/* Range is promoted out of the field list and given the glyph,
            because range is the only field whose value is a shape. The other
            two are facts and stay set as facts. */}
        <motion.div className="plate-range" variants={line}>
          <TerritoryGlyph catId={cat.id} delay={0.3} />
          <div className="plate-range-text">
            <span className="plate-label">Range</span>
            <span className="plate-value">{cat.range}</span>
          </div>
        </motion.div>

        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">First recorded</span>
          <span className="plate-value">{cat.firstRecorded}</span>
        </motion.div>
        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">Disposition</span>
          <span className="plate-value">{cat.disposition}</span>
        </motion.div>
      </motion.div>

      <div className="plate-foot">
        {/* Coordinates are the one value here anyone would want out of the
            app, so they are the one value you can take with you. The label
            states what happened, in the past tense of the button that did
            it. clipboard is undefined on insecure origins, hence the guard. */}
        <button
          type="button"
          className="plate-copy"
          data-state={copyState}
          onClick={async () => {
            /* navigator.clipboard is undefined on insecure origins, which
               is exactly how this gets opened on a phone over a LAN IP, and
               writeText can also reject on a denied permission. Both used to
               land as a button that did nothing at all, the second one with
               an unhandled rejection behind it. Now the failure is a state
               the button can show. */
            try {
              await navigator.clipboard.writeText(cat.coordinates)
              setCopyState('done')
            } catch {
              setCopyState('failed')
            }
          }}
        >
          <span className="plate-copy-icon">
            {/* All three glyphs are mounted and crossfaded in place rather
                than swapped, so the button's width never changes under the
                pointer at the moment it is pressed. */}
            <Copy size={12} data-on={String(copyState === 'idle')} />
            <Check size={12} data-on={String(copyState === 'done')} />
            <X size={12} data-on={String(copyState === 'failed')} />
          </span>
          {/* aria-live, because the whole outcome of pressing this button is
              a word change inside it, with nothing announced, a screen
              reader user cannot tell a copy from a failure. */}
          <span className="plate-copy-label" aria-live="polite">
            {copyState === 'done'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Select the text to copy'
                : cat.coordinates}
          </span>
        </button>
      </div>
    </motion.article>
  )
}
