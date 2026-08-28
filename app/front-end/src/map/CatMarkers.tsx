import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker } from 'maplibre-gl'
import type { FeatureCollection, Point, Polygon } from 'geojson'
import { motion } from 'motion/react'
import { Cat as CatGlyph, Flag } from 'lucide-react'
import { useMap } from './MapCanvas'
import { centroidsById } from './centroid'
import { pendingByCat, type Sighting } from '@/data/sightings'
import { photoAt, THUMB_PX } from '@/data/cats.seed'
import type { Cat } from '@/data/catsRepo'

/* Cat markers. One representation in both modes now, not two.

     the pin     a hand-authored DOM marker (this file's <CatPin>): the cat's
                 photo in an ink-ringed disc on a stake. Placed with
                 maplibregl.Marker so MapLibre owns position tracking, the
                 same job MapLabels.tsx hand-rolls for text but which Marker
                 already does, so no reprojection loop is written here. It
                 needs no theme handling at all: it paints from --ink,
                 --paper and the cat's own colour token, so it repaints when
                 :root's data-theme flips, for free.
     the disc    a native MapLibre `circle` layer at each centroid,
                 `circle-pitch-alignment: 'map'`, pitched mode only. It is
                 the ground the stake lands on, and it carries the
                 selected/hovered/dimmed state. Canvas, not DOM, so it does
                 NOT repaint on a theme flip: see `theme` in the layer
                 effect's deps below.

   Flat mode used to hide the pin and show only the disc, and for a while a
   3D impostor baked from cat.glb stood on that disc instead. Both are gone.
   See CatPin's note for why a rendered cat lost to a photograph.

   Neither the pin nor the disc adds a click listener to the map. The disc
   sits inside the same FILL geometry its centroid lives in, so Territories'
   handlers already fire for it. The pin has its own onClick instead: a
   maplibregl.Marker's element is appended into map.getCanvasContainer(), the
   same node Territories binds to, so without an explicit stopPropagation a
   pin click would also reach those FILL handlers and re-toggle the selection
   it had just set. Stopped at the pin, before it reaches that container,
   because MapLibre's listener sits closer to the target and fires first. */

const SOURCE = 'territory-centroids'
const CIRCLE = 'territory-dot'

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** selected / hovered / dimmed / resting. No hidden/pre-reveal state like
    Territories' byState — markers are the always-visible wayfinding layer
    the design settled on, not the ambient-by-default territory shapes. */
const byState = <T,>(selected: T, hovered: T, dimmed: T, resting: T) => [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  selected,
  ['boolean', ['feature-state', 'hovered'], false],
  hovered,
  ['boolean', ['feature-state', 'dimmed'], false],
  dimmed,
  resting,
]

