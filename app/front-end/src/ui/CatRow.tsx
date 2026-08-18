import { motion } from 'motion/react'
import type { Cat } from '@/data/catsRepo'
import { spring, springSoft } from '@/motion/springs'

/* One row of the cat index, rev 7. Shared by the desktop rail (ui/Rail.tsx)
   and the mobile sheet (ui/CatSheet.tsx), so the two presentations can never
   drift apart.

   A real <button> rather than a styled div, for free keyboard focus and
   activation. motion.button rather than button so press/hover are springs
   under the same MotionConfig as everything else.

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
  onSelect: () => void
  onHover: (hovering: boolean) => void
  /** The mobile sheet swaps the whole panel on selection, so a selected row
      is a state its list can never be in and the marker has nothing to mark. */
  marker?: boolean
}

export function CatRow({ cat, selected, onSelect, onHover, marker = true }: Props) {
  const flown = selected && marker

  return (
    <motion.button
      id={`cat-row-${cat.id}`}
      type="button"
      className="cat-row"
      data-selected={String(selected)}
      /* The cat's own territory token themes its row and, when open, its
         whole plate. Per-cat accent, straight out of the data — no component
         picks a colour. */
      style={{ '--accent': `var(${cat.colour})` } as React.CSSProperties}
      /* No `layout` here on purpose. The wrapper in ui/Rail.tsx owns reflow
         when the filter adds or removes rows; a layout animation on the same
         element that also animates x on hover leaves two writers on one
         transform, and the row jitters when you hover mid-filter. */
      transition={spring}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.975 }}
      onClick={onSelect}
      onHoverStart={() => onHover(true)}
      onHoverEnd={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      {flown && (
        <motion.span layoutId="cat-row-active" className="cat-row-active" transition={spring} />
      )}

      {/* The slot stays; only the photo travels. Fixed size in CSS so the row
          never reflows — not when the image resolves, not when it fails, not
          when it flies off to the plate. */}
      <span className="cat-row-slot">
        {!flown && (
          <motion.img
            layoutId={`cat-photo-${cat.id}`}
            transition={springSoft}
            className="cat-row-thumb"
            src={cat.photo}
            /* Decorative: the cat's name is right beside it in text, so
               announcing the photo too would only repeat it. */
            alt=""
            loading="lazy"
            decoding="async"
            /* Hidden rather than left as a broken-image glyph. That is the
               whole offline story: with no network the row degrades to the
               text layout it had before photos existed, not to a damaged
               one, and the slot's own well shows through instead. */
            onError={(e) => {
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
