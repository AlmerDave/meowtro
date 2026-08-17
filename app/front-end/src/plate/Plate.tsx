import { Suspense, lazy } from 'react'
import { motion } from 'motion/react'
import type { Cat } from '@/data/catsRepo'

/* three.js is ~1.4 MB and nothing needs it until a plate opens. Lazy import
   keeps it out of the initial load of a page whose first screen is a map. */
const CatFigure = lazy(() =>
  import('@/plate/CatFigure').then((m) => ({ default: m.CatFigure })),
)

/* The specimen plate, spec §7 / §8.1. Motion owns the enter *and the exit* —
   the exit is the whole reason this library is here (React unmounts a
   component before you can animate it). App.tsx keeps the <AnimatePresence>;
   this file must stay conditionally mounted for the exit to ever run.
   No CSS transition on .plate: two owners of one animation is exactly the
   class of bug phase 4 spent a session on. */

type Props = {
  cat: Cat
  onClose: () => void
}

// 40ms between rows, spec §8.1. dt/dd alternate, so a "row" is two children.
const rows = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.04, delayChildren: 0.12 } },
}
const cell = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0 },
}

export function Plate({ cat, onClose }: Props) {
  return (
    <motion.article
      className="plate"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
    >
      <div className="plate-head">
        <span>{cat.plate}</span>
        <span>{cat.line}</span>
      </div>
      <Suspense fallback={<div className="plate-figure" />}>
        <CatFigure colour={cat.colour} />
      </Suspense>
      <div className="plate-body">
        <h3>{cat.name}</h3>
        <p className="sub">{cat.description}</p>
        <motion.dl variants={rows} initial="hidden" animate="shown">
          <motion.dt variants={cell}>First recorded</motion.dt>
          <motion.dd variants={cell}>{cat.firstRecorded}</motion.dd>
          <motion.dt variants={cell}>Range</motion.dt>
          <motion.dd variants={cell}>{cat.range}</motion.dd>
          <motion.dt variants={cell}>Disposition</motion.dt>
          <motion.dd variants={cell}>{cat.disposition}</motion.dd>
        </motion.dl>
      </div>
      <div className="plate-foot">
        <span>{cat.coordinates}</span>
        <button type="button" onClick={onClose}>
          CLOSE
        </button>
      </div>
    </motion.article>
  )
}