type Props = {
  cats: Cat[]
  /* Passed in rather than imported. See the note by `centroids` below. */
  territories: FeatureCollection<Polygon>
  /* The whole sightings log, fetched once by App.tsx alongside cats and
     territories rather than read out of localStorage from in here: see
     the pendingByCat call below for why the fetch had to move up a level. */
  sightings: Sighting[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
  /** The signed-in visitor's own uid, or null while signed out. Gates the
      pulsing "open report" badge below alongside `admin`: `sightings` is
      already `listVisibleSightings(uid)` (App.tsx), so a signed-out
      visitor's copy of it carries no pending rows and the badge stays
      correctly dark for them without any extra filtering here.

      2026-08-28: widened from admin-only. The original reasoning (the map
      stays an admin-only surface for this feature end to end) stopped
      matching the rest of the app the moment map/Territories.tsx's ghost
      territory opened the same "a report is open here" fact to every
      visitor (see that file's own 2026-08-26 note) — that shape is a
      strictly more revealing hint than this badge's plain boolean, so
      leaving only the badge behind the admin gate was inconsistent, not
      safer. Corroboration (any signed-in visitor may vote on any open
      report, sightings.ts's own note) needs a way for a visitor to
      discover a report exists at all; this is that way. */
  uid: string | null
  /** Whether this visitor is holding the admin gate open (App.tsx's
      useAdmin). Still distinct from `uid` above: an admin sees the same
      badge a signed-in visitor does, but CatPin's label names the verdict
      action only an admin actually has. */
  admin?: boolean
}

type PinProps = {
  cat: Cat
  active: boolean
  /** Pitched mode: the stake grows so the pin clears low buildings. */
  lifted: boolean
  /** This cat has at least one sighting waiting on a verdict. */
  pending: boolean
  /** Only changes the pending label below: an admin can act on a report
      (approve/discard, in the review queue), a visitor can only vote on
      one, so the two get told a different thing about the same badge. */
  admin: boolean
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

/* The marker: the cat's own photo in an ink-ringed disc, on a stake, over
   the ground point.

   ## Why a photo and not a rendered cat

   This replaced a 3D impostor of cat.glb, baked from three.js and drawn as
   a turning sprite. That failed for a reason no amount of tuning its size or
   height was going to fix: the basemap is an abstract grey drawing, flat
   extrusions and hairline roads, and a toon-shaded model with a light source
   and a cast shadow is a rendered object. A rendered object inside a diagram
   makes both of them look like mistakes.

   A photo disc is a diagram element. It reads unambiguously as UI sitting
   over the map rather than as a thing standing in it, which is also what
   makes overlapping a tower correct here instead of looking embedded. And it
   answers a question the model never could: not "a cat lives here" but
   "MILO lives here", legible from across the map.

   It also completes a rhyme the app was already halfway through. The same
   photo is the rail row's thumbnail, the map pin, and the plate's hero.
   One object, three places.

   ## The stake

   A hairline down to the ground point, because a disc floating with nothing
   under it has no stated location. The stake is the connector, and it is why
   the pin can be lifted at all. Deliberately a fixed pixel height rather
   than something that tracks building height with zoom: a DOM marker holds
   its screen size anyway, and the impostor's attempt to track the skyline
   was what dragged in MapLibre's integer-zoom layout stepping. Overlapping
   a building is now a non-problem, so there is nothing left to chase.

   ## Fallback

   No photo, a photo that failed, or a photo still in flight: all three
   show lucide's cat glyph in linework underneath, with the photo itself
   fading in over it once it actually resolves. Both sit in the same grid
   cell (.cat-pin-head is a single-cell grid, so stacking is DOM order, no
   absolute positioning needed) so the glyph reads through the photo's
   `<img>` for exactly as long as that image is transparent. That is the
   offline story the rest of the app already tells: with no network this
   degrades to the drawing it would have been before photos existed, not
   to a broken image or a blank disc while waiting.

   A real <button> for free keyboard focus and activation, not a styled div.

   The scale animation lives on the inner head, never on this <button>, and
   that is load-bearing rather than tidy. A button that transforms itself
   moves its own hit-box out from under a stationary cursor mid-gesture; on a
   target this small that made mouseup land on the bare map instead, so the
   native click fired on an ancestor and onClick never ran. The button box
   never moves. Only what is inside it does. */
function CatPin({ cat, active, lifted, pending, admin, onClick, onMouseEnter, onMouseLeave }: PinProps) {
  /* null while the photo is still in flight, so the glyph is not flashed up
     and then replaced a moment later on every marker at once. */
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null)

  /* The same URL the <img> below renders, and the same one ui/CatRow.tsx
     asks for, so the probe, the pin and the row are one download per cat
     rather than three. Computed here rather than passed in for that reason:
     a probe pointed at a different URL from the element it is probing is
     both a wasted request and an answer about the wrong file. */
  const photo = photoAt(cat.photo, THUMB_PX)

  useEffect(() => {
    let live = true
    const img = new Image()
    img.onload = () => live && setHasPhoto(true)
    img.onerror = () => live && setHasPhoto(false)
    img.src = photo
    return () => {
      live = false
    }
  }, [photo])

  return (
    <button
      type="button"
      className="cat-pin"
      data-active={String(active)}
      data-lifted={String(lifted)}
      data-pending={String(pending)}
      /* The cat's own territory token themes the whole marker, straight out
         of the data, exactly as the rail row and the plate do. */
      style={{ '--accent': `var(${cat.colour})` } as React.CSSProperties}
      aria-label={
        pending
          ? admin
            ? `${cat.name}, a sighting is awaiting review`
            : `${cat.name}, an open sighting needs confirming`
          : cat.name
      }
      onClick={onClick}
      /* Pointer events with a type check, not onMouseEnter/onMouseLeave. A
         touch tap synthesises a mouseenter but does not reliably synthesise
         the matching mouseleave, tap a pin, then pan the map, and the
         hover never clears. That used to be invisible; now that hover also
         drives the rail's row highlight and the deck card's fill, it strands
         a cat looking hovered forever. */
      onPointerEnter={(e) => e.pointerType === 'mouse' && onMouseEnter()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onMouseLeave()}
    >
      {/* One glyph, not the check/cross pair this used to be: at any real
          count of cats, two icons per pending pin reads as a puddle of
          circles rather than a flag (the admin's own review of this
          screen). Decorative either way — the actual approve/reject
          buttons live inside the plate this pin opens. */}
      {pending && (
        <span className="cat-pin-pending" aria-hidden>
          <Flag size={9} strokeWidth={2.5} />
        </span>
      )}
      <motion.span
        className="cat-pin-head"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: active ? 1.16 : 1, opacity: 1 }}
        whileHover={{ scale: 1.16 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      >
        <CatGlyph className="cat-pin-fallback" strokeWidth={1.8} aria-hidden />
        <img className="cat-pin-photo" src={photo} alt="" data-ready={String(!!hasPhoto)} />
      </motion.span>

      <span className="cat-pin-stake" aria-hidden />
      {/* Only while it is the one you are looking at: fifty plate numbers
          permanently on the map is a legend, not a map. */}
      <span className="cat-pin-plate" aria-hidden>
        {cat.plate.replace('PLATE ', '')}
      </span>
    </button>
  )
}

type DomMarker = { cat: Cat; el: HTMLDivElement }

export function CatMarkers({
  cats,
  territories,
  sightings,
  selectedId,
  onSelect,
  hoveredId,
  onHover,
  uid,
  admin = false,
}: Props) {
  /* Was a module-level const off a static JSON import, which was right
     while the only cats were the seeded three. A recorded cat (data/
     localCats.ts) arrives after this module has evaluated, so the map has
     to be recomputed from whatever the repo hands down rather than from
     what was on disk at build time. Memoised on identity: the repo returns
     a new object only when the data actually changed. */
  const centroids = useMemo(() => centroidsById(territories), [territories])

  const { map, isLoaded, isFlat, theme } = useMap()
  const [domMarkers, setDomMarkers] = useState<DomMarker[]>([])

  /* Read plainly at render time, not in an effect: it is a cheap pass over
     an already-fetched array (the `sightings` prop, App.tsx's own
     Promise.all), not a canvas paint, and this component already
     re-renders whenever `cats`/`territories`/`sightings` change, which is
     exactly the signal every action that adds, decides or withdraws a
     report already produces (App.tsx's onRecorded/onChanged cascade
     refetches all three together). Cheaper than the localStorage scan this
     replaced, and still correctly re-run on the same trigger. A vote alone
     does not touch this set: see data/sightings.ts's pendingByCat for why
     a tally never changes who is in it. */
  const pending = admin || uid ? pendingByCat(sightings) : null

  // The pitched-mode circle layer. isFlat is deliberately in this effect's
  // deps, 2026-08-17 — reverted from a split "create once, toggle visibility
  // in a separate effect" design: that left a window where the toggle
  // effect could run against a layer this effect hadn't added yet (or had
  // already torn down), and `setLayoutProperty` on a missing layer doesn't
  // throw — it fires an internal error event nothing here listens for, so
  // the desync was silent. Recreating a 3-point source on a toggle click is
  // free; the correctness this buys isn't.
  //
  // `theme` rides in the same deps for the same reason: every paint value
  // below is a token read at build time, so a theme flip has to rebuild
  // them. Territories.tsx uses a separate setPaintProperty effect instead of
  // rebuilding, because its layers are expensive to re-add and it has no
  // isFlat teardown to piggyback on; this one already tears down on a
  // toggle, so reusing that path is one word instead of a second effect.
  useEffect(() => {
    if (!map || !isLoaded || cats.length === 0) return

    const points: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: cats
        .filter((cat) => centroids.has(cat.id))
        .map((cat) => ({
          type: 'Feature',
          properties: { id: cat.id },
          geometry: { type: 'Point', coordinates: centroids.get(cat.id) as [number, number] },
        })),
    }

    map.addSource(SOURCE, { type: 'geojson', data: points, promoteId: 'id' })

    const colourByCat: (string | string[])[] = ['match', ['get', 'id']]
    for (const cat of cats) colourByCat.push(cat.id, token(cat.colour))
    colourByCat.push(token('--ink-soft')) // fallback for an unseeded point

    map.addLayer({
      id: CIRCLE,
      type: 'circle',
      source: SOURCE,
      layout: { visibility: isFlat ? 'none' : 'visible' },
      paint: {
        'circle-color': colourByCat as never,
        'circle-radius': byState(9, 8, 4, 6) as never,
        'circle-opacity': byState(0.95, 0.85, 0.35, 0.75) as never,
        'circle-stroke-width': byState(2, 1.5, 0, 1) as never,
        'circle-stroke-color': token('--rust'),
        // The reference image's ground-tilt look: a flat disc lying on the
        // terrain, foreshortened by the pitched camera, not a billboard
        // that always faces the viewer.
        'circle-pitch-alignment': 'map',
        'circle-opacity-transition': { duration: parseFloat(token('--dur-micro')) },
        'circle-radius-transition': { duration: parseFloat(token('--dur-micro')) },
      },
    })

    return () => {
      if (map.getLayer(CIRCLE)) map.removeLayer(CIRCLE)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    }
  }, [map, isLoaded, cats, territories, centroids, isFlat, theme])

  // Mirror selection onto the centroid source's own feature-state: it is a
  // different (source, id) pair from Territories.tsx's polygon sources, so
  // MapLibre tracks it separately even though the ids match. Also re-applied
  // whenever isFlat or theme changes, since the effect above just rebuilt the
  // source from scratch (a fresh source starts with no feature-state at all).
  useEffect(() => {
    if (!map || !isLoaded || !map.getSource(SOURCE)) return
    for (const cat of cats) {
      map.setFeatureState(
        { source: SOURCE, id: cat.id },
        {
          selected: cat.id === selectedId,
          hovered: cat.id === hoveredId && cat.id !== selectedId,
          dimmed: selectedId !== null && cat.id !== selectedId,
        }
      )
    }
  }, [map, isLoaded, cats, selectedId, hoveredId, isFlat, theme])

  /* The DOM pins, in both modes. Note the deps: isFlat is deliberately NOT
     among them, because the toggle no longer changes which marker exists,
     only how tall its stake is, and that is a prop CatPin reads. Rebuilding
     every Marker on a camera toggle would tear down and re-portal the whole
     set for a CSS height change.

     One maplibregl.Marker per cat; React only owns what is portalled into
     each Marker's element, never its position. */
  useEffect(() => {
    if (!map || !isLoaded || cats.length === 0) return

    const instances = cats
      .filter((cat) => centroids.has(cat.id))
      .map((cat) => {
        const el = document.createElement('div')
        // maplibregl.Marker appends el into map.getCanvasContainer() — the
        // same element MapLibre's own click handling listens on — so a pin
        // click bubbles into MapLibre's pipeline too, re-firing Territories'
        // FILL click handlers (including the bare-paper-clears-selection
        // one) right after this pin's own onClick already set selection.
        // Stopped here, before it reaches that container, not in the pin's
        // onClick, since MapLibre's listener sits closer to the target and
        // fires first.
        el.addEventListener('click', (e) => e.stopPropagation())
        const marker = new Marker({ element: el, anchor: 'bottom' })
          .setLngLat(centroids.get(cat.id) as [number, number])
          .addTo(map)
        return { cat, el, marker }
      })

    setDomMarkers(instances.map(({ cat, el }) => ({ cat, el })))

    return () => {
      for (const { marker } of instances) marker.remove()
      setDomMarkers([])
    }
  }, [map, isLoaded, cats, centroids])

  /* No swap any more. The pin is the marker in both modes, and the flat/3D
     toggle only changes how tall its stake is, which CatPin reads from its
     `lifted` prop. The circle layer above stays pitched-only, where it is
     the ground the stake lands on.

     This used to hide every pin whenever the camera was pitched, which is
     what the whole two-representation design rested on. */

  return (
    <>
      {domMarkers.map(({ cat, el }) =>
        createPortal(
          <CatPin
            key={cat.id}
            cat={cat}
            active={cat.id === selectedId || cat.id === hoveredId}
            lifted={!isFlat}
            pending={pending?.has(cat.id) ?? false}
            admin={admin}
            onClick={() => onSelect(cat.id === selectedId ? null : cat.id)}
            onMouseEnter={() => onHover(cat.id)}
            onMouseLeave={() => onHover(null)}
          />,
          el,
          cat.id
        )
      )}
    </>
  )
}
