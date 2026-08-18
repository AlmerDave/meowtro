import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { Grain } from '@/Grain'
import { MapCanvas } from '@/map/MapCanvas'
import { Plate } from '@/plate/Plate'
import { useLenis } from '@/motion/lenis'
import { CatRow } from '@/ui/CatRow'
import { listCats, type Cat } from '@/data/catsRepo'

/* Two pieces of state and props, spec §5: `selectedId`/`hoveredId`, click
   only. Scroll used to drive a per-cat camera pan and stay synced with
   selection, then a plain scroll-to-zoom — both
   removed: the page-scroll zoom fought MapLibre's own native scrollZoom for
   the same wheel gesture (jitter + center drift, since MapLibre folds an
   external jumpTo back into its own easing target). Dragging and scrolling
   the map are native MapLibre interactions now, nothing else touches them.
   Clicking a territory is the only way to open a cat's plate. */

export default function App() {
  const [cats, setCats] = useState<Cat[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useLenis()

  // Async from day one, over a seeded array. See data/catsRepo.ts.
  useEffect(() => {
    let live = true
    listCats().then((loaded) => live && setCats(loaded))
    return () => {
      live = false
    }
  }, [])

  const selected = cats.find((c) => c.id === selectedId) ?? null

  return (
    /* reducedMotion="user" drops transforms for everyone who asked, keeps
       opacity, and does it for every Motion component we ever add. */
    <MotionConfig reducedMotion="user">
      <MapCanvas
        cats={cats}
        selectedId={selectedId}
        onSelect={setSelectedId}
        hoveredId={hoveredId}
        onHover={setHoveredId}
      />
      <Grain />

      <nav className="rail">
        <h1>Meowtro</h1>
        <p>BONIFACIO GLOBAL CITY · {cats.length} RESIDENTS</p>
        {cats.map((cat) => (
          <CatRow
            key={cat.id}
            cat={cat}
            selected={cat.id === selectedId}
            onSelect={() => setSelectedId(cat.id === selectedId ? null : cat.id)}
            onHover={(hovering) => setHoveredId(hovering ? cat.id : null)}
          />
        ))}
      </nav>

      {/* mode="wait": the plates share one fixed slot, so switching cats
          plays A's exit before B enters instead of stacking them. */}
      <AnimatePresence mode="wait">
        {selected && (
          <Plate key={selected.id} cat={selected} onClose={() => setSelectedId(null)} />
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}
