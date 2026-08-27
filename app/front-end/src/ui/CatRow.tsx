import { motion } from 'motion/react'
import type { Cat } from '@/data/catsRepo'
import { photoAt, THUMB_PX } from '@/data/cats.seed'
import { spring, springSoft } from '@/motion/springs'

/* One row of the cat index. Shared by the desktop rail (ui/Rail.tsx)
   and the mobile sheet (ui/CatSheet.tsx), so the two presentations can never
   drift apart.

   It is a channel strip now: a spine in the cat's own colour down
   the leading edge, then the specimen, then the name, then the plate number
   right-aligned in tabular figures. The spine is the row's whole state
   display, a hairline at rest, thicker and fully saturated on hover, full
   height and solid when selected, which is what lets the row itself stay
   almost undecorated and still report three states legibly.

   A real <button> rather than a styled div, for free keyboard focus and
   activation. motion.button rather than button so press/hover are springs
   under the same MotionConfig as everything else.

   Transform stays entirely in Motion and every other hover effect stays
   entirely in CSS. They must not be split the other way round: Motion writes
   `transform` as an inline style, so a CSS :hover transform on this same
   element would be dead the moment a tap set one.

   Those CSS effects key off `data-hovered`, never `:hover`. The row already
   reports hover upward (onHoverStart -> App's hoveredId) so the map can light
   the matching territory; routing the row's own appearance back through that
   same state buys three things for one attribute:

     - hovering a territory ON THE MAP now highlights its row, which it did
       not before. The wiring was one-way, and a list beside a map that will
       not answer the map is the thing that makes the two read as separate
       apps.
     - one code path instead of a :hover rule and a data rule that have to be
       kept saying the same thing.
     - no (hover: hover) media query needed. :hover sticks on after a touch
       tap; this clears when Motion pairs the leave.

   Two shared-element ids leave this file:

     cat-photo-<id>   the thumbnail. When a plate opens it morphs into the
                      plate's hero, so the row must UNMOUNT its copy while
                      selected — two live elements on one layoutId means
                      Motion adopts the newer and the older is left as a
                      ghost. The empty slot it leaves behind is correct
                      rather than a hole: the specimen is out of the drawer.

     cat-row-active   the sliding marker. Rendered by whichever row owns it,
                      so Motion slides it between rows instead of fading one
                      out and another in. */

type Props = {
  cat: Cat
  selected: boolean
  /** True when this cat is the hovered one anywhere, including from the map.
      Not the same thing as CSS :hover, and the reason there is no :hover rule
      on .cat-row at all; see the note above. */
  hovered?: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
  /** The mobile deck marks the current card by centring it, so a sliding
      marker inside the card would say the same thing twice. */
  marker?: boolean
  /** Whether this row's photo has flown to an open plate.

      Defaults to the desktop rule, selected, in a list that marks
      selection, but the mobile deck needs the two decoupled: swiping
      selects a card without opening anything, and only the expanded cat's
      photo may leave. Getting this wrong is not cosmetic. Two live elements
      on one layoutId means Motion adopts the newer and strands the older as
      a ghost. */
  photoAway?: boolean
}

export function CatRow({
  cat,
  selected,
  hovered = false,
  onSelect,
  onHover,
  marker = true,
  photoAway,
}: Props) {
  const showMarker = selected && marker
  const flown = photoAway ?? showMarker

  return (
    <motion.button
      id={`cat-row-${cat.id}`}
      type="button"
      className="cat-row"
      data-selected={String(selected)}
      data-hovered={String(hovered)}
      /* The cat's own territory token themes its row and, when open, its
         whole plate. Per-cat accent, straight out of the data — no component
         picks a colour. */
      style={{ '--accent': `var(${cat.colour})` } as React.CSSProperties}
      /* No `layout` here on purpose. The wrapper in ui/Rail.tsx owns reflow
         when the filter adds or removes rows; a layout animation on the same
         element that also animates y on hover leaves two writers on one
         transform, and the row jitters when you hover mid-filter. */
      transition={spring}
      /* A lift, not rev 6's sideways nudge. The row is reporting that it can
         be picked up, and the panel it sits in is glass with a real shadow
         under it, so the gesture the material already implies is vertical. */
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.975, y: 0 }}
      onClick={onSelect}
      onHoverStart={() => onHover(true)}
      onHoverEnd={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      {showMarker && (
        <motion.span layoutId="cat-row-active" className="cat-row-active" transition={spring} />
      )}

      {/* Drawn, not a border: a border on the row would have to be there in
          every state and merely change colour, and the thing that reads as
          "this one" is the spine growing, not the spine changing hue. */}
      <span className="cat-row-spine" aria-hidden />

      {/* The slot stays; only the photo travels. Fixed size in CSS so the row
          never reflows — not when the image resolves, not when it fails, not
          when it flies off to the plate. */}
      <span className="cat-row-slot">
        {!flown && (
          <motion.img
            layoutId={`cat-photo-${cat.id}`}
            transition={springSoft}
            className="cat-row-thumb"
            /* The slot is 2.75rem. Asking the host for THUMB_PX square
               rather than the seeded 640x480 is the same call the landing's
               roster chips already make (see photoAt), and it is the single
               largest weight saving available here: twelve rows plus twelve
               map pins were the whole 640x480 set. The pin asks for exactly
               the same size, so the two share one download per cat. */
            src={photoAt(cat.photo, THUMB_PX)}
            /* Decorative: the cat's name is right beside it in text, so
               announcing the photo too would only repeat it. */
            alt=""
            loading="lazy"
            decoding="async"
            /* data-settled drives the slot's loading shimmer, which runs
               until this fires either way (shell.css). Written to the DOM
               rather than held in React state on purpose: it is presentation
               of a browser event, no other component reads it, and three
               rows re-rendering because a photo arrived would invalidate the
               list Motion is mid-stagger on. */
            onLoad={(e) => {
              e.currentTarget.dataset.settled = 'true'
            }}
            /* Hidden rather than left as a broken-image glyph. That is the
               whole offline story: with no network the row degrades to the
               text layout it had before photos existed, not to a damaged
               one, and the slot's own well shows through instead. Settled
               too: a failure is a finished load, and a shimmer that never
               stops claims the photo is still coming. */
            onError={(e) => {
              e.currentTarget.dataset.settled = 'true'
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
        )}
      </span>

      <span className="cat-row-text">
        <span className="cat-row-name">{cat.name}</span>
        <span className="cat-row-line">{cat.line.split(' · ')[0]}</span>
      </span>

      <span className="cat-row-plate">{cat.plate.replace('PLATE ', '')}</span>
    </motion.button>
  )
}
