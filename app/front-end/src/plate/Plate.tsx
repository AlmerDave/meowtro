import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Copy, MapPin, X } from 'lucide-react'
import { listSightings, type Cat } from '@/data/catsRepo'
import { describeWhen } from '@/data/sightings'
import { CardStack, type StackCard } from '@/components/ui/card-stack'
import { TerritoryGlyph } from '@/plate/TerritoryGlyph'
import { Specular } from '@/ui/Specular'
import { useEscape } from '@/ui/escape'
import { spring, springSoft } from '@/motion/springs'

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

   ## The 3D view was removed, and its code was not

   The Photo/3D toggle is gone (user direction, 2026-08-23) and with it the
   only route to plate/CatFigure.tsx, plate/FigureBoundary.tsx and cat.glb.
   Those files are all still here and still work; nothing imports them. Do
   not delete them on the grounds that nothing does, and do not delete the
   .plate-views rules in shell.css either, which are parked for the same
   reason and carry the same note.

   It is also the largest single performance change this file has had: the
   toggle lazy-loaded roughly a megabyte of three.js on first press, and
   with no toggle that chunk is never requested at all.

   The hero photo is now unconditional, which is a simplification rather
   than a loss: it used to stay mounted at opacity 0 underneath the model so
   that its layoutId always had a live element to morph back into on close,
   and with nothing to hide behind, that whole dance goes. */

type Props = {
  cat: Cat
  onClose: () => void
  /** Report having seen this cat. Optional because the plate is a record
      first: it renders perfectly well somewhere that cannot accept a
      sighting, and the button simply is not drawn. */
  onReport?: (catId: string) => void
}

const body = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.045, delayChildren: 0.14 } },
}
const line = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: spring },
}

export function Plate({ cat, onClose, onReport }: Props) {
  /* Three states, not a boolean. Copying can genuinely fail, see the
     handler, and a button that silently does nothing is worse than one
     that says so. */
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')

  /* The photographs on file for this cat.

     Fetched here rather than handed down from App, and that is a choice
     about which request a server will get rather than about convenience.
     A plate is only ever open on one cat, so "the observations of this
     cat" is the query, and loading every sighting of every cat up front to
     then throw nearly all of them away would be an odd shape to hand a
     backend. It also keeps this out of CatDeck, which renders the same
     Plate on mobile and would otherwise have to thread a prop through for
     a component it knows nothing about.

     Empty until it resolves, and empty is a real state rather than a
     loading one: a cat with no photographs renders exactly the same as a
     cat whose photographs have not arrived yet, which is the record minus
     one block. There is nothing to put a spinner on. */
  const [photos, setPhotos] = useState<StackCard[]>([])

  useEffect(() => {
    let live = true
    listSightings(cat.id).then((sightings) => {
      if (!live) return
      setPhotos(
        /* flatMap rather than filter-then-map, so the absent case is
           removed and the type narrows in one pass instead of needing an
           assertion to promise the compiler what the filter already did. */
        sightings.flatMap((sighting) =>
          sighting.photo
            ? [
                {
                  id: sighting.id,
                  src: sighting.photo,
                  alt: `${cat.name}, photographed ${describeWhen(sighting.at)}`,
                  caption: describeWhen(sighting.at),
                },
              ]
            : []
        )
      )
    })
    return () => {
      live = false
    }
  }, [cat.id, cat.name])

  /* Escape closes. A panel this size that can only be dismissed by finding
     one small button is the single most common complaint about card UIs.

     Through the shared stack rather than a window listener of its own. The
     sighting panel this card's own button opens sits on top of it and has
     its own Escape behaviour, and two window listeners meant one press did
     both: the report stepped back out of aiming AND the record it was
     started from closed behind it. See ui/escape.ts. */
  useEscape(true, onClose)

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
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />

        <span className="plate-number">{cat.plate}</span>

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

        {/* First among the fields when there is one, because it is the only
            fact on this card that changes. A visitor reported it (see
            ui/ReportSighting.tsx); everything below is the survey's own
            record and does not move. */}
        {cat.lastSeen && (
          <motion.div className="plate-field" variants={line}>
            <span className="plate-label">Last seen</span>
            <span className="plate-value">{cat.lastSeen}</span>
          </motion.div>
        )}

        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">First recorded</span>
          <span className="plate-value">{cat.firstRecorded}</span>
        </motion.div>
        <motion.div className="plate-field" variants={line}>
          <span className="plate-label">Disposition</span>
          <span className="plate-value">{cat.disposition}</span>
        </motion.div>

        {/* Last, and only when there is one. It is the one field that is a
            sentence rather than a value, so it reads as the observation the
            other fields were the measurements for, and it needs no styling
            of its own: .plate-value already wraps at a readable line height.

            Rendered conditionally rather than as an empty row, see the note
            on Cat.note. An orphaned label with nothing under it reads as
            data that failed to load rather than data that does not exist. */}
        {cat.note && (
          <motion.div className="plate-field" variants={line}>
            <span className="plate-label">Field note</span>
            <span className="plate-value">{cat.note}</span>
          </motion.div>
        )}

        {/* What the survey has actually seen, as opposed to what it wrote
            down about the animal. It sits below the fields and directly
            above the button that adds to it, so the two read as one
            exchange: here is the record of observations, here is how you
            add yours.

            Only when there are photographs. A sighting with no photograph
            is a perfectly good sighting and already shows up in the "Last
            seen" field above; it just has nothing to put in a pile. An
            empty frame under a "Sightings" heading would claim a picture
            failed to load rather than that none was taken. */}
        {photos.length > 0 && (
          <motion.div className="plate-sightings" variants={line}>
            <span className="plate-label">Sightings</span>
            <CardStack cards={photos} label={`Photographs of ${cat.name}`} />
          </motion.div>
        )}

        {/* The one thing a visitor can contribute, offered wherever a cat is
            being read about rather than only inside the "I saw a cat" flow.
            That is the point of putting it here: the rail, a map pin, the
            deck and the scanner all end at this card, so one button covers
            every route instead of each route growing its own.

            Last in the body, after the record rather than inside it: the
            fields above are what the survey knows, and this is a thing to
            do about them. Outlined rather than filled, because the plate is
            a record first and an invitation second. */}
        {onReport && (
          <motion.button
            type="button"
            className="plate-report"
            variants={line}
            onClick={() => onReport(cat.id)}
          >
            <MapPin size={13} />
            I saw {cat.name} here
          </motion.button>
        )}
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
