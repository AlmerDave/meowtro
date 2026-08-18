import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, X } from 'lucide-react'
import type { Cat } from '@/data/catsRepo'
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
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape closes. A panel this size that can only be dismissed by finding
  // one small button is the single most common complaint about card UIs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

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
      <div className="plate-hero">
        <motion.img
          layoutId={`cat-photo-${cat.id}`}
          transition={springSoft}
          className="plate-hero-photo"
          src={cat.photo}
          alt={`${cat.name}, recorded on ${cat.line}`}
          animate={{ opacity: view === 'photo' ? 1 : 0 }}
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
              <Suspense fallback={<span className="plate-hero-loading">Loading specimen</span>}>
                <CatFigure colour={cat.colour} />
              </Suspense>
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
          ref={closeRef}
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

      <motion.div className="plate-body" variants={body} initial="hidden" animate="shown">
        <motion.h2 variants={line}>{cat.name}</motion.h2>
        <motion.p className="plate-sub" variants={line}>
          {cat.description}
        </motion.p>

        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">First recorded</span>
          <span className="plate-value">{cat.firstRecorded}</span>
        </motion.div>
        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">Range</span>
          <span className="plate-value">{cat.range}</span>
        </motion.div>
        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">Disposition</span>
          <span className="plate-value">{cat.disposition}</span>
        </motion.div>
      </motion.div>

      <div className="plate-foot">
        <span>{cat.line}</span>
        {/* Coordinates are the one value here anyone would want out of the
            app, so they are the one value you can take with you. The label
            states what happened, in the past tense of the button that did
            it. clipboard is undefined on insecure origins, hence the guard. */}
        <button
          type="button"
          className="plate-copy"
          onClick={() => navigator.clipboard?.writeText(cat.coordinates).then(() => setCopied(true))}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : cat.coordinates}</span>
        </button>
      </div>
    </motion.article>
  )
}
