import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Drawer } from 'vaul'
import { ChevronLeft } from 'lucide-react'
import type { Cat } from '@/data/catsRepo'
import { CatRow } from '@/ui/CatRow'
import { Plate } from '@/plate/Plate'
import { springSoft } from '@/motion/springs'

/* The mobile presentation of the rail and the plate, rev 6 §4. Below 900px
   the two stop being independently positioned panels and share one sheet:
   the list at rest, the selected cat's plate on selection, back to the list
   on close.

   vaul rather than a hand-rolled motion/react drag, for one specific
   behaviour rather than general convenience: at the full detent, dragging
   down from inside a scrolled list has to scroll the list, not dismiss the
   sheet, unless the list is already at scrollTop 0. That handoff is where
   hand-rolled sheets break, and it is also where the accessibility work
   lives. See the spec's "Why a dependency" note.

   modal={false} is the load-bearing prop. The map behind stays interactive
   at every detent, which it must: the camera is manual by design (spec rev 6
   §5), so dragging the map is the only way to bring a cat out from under the
   sheet. An overlay would make that impossible, which is also why no
   <Drawer.Overlay> is rendered here.

   dismissible={false} for the same reason: this sheet is furniture, not a
   dialog. There is no state in which it should be gone entirely, because it
   is the only route to the cat index on a phone. */

/* Least visible first, which is the order vaul expects. The peek value is a
   px string rather than a fraction so it stays a constant handle-plus-a-row
   regardless of device height; the other two are fractions of the screen,
   which is what you want for "half" and "most". */
const SNAP_POINTS: (number | string)[] = ['96px', 0.5, 0.92]

type Props = {
  cats: Cat[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onClose: () => void
}

export function CatSheet({ cats, selectedId, onSelect, onHover, onClose }: Props) {
  /* Controlled, because vaul has no uncontrolled option for this: the props
     are activeSnapPoint/setActiveSnapPoint and there is no
     defaultActiveSnapPoint. Opens at the middle detent so the list is
     readable on arrival without burying the map. */
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[1])

  const selected = cats.find((c) => c.id === selectedId) ?? null

  /* Selecting a cat from the peek detent would otherwise open a plate that is
     96px tall. The sheet raises itself to fit what it was just asked to show,
     which is the one place this component gets to move on its own. */
  useEffect(() => {
    if (selected) setSnap(SNAP_POINTS[2])
  }, [selected])

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        {/* aria-describedby={undefined} silences Radix's warning about a
            dialog with no description. There is nothing to describe here
            that the content does not already say, and an invented
            description would be noise in a screen reader, not help. */}
        <Drawer.Content className="cat-sheet" aria-describedby={undefined}>
          <Drawer.Handle className="cat-sheet-handle" />

          {/* Radix needs an accessible name for the dialog. Visually hidden
              because the content below already states what this is on
              screen, but an unnamed dialog is announced as nothing at all. */}
          <Drawer.Title className="cat-sheet-title">
            {selected ? selected.name : 'Cats of Bonifacio Global City'}
          </Drawer.Title>

          {/* The plate has its own close in the hero, but on a phone the
              gesture people reach for is "back to the list", and it belongs
              at the top edge where a thumb already is. */}
          <AnimatePresence initial={false}>
            {selected && (
              <motion.div
                className="cat-sheet-bar"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={springSoft}
              >
                <button type="button" onClick={onClose}>
                  <ChevronLeft size={14} />
                  <span>All cats</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The single scroll container in the sheet. vaul reads scrollTop
              here to decide between scrolling and dragging, so nothing
              inside may scroll on its own: see the .plate override in
              shell.css, which strips the panel's own overflow below this
              breakpoint. */}
          <div className="cat-sheet-body">
            {selected ? (
              <Plate cat={selected} onClose={onClose} />
            ) : (
              cats.map((cat) => (
                <CatRow
                  key={cat.id}
                  cat={cat}
                  // Never marked selected in this list: reaching a selected
                  // state swaps the whole panel to that cat's plate, so a
                  // highlighted row is a state the list cannot be in — and
                  // with no selected row there is nothing for the sliding
                  // marker to sit on either.
                  selected={false}
                  marker={false}
                  onSelect={() => onSelect(cat.id)}
                  onHover={(hovering) => onHover(hovering ? cat.id : null)}
                />
              ))
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
