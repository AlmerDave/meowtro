import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { Grain } from '@/Grain'
import { MapCanvas } from '@/map/MapCanvas'
import { Plate } from '@/plate/Plate'
import { useLenis } from '@/motion/lenis'
import { springSoft } from '@/motion/springs'
import { Rail } from '@/ui/Rail'
import { CatDeck } from '@/ui/CatDeck'
import { listCats, type Cat } from '@/data/catsRepo'

/* 900px, rev 6 §4: the rail is 15rem and the plate 26.25rem, so with gutters
   the two collide somewhere just above 700px. 900 leaves margin rather than
   switching at the exact width where it breaks.

   Width alone, deliberately. `(pointer: coarse)` was added here and then
   taken back out: it does describe the input better, but it also overrode
   Chrome's "Desktop site" on a phone, which is a mode someone turns on
   precisely because they want the wide layout. Honouring the input device
   over an explicit request for the desktop layout is second-guessing the
   person using it, and the wide layout at that width is a real layout the
   app supports, not a mistake to be corrected.

   The practical consequence is worth knowing: Desktop site reports a ~980px
   layout viewport scaled down to the physical screen, so the desktop rail
   arrives correct but small. That is what the mode does to every site.

   Subscribed rather than read once, so rotating a tablet moves between the
   two presentations instead of stranding it in whichever one it loaded in. */
const MOBILE_QUERY = '(max-width: 900px)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

/* Two pieces of state and props, spec §5: `selectedId`/`hoveredId`, click
   only. Scroll used to drive a per-cat camera pan and stay synced with
   selection, then a plain scroll-to-zoom — both removed: the page-scroll zoom
   fought MapLibre's own native scrollZoom for the same wheel gesture (jitter
   + center drift, since MapLibre folds an external jumpTo back into its own
   easing target). Dragging and scrolling the map are native MapLibre
   interactions now, nothing else touches them. Clicking a territory or a rail
   row is the only way to open a cat's plate. */

export default function App() {
  const [cats, setCats] = useState<Cat[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const isMobile = useIsMobile()

  useLenis()

  // Async from day one, over a seeded array. See data/catsRepo.ts.
  useEffect(() => {
    let live = true
    listCats().then((loaded) => live && setCats(loaded))
    return () => {
      live = false
    }
  }, [])

  /* Closing returns focus to the row that opened the plate, not to the top of
     the document. Queried rather than threaded through a ref chain: the row
     may be in the rail or in the sheet, and the id is the one thing both
     presentations agree on. */
  const close = useCallback(() => {
    const id = selectedId
    setSelectedId(null)
    if (id) requestAnimationFrame(() => document.getElementById(`cat-row-${id}`)?.focus())
  }, [selectedId])

  const selected = cats.find((c) => c.id === selectedId) ?? null

  return (
    /* reducedMotion="user" drops transforms for everyone who asked, keeps
       opacity, and does it for every Motion component we ever add — including
       the layout animations, which is what makes the shared-element morph
       safe to use as the app's signature moment.

       One default transition for the whole tree, so a component that does not
       name a spring still gets the app's feel rather than Motion's stock
       ease. */
    <MotionConfig reducedMotion="user" transition={springSoft}>
      <MapCanvas
        cats={cats}
        selectedId={selectedId}
        onSelect={setSelectedId}
        hoveredId={hoveredId}
        onHover={setHoveredId}
      />
      <Grain />

      {/* A deck of cards on the map below the breakpoint, two floating
          panels above it. The same CatRow and the same Plate render in
          both, so this is a presentation switch, not a second
          implementation.

          CatDeck takes no onClose: opening a plate is a mobile-only state
          it keeps to itself (see the note there), so there is nothing here
          for it to close. */}
      {isMobile ? (
        <CatDeck
          cats={cats}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
        />
      ) : (
        <>
          <Rail
            cats={cats}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onHover={setHoveredId}
          />

          {/* mode="wait": the plates share one fixed slot, so switching cats
              plays A's exit before B enters instead of stacking them. It is
              also what lets Plate reuse a single layoutId for its view pill —
              two mounted plates would fight over it. */}
          <AnimatePresence mode="wait">
            {selected && <Plate key={selected.id} cat={selected} onClose={close} />}
          </AnimatePresence>
        </>
      )}
    </MotionConfig>
  )
}
