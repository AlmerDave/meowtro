import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker } from 'maplibre-gl'
import type { FeatureCollection, Point, Polygon } from 'geojson'
import { motion } from 'motion/react'
import { useMap } from './MapCanvas'
import { centroidsById } from './centroid'
import type { Cat } from '@/data/catsRepo'
import territories from '@/data/territories.geo.json'

/* Cat markers, backlog item ("3D cat markers on the map"). Two
   representations of the same centroid, swapped on the existing flat/3D
   toggle (MapContext.isFlat) rather than built as one shape that tries to
   serve both:

     flat mode     a hand-authored DOM pin (this file's <CatPin>), placed
                   with maplibregl.Marker so MapLibre owns the position
                   tracking — the same job MapLabels.tsx hand-rolls for
                   text, but Marker already does it, so no reprojection
                   loop is written here.
     pitched mode  a native MapLibre `circle` layer at each centroid,
                   `circle-pitch-alignment: 'map'`. That single paint
                   property is what gives the reference image's
                   ground-tilt/foreshortening look — no three.js.

   The DOM pin needs no theme handling at all — its SVG paints from
   `var(--ink)`/`var(--paper)`/the cat's own colour token, so it repaints
   when :root's data-theme flips, for free. The circle layer is canvas, not
   DOM, so it does not: see `theme` in the layer effect's deps below.

   Neither representation adds its own click listener to the map: in
   pitched mode the ground-plane circle sits over the same FILL geometry a
   centroid lives inside, so Territories.tsx's existing FILL click/hover
   handlers already fire correctly for it. In flat mode the DOM pin has its
   own onClick (below) instead — a maplibregl.Marker's element is appended
   into map.getCanvasContainer(), the same node Territories.tsx's handlers
   are bound to, so without an explicit stopPropagation() a pin click would
   *also* reach those FILL handlers and re-toggle the selection they just
   set (see the stopPropagation() call below). CatMarkers' own effects only
   keep the two visuals in sync with selection state, via feature-state for
   the circle and plain props for the DOM pin. */

const SOURCE = 'territory-centroids'
const CIRCLE = 'territory-dot'

// Static input, computed once at module scope rather than per-render.
const CENTROIDS = centroidsById(territories as FeatureCollection<Polygon>)

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
  selectedId: string | null
  onSelect: (id: string | null) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}

type PinProps = {
  cat: Cat
  active: boolean
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

/** The flat-mode glyph: an ink-outlined teardrop pin in the cat's own
    territory colour, spec-consistent with Territories.tsx's per-cat fill.
    A real <button> for free keyboard focus/activation, not a styled div.

    The scale/lift animation lives on the inner <motion.svg>, not this
    <button> — a button that transforms itself (scale 1.15, y -3 on hover,
    0.95 on tap) moves its own hit-box out from under a stationary cursor
    mid-gesture. On a target this small that made mouseup land on whatever
    was newly underneath (the bare map, most often) instead of the button,
    so the native click fired on that ancestor instead of here and this
    onClick never ran. The button's own box now never moves, only the glyph
    inside it does, so the hit-box the browser is tracking stays put for
    the whole click. */
function CatPin({ cat, active, onClick, onMouseEnter, onMouseLeave }: PinProps) {
  return (
    <button
      type="button"
      className="cat-pin-glyph"
      style={{ color: `var(${cat.colour})` }}
      aria-label={cat.name}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <motion.svg
        width="22"
        height="28"
        viewBox="0 0 22 28"
        fill="none"
        aria-hidden="true"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: active ? 1.15 : 1, opacity: 1 }}
        whileHover={{ scale: 1.15, y: -3 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      >
        <path
          d="M11 27C11 27 20 16.8 20 10.5C20 5.25 16.02 1 11 1C5.98 1 2 5.25 2 10.5C2 16.8 11 27 11 27Z"
          fill="currentColor"
          stroke="var(--ink)"
          strokeWidth="1.2"
        />
        <circle cx="11" cy="10.5" r="3.6" fill="var(--paper)" />
      </motion.svg>
    </button>
  )
}

type DomMarker = { cat: Cat; el: HTMLDivElement }

export function CatMarkers({ cats, selectedId, onSelect, hoveredId, onHover }: Props) {
  const { map, isLoaded, isFlat, theme } = useMap()
  const [domMarkers, setDomMarkers] = useState<DomMarker[]>([])

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
        .filter((cat) => CENTROIDS.has(cat.id))
        .map((cat) => ({
          type: 'Feature',
          properties: { id: cat.id },
          geometry: { type: 'Point', coordinates: CENTROIDS.get(cat.id) as [number, number] },
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
  }, [map, isLoaded, cats, isFlat, theme])

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

  // The flat-mode DOM pins. One maplibregl.Marker per cat; React only owns
  // what's portaled into each Marker's element, never its position.
  useEffect(() => {
    if (!map || !isLoaded || cats.length === 0) return

    const instances = cats
      .filter((cat) => CENTROIDS.has(cat.id))
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
          .setLngLat(CENTROIDS.get(cat.id) as [number, number])
          .addTo(map)
        return { cat, el, marker }
      })

    setDomMarkers(instances.map(({ cat, el }) => ({ cat, el })))

    return () => {
      for (const { marker } of instances) marker.remove()
      setDomMarkers([])
    }
  }, [map, isLoaded, cats])

  // Same swap as the circle layer, the other direction.
  useEffect(() => {
    for (const { el } of domMarkers) el.style.display = isFlat ? '' : 'none'
  }, [domMarkers, isFlat])

  return (
    <>
      {domMarkers.map(({ cat, el }) =>
        createPortal(
          <CatPin
            key={cat.id}
            cat={cat}
            active={cat.id === selectedId || cat.id === hoveredId}
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
