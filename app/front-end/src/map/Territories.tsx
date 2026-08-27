import { useEffect, useMemo, useRef } from 'react'
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'
import { useMap } from './MapCanvas'
import { centroidsById } from './centroid'
import {
  distanceM,
  isOwnPending,
  isSurveyed,
  pendingByCat,
  ringRadiusM,
  translateToward,
  type Sighting,
} from '@/data/sightings'
import type { Cat } from '@/data/catsRepo'

/* The territory layers, spec §6 (rev: circles, shaded rather than hatched).
   Hand-authored rather than installed: the shapes are the argument this whole
   project is making, so they do not come out of a registry.

   Three layers over two sources:
     fill   the cat's colour
     line   dashed ink boundary
     glow   selection-only blurred circle on a centroid source — deliberately
            NOT feature-state, see the GLOW_RADIUS_SELECTED comment below.

   fill/line are invisible at rest, 2026-08-17: CatMarkers.tsx's pin/dot is
   the always-visible "where are the cats" layer, so this circle only needs
   to exist as a hover/click payoff — it draws in on hover, full-strength on
   selection, and disappears the instant neither is true for that cat.
   Before markers existed this stayed faintly shaded at rest so the map read
   as "cats live here" on its own; that job belongs to the pins now.

   fill/line selection is `feature-state`, never a layer rebuild: `selected`/
   `hovered`/`dimmed`/`revealed` booleans per feature (see `byState` below). */

const SOURCE = 'territories'
const FILL = 'territory-fill'
const LINE = 'territory-line'
/* Its own centroid source, not CatMarkers' 'territory-centroids', even
   though both hold the same three points: CatMarkers tears its source down
   and rebuilds it on every flat/3D toggle, and sharing one would put this
   layer's glow at the mercy of that lifecycle for no gain. Two geojson
   sources of three points each cost nothing. */
const GLOW_SOURCE = 'territory-glow-centroids'
const GLOW = 'territory-glow'
/* The pending ghost, phase 9. Its own source/pair of layers, see the effect
   below. */
const GHOST_SOURCE = 'territory-ghost'
const GHOST_FILL = 'territory-ghost-fill'
const GHOST_LINE = 'territory-ghost-line'

/* --- Habitat pings -----------------------------------------------------
   Where a cat is found, said the way a field instrument would say it: a
   ring leaving each of its places and dying at the edge of them.

   ## What counts as a place

   Its territory, plus anywhere it has been reported (data/sightings.ts).
   That second half is the whole point of doing this at all: one polygon is
   one place and needs no diagram, but a cat with a patch and three
   sightings has a RANGE, and a range is a thing you can only see drawn.

   The latest sighting is deliberately not one of them. A sighting moves the
   territory to it (catsRepo), so the newest point and the territory centre
   are the same place, and pinging both would draw two rings on top of each
   other and call it two habitats. */
const ZONES = 'territory-zones'
const PING_A = 'territory-ping-a'
const PING_B = 'territory-ping-b'

/** One ring's life, from leaving the centre to fading at the edge. */
const PING_MS = 2600

/** Two rings, half a cycle apart. One ring alone blinks: there is a moment
    with nothing on screen and it reads as a fault rather than a rhythm.
    With a second ring at 0.5 there is always one in flight, which is what
    makes a sonar sweep read as continuous. */
const PING_PHASES: [string, number][] = [
  [PING_A, 0],
  [PING_B, 0.5],
]

/** Web Mercator metres per pixel. The ring is sized in metres, because it
    describes ground, and MapLibre wants circle-radius in pixels, so the two
    have to be converted every frame that the zoom might have changed. */
function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** A ceiling on the drawn radius. At close zoom a 200 metre ring is
    thousands of pixels across, which is a lot of fragment to fill for a
    shape whose visible part is a hairline. */
const MAX_PING_PX = 520

// Screen-pixel glow radius at the map's min/max zoom (MapCanvas.tsx:
// minZoom 14.6, maxZoom 17). A flat pixel value would grow smaller than
// the territory itself as you zoom in (territories are ~139m geographic
// circles, so they grow ~5.3x across this zoom range while a fixed pixel
// radius would not) — interpolating keeps the glow's halo proportionate.
// This is a camera-only expression (depends only on zoom, not on feature
// state), which matters beyond visuals: MapLibre does not transition
// data-driven (feature-state-based) paint values, but it does transition
// camera-only ones, which is what makes the bloom-in animation below work
// at all.
const GLOW_RADIUS_SELECTED: ExpressionSpecification = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  14.6,
  48,
  17,
  254,
]
const GLOW_OPACITY_SELECTED = 0.55

/* The zoom a selected territory is framed at. Territories are near-regular
   circles of similar size (see the note on centroid.ts), so one number
   frames any of them; there is no per-cat box to solve for.

   Deliberately a floor, never a set: `Math.max(map.getZoom(), FOCUS_ZOOM)`
   below. Someone who has zoomed in to read the street names and then picks
   another cat wants to keep that scale, not be pulled back out to the
   district view they had already left. */
const FOCUS_ZOOM = 15.6

/** Where the middle of the visible map is, as an offset in pixels from the
    middle of the container. MapLibre's `offset` is exactly this: how far the
    target centre should sit from the real centre when the camera stops.

    Measured off the DOM rather than derived from the breakpoint, because
    every one of those panels is conditional: the rail collapses, the plate
    is only there when a cat is open, and below 900px both are replaced by a
    deck along the bottom. Whatever is actually on screen at the moment of
    the ease is what gets subtracted. */
function visibleOffset(): [number, number] {
  const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
  /* A panel only counts if it is a panel. Below the breakpoint the plate
     opens as a near-full-width card and the deck can take half the height,
     and subtracting those leaves no map left to aim at: the camera would
     chase a sliver. Filtering by proportion rather than by matchMedia keeps
     this one function and keeps it right if the breakpoint ever moves. */
  const side = (r?: DOMRect) => (r && r.width < window.innerWidth * 0.5 ? r : undefined)
  const foot = (r?: DOMRect) => (r && r.height < window.innerHeight * 0.5 ? r : undefined)

  const left = side(box('.rail'))?.right ?? 0
  const right = side(box('.plate'))?.left ?? window.innerWidth
  const bottom = foot(box('.cat-deck'))?.top ?? window.innerHeight

  return [(left + right) / 2 - window.innerWidth / 2, bottom / 2 - window.innerHeight / 2]
}


const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** selected / hovered / dimmed / resting / hidden, in that order. `resting`
    and `dimmed` both resolve to fully invisible (see the file header) — a
    territory only ever shows for the cat you're pointing at or have
    selected. `hidden` stays a separate parameter from `resting` even though
    both are currently 0: it's the pre-reveal state (spec §8.6, the ink-in
    control — every territory starts here and flips to `revealed` once,
    staggered, on first load, never back), kept distinct in case the two
    want to diverge again. */
const byState = <T,>(selected: T, hovered: T, dimmed: T, resting: T, hidden: T) => [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  selected,
  ['boolean', ['feature-state', 'hovered'], false],
  hovered,
  ['boolean', ['feature-state', 'dimmed'], false],
  dimmed,
  ['boolean', ['feature-state', 'revealed'], false],
  resting,
  hidden,
]

type Props = {
  cats: Cat[]
  /* Passed in rather than imported. See the note by `centroids` below. */
  territories: FeatureCollection<Polygon>
  /* The whole sightings log, fetched once by App.tsx alongside cats and
     territories (data/sightings.ts's own note on why the async fetch had
     to move up there: this component draws from inside a MapLibre effect
     that cannot await). Read here, never fetched, so the "elsewhere" zone
     and ghost-territory effects below stay synchronous filters over an
     array that is already in hand. */
  sightings: Sighting[]
  /* The signed-in visitor's own uid, or null while signed out: the other
     half of isOwnPending below (Sighting.authorUid's own note on why
     "mine" is now an account fact rather than a browser fact). */
  uid: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}

export function Territories({
  cats,
  territories,
  sightings,
  uid,
  selectedId,
  onSelect,
  hoveredId,
  onHover,
}: Props) {
  /* Was a module-level const off a static JSON import, which was right
     while the only cats were the seeded three. A recorded cat (data/
     localCats.ts) arrives after this module has evaluated, so the map has
     to be recomputed from whatever the repo hands down rather than from
     what was on disk at build time. Memoised on identity: the repo returns
     a new object only when the data actually changed. */
  const centroids = useMemo(() => centroidsById(territories), [territories])

  /* The selected cat's centroid as two numbers, not as the array itself.
     The camera effect below depends on these, so it re-runs when that cat's
     territory has actually MOVED (a sighting moves one, see
     ui/ReportSighting.tsx) and not merely because the repo handed back a
     fresh object holding the same points. Depending on `centroids` directly
     re-framed the camera on every reload, which meant reporting a sighting
     for one cat yanked the view back to whichever different cat happened to
     have its plate open. */
  const focus = selectedId ? centroids.get(selectedId) : undefined
  const focusLng = focus?.[0]
  const focusLat = focus?.[1]

  const { map, isLoaded, theme, placing } = useMap()
  // The glow's filter tracks this instead of selectedId directly, so a
  // deselect (selectedId -> null) doesn't yank the filter to '' on the same
  // render as the fade-out starts. See the selection effect below.
  const lastGlowId = useRef<string | null>(null)

  // Layers are added once, on load, and torn down on unmount. StrictMode
  // mounts this twice in dev, so every add is paired with a remove.
  useEffect(() => {
    if (!map || !isLoaded || cats.length === 0) return

    // --dur-ink / --ink-stagger, spec §8.6 — read live so reduced motion
    // (which collapses both to ~0 in tokens.css) applies for free, the same
    // way map/style.ts reads colour tokens.
    const inkIn = { duration: parseFloat(token('--dur-ink')) }
    const stagger = parseFloat(token('--ink-stagger'))

    // Cat colour as a data-driven match, so the fill stays one layer.
    const colourByCat: (string | string[])[] = ['match', ['get', 'id']]
    for (const cat of cats) colourByCat.push(cat.id, token(cat.colour))
    colourByCat.push(token('--ink-soft')) // fallback for an unseeded polygon

    map.addSource(SOURCE, {
      type: 'geojson',
      data: territories,
      // feature-state needs a real feature id, and ours lives in properties.
      promoteId: 'id',
    })

    map.addSource(GLOW_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [...centroids].map(([id, coordinates]) => ({
          type: 'Feature',
          properties: { id },
          geometry: { type: 'Point', coordinates },
        })),
      } as FeatureCollection,
    })

    map.addLayer({
      id: GLOW,
      type: 'circle',
      source: GLOW_SOURCE,
      // No feature is selected on load, so nothing matches — set for real by
      // the selection effect below.
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-color': token('--rust'),
        'circle-radius': 0,
        'circle-blur': 1,
        'circle-opacity': 0,
        'circle-radius-transition': inkIn,
        'circle-opacity-transition': inkIn,
      },
    })

    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SOURCE,
      paint: {
        'fill-color': colourByCat as never,
        // resting/dimmed → 0, 2026-08-17: pins carry the always-visible
        // signal now, this fill only needs to show on hover/select.
        'fill-opacity': byState(0.5, 0.44, 0, 0, 0) as never,
        'fill-opacity-transition': inkIn,
      },
    })

    map.addLayer({
      id: LINE,
      type: 'line',
      source: SOURCE,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': byState(
          token('--rust'),
          token('--ink'),
          token('--ink'),
          token('--ink'),
          token('--ink')
        ) as never,
        'line-width': 1.5,
        'line-dasharray': [3, 2],
        'line-opacity': byState(0.9, 0.85, 0, 0, 0) as never,
        'line-opacity-transition': inkIn,
      },
    })

    // The ink-in reveal, spec §8.6: every territory starts hidden (the case
    // fallback above) and flips to `revealed` once, staggered ~60ms apart,
    // letting the opacity transition above draw it in. No library — this is
    // the deliberate control condition, spec §8.6.
    const timers = cats.map((cat, i) =>
      setTimeout(() => map.setFeatureState({ source: SOURCE, id: cat.id }, { revealed: true }), i * stagger)
    )

    return () => {
      for (const timer of timers) clearTimeout(timer)
      for (const id of [LINE, FILL, GLOW]) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      for (const source of [SOURCE, GLOW_SOURCE]) {
        if (map.getSource(source)) map.removeSource(source)
      }
    }
  }, [map, isLoaded, cats, territories, centroids])

  // Clicks and the pointer cursor. Kept out of the layer effect so the
  // handler can close over a fresh onSelect without rebuilding the layers.
  useEffect(() => {
    if (!map || !isLoaded) return

    /* Both handlers stand down while the record panel is waiting for a
       point (MapCanvas' `placing`). The click that says "the territory goes
       here" lands on the same canvas these are bound to, so without this it
       would also select the cat whose territory it landed inside, or clear
       the selection if it landed on bare ground. Either way the person aims
       at the map and gets a plate thrown over it.

       A guard rather than removing the listeners: this effect already
       re-registers on every selection change, so `placing` in its deps is
       the same mechanism, and there is no window where the map is left with
       no handlers at all. */
    const handleClick = (e: MapLayerMouseEvent) => {
      if (placing) return
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) onSelect(id === selectedId ? null : id)
    }
    /* A click on bare ground clears the selection.

       defaultPrevented is the opt-out for anything drawn ABOVE the ground.
       Kept after the impostor layer it was written for was removed, because
       the marker that replaced it has the same shape of problem: CatMarkers'
       pin sits on a stake, so its head is nowhere near the polygon it
       belongs to, and a click there would otherwise read as a click on
       nothing. The pin also stops propagation at the DOM level, so this is
       the second of two belts. */
    const handleMapClick = (e: MapMouseEvent) => {
      if (placing || e.defaultPrevented) return
      if (map.queryRenderedFeatures(e.point, { layers: [FILL] }).length === 0) onSelect(null)
    }
    // mousemove (not just mouseenter) so the hover follows you across two
    // overlapping territories without a gap at their shared edge.
    const setHover = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      const id = e.features?.[0]?.properties?.id as string | undefined
      onHover(id ?? null)
    }
    const clearHover = () => {
      map.getCanvas().style.cursor = ''
      onHover(null)
    }

    map.on('click', FILL, handleClick)
    map.on('click', handleMapClick)
    map.on('mouseenter', FILL, setHover)
    map.on('mousemove', FILL, setHover)
    map.on('mouseleave', FILL, clearHover)

    return () => {
      map.off('click', FILL, handleClick)
      map.off('click', handleMapClick)
      map.off('mouseenter', FILL, setHover)
      map.off('mousemove', FILL, setHover)
      map.off('mouseleave', FILL, clearHover)
    }
    /* No clearHover() here. This effect depends on selectedId so that
       handleClick can toggle against a fresh value, which means it tears
       down and rebuilds on every click, and clearing the hover in that
       teardown wiped the hover the click had just been made on. The pointer
       is still sitting on the territory, so no mouseenter fires to restore
       it: the territory's hover paint dropped out and the cursor reverted
       from pointer to grab, both while the mouse had not moved. Leaving
       hover alone is correct here; the real teardown is below. */
  }, [map, isLoaded, selectedId, onSelect, onHover, placing])

  /* The real teardown, split out of the handler effect above so it does not
     also run on every click. A hover left set as this component goes away
     would strand the rail's row highlight on a cat whose territory is no
     longer on screen, and leave the canvas stuck showing a pointer cursor.

     Both deps are stable for this component's whole life, MapCanvas only
     renders <Territories> once it has an instance, and onHover is a setState
     so listing them honestly still means "runs once, on the way out",
     without an empty array that would capture whatever map was at mount. */
  useEffect(
    () => () => {
      if (map) map.getCanvas().style.cursor = ''
      onHover(null)
    },
    [map, onHover],
  )

  // Selection and hover: state only, no rebuild, no re-render of the layers.
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

    // GLOW is filter + camera-only paint, not feature-state (see the
    // GLOW_RADIUS_SELECTED comment above) — driven once per selection
    // change here, not per-cat like the loop above. The filter is pinned to
    // lastGlowId, not selectedId directly: on deselect, selectedId goes
    // null on this same render, and filtering on it directly would yank the
    // filter to '' before the radius/opacity transition below ever gets to
    // play, clipping the feature away instead of fading it. Only updating
    // lastGlowId when there IS a selection means the filter keeps pointing
    // at the last-selected feature through a deselect, so radius/opacity
    // can animate down to 0 on that same (still-matching) feature.
    if (selectedId !== null) lastGlowId.current = selectedId
    if (map.getLayer(GLOW)) {
      map.setFilter(GLOW, ['==', ['get', 'id'], lastGlowId.current ?? ''])
      map.setPaintProperty(GLOW, 'circle-radius', selectedId !== null ? GLOW_RADIUS_SELECTED : 0)
      map.setPaintProperty(GLOW, 'circle-opacity', selectedId !== null ? GLOW_OPACITY_SELECTED : 0)
    }
  }, [map, isLoaded, cats, selectedId, hoveredId])

  /* The map goes to the cat you picked.

     Selection used to change nothing about the camera, which was fine while
     the only way to select was to click a territory you could already see.
     It stopped being fine once the rail and the deck could select one:
     pressing a row opened a plate for a territory that might be off screen
     entirely, or (worse, because it looks like a bug rather than an
     oversight) sitting underneath the plate that had just opened over it.

     easeTo on the centroid, not fitBounds on the polygon. fitBounds solves
     for a flat camera, and this one is pitched 55 degrees whenever the 3D
     toggle is on, so a fitted box frames a tilted territory far too tight.
     The centroid is already computed here for the glow and shared with the
     pins, so the cat, its glow and the camera cannot disagree about where
     it is.

     Not in the selection effect above, deliberately: that one also runs on
     hover, and a camera that chases the pointer around the map is a
     different feature, and a much worse one. */
  useEffect(() => {
    if (!map || focusLng === undefined || focusLat === undefined) return

    map.easeTo({
      center: [focusLng, focusLat],
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      offset: visibleOffset(),
      /* Zero, not "skip the move". Someone on reduced motion still needs to
         end up looking at the cat they chose; it is the travel between here
         and there they asked not to be shown, so the camera cuts. */
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900,
    })
    /* selectedId only. Re-running this when the panels resize or the theme
       flips would re-frame the map under someone who had panned away from
       the cat on purpose and left the plate open behind them. */
  }, [map, focusLng, focusLat])

  /* The pings. Everything about this effect is deliberately self-contained:
     its own source, its own two layers, its own loop, created when a cat is
     selected and gone when one is not.

     It does not touch the glow, and that is not tidiness. The glow is
     filter-driven rather than feature-state driven for a specific reason
     written at the top of this file, and it took a session to get right;
     the cheapest way not to break it is not to reach into it. If the pings
     ever misbehave, deleting this effect changes nothing else on the map. */
  useEffect(() => {
    if (!map || !isLoaded || !selectedId) return

    const feature = territories.features.find((f) => f.properties?.id === selectedId)
    const centre = centroids.get(selectedId)
    if (!feature || !centre) return

    const ring = feature.geometry.coordinates[0] as [number, number][]
    const reach = ringRadiusM(ring, centre)
    if (!(reach > 0)) return

    /* Sightings far enough from the territory to be somewhere else. The
       threshold is a share of the cat's own reach rather than a fixed
       distance, so it means "outside its patch" for a cat with a small
       range and for one with a large one alike. */
    /* Published observations, plus this viewer's own unreviewed one, and
       that filter is the safety line rather than a preference: these zones
       draw the POINTS of sightings onto the public map, so an unreviewed
       report rendered here would publish exactly the precise location that
       review exists to hold back, precisely the thing spec §9 requires
       review to hold back until somebody has looked at it.

       Synchronous, off the `sightings` prop App.tsx already fetched: this
       runs inside a MapLibre effect that cannot await, which is the same
       reason isSurveyed/isOwnPending live in data/sightings.ts rather than
       in catsRepo.ts, so an async caller and this synchronous one can share
       one definition of "published" instead of two that could drift. */
    const elsewhere = sightings
      .filter((sighting) => sighting.catId === selectedId)
      .filter((sighting) => isSurveyed(sighting) || isOwnPending(sighting, uid))
      .map((sighting) => sighting.point)
      .filter((point) => distanceM(centre, point) > reach * 0.6)

    const places = [centre, ...elsewhere]

    map.addSource(ZONES, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: places.map((coordinates) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates },
        })),
      } as FeatureCollection,
    })

    const colour = token(cats.find((cat) => cat.id === selectedId)?.colour ?? '--rust')
    /* Under the fill, over the glow. The glow is the soft mass that says
       "this one"; the rings are linework over it, and drawing them beneath
       the fill keeps them from competing with the shape they describe. */
    const before = map.getLayer(FILL) ? FILL : undefined

    for (const [id] of PING_PHASES) {
      map.addLayer(
        {
          id,
          type: 'circle',
          source: ZONES,
          paint: {
            'circle-radius': 0,
            'circle-opacity': 0,
            'circle-stroke-color': colour,
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0,
            /* Both 'map', so the ring lies ON the ground rather than facing
               the camera. In the pitched view that is the difference between
               a radar sweep across a city and a sticker on the lens. */
            'circle-pitch-alignment': 'map',
            'circle-pitch-scale': 'map',
          },
        },
        before
      )
    }

    const paint = (id: string, phase: number) => {
      if (!map.getLayer(id)) return
      const metres = reach * (0.12 + phase * 1.03)
      const radius = Math.min(MAX_PING_PX, metres / metresPerPixel(centre[1], map.getZoom()))
      map.setPaintProperty(id, 'circle-radius', radius)
      /* Fades on a curve rather than linearly: a ring that dims in even
         steps appears to hang at the end, because the eye tracks the last
         faint frames longest. The exponent front-loads the brightness. */
      map.setPaintProperty(id, 'circle-stroke-opacity', 0.7 * (1 - phase) ** 1.4)
    }

    /* Reduced motion keeps the diagram and loses the travel: one ring held
       at the edge of the range still says "found here", and the expansion
       is the part somebody asked not to be shown. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint(PING_A, 0.55)
      return () => {
        for (const [id] of PING_PHASES) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(ZONES)) map.removeSource(ZONES)
      }
    }

    let frame = 0
    const started = performance.now()
    const step = (now: number) => {
      const t = ((now - started) % PING_MS) / PING_MS
      for (const [id, offset] of PING_PHASES) paint(id, (t + offset) % 1)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(frame)
      for (const [id] of PING_PHASES) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(ZONES)) map.removeSource(ZONES)
    }
    /* theme is in here for the same reason it is in the effect below: the
       stroke colour is read off :root once, when the layers are built, and
       a canvas layer cannot repaint itself when a custom property changes.
       Without it, switching theme with a cat selected leaves the rings
       drawn in the previous theme's rust.

       sightings and uid are in here because `elsewhere` above is computed
       from them: a new report, a review verdict or a sign-in/out all
       change which points this effect should be ringing, and none of
       those touch selectedId. */
  }, [map, isLoaded, selectedId, territories, centroids, cats, theme, sightings, uid])

  // theme is only a trigger here: the paint values themselves come from
  // re-reading :root, the same live-token pattern the mount effect above
  // already uses. Rebuilds the same match expression the mount effect built,
  // since fill-color/line-color are whole expressions, not single colour
  // strings, so setPaintProperty needs the complete replacement.
  useEffect(() => {
    if (!map || !isLoaded || !map.getLayer(FILL)) return

    const colourByCat: (string | string[])[] = ['match', ['get', 'id']]
    for (const cat of cats) colourByCat.push(cat.id, token(cat.colour))
    colourByCat.push(token('--ink-soft'))
    map.setPaintProperty(FILL, 'fill-color', colourByCat as never)

    map.setPaintProperty(
      LINE,
      'line-color',
      byState(token('--rust'), token('--ink'), token('--ink'), token('--ink'), token('--ink')) as never
    )

    map.setPaintProperty(GLOW, 'circle-color', token('--rust'))
  }, [map, isLoaded, cats, theme])

  /* --- The pending ghost, phase 9 -----------------------------------------
     Where the SELECTED cat's territory would move to if the oldest sighting
     waiting on it were approved, dashed and half-strength beside the real
     shape.

     Selection-gated, not drawn for every pending cat at once — the first
     version was, and at any real number of cats with open reports it drew
     a small crowd of overlapping dashed shapes across the whole map, no
     more readable than the badges it was supposed to explain. One at a
     time, revealed the same way the selection glow above is: click a cat,
     see its ghost; click elsewhere, it is gone. Two effects for the same
     reason the glow is two mechanisms rather than one — mount once, then
     only ever `setData`/`setLayoutProperty` on selection change, the same
     shape map/ReportSighting.tsx's own PREVIEW source already uses for an
     identical one-dashed-polygon-at-a-time job.

     Oldest, not newest (data/sightings.ts's pendingByCat has the reasoning,
     shared with map/CatMarkers.tsx's badge so the two can never point at
     different reports for the same cat).

     2026-08-26: used to be admin-only, on the reasoning in spec §9 that a
     report's exact point should never reach the public map — written for a
     future where cats and reports are real, and real coordinates could get
     an animal hurt. Opened to every visitor now, deliberately: v1's cats are
     fictional so there is no one to protect yet, and letting a visitor see
     the same claim an admin reviews is the point (they can tell whether it
     matches what they saw). Revisit this gate again before real cats or
     real reports ever land — that is the point spec §9 was actually
     guarding. */
  useEffect(() => {
    if (!map || !isLoaded) return

    map.addSource(GHOST_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: GHOST_FILL,
      type: 'fill',
      source: GHOST_SOURCE,
      paint: { 'fill-color': token('--rust'), 'fill-opacity': 0.14 },
    })
    map.addLayer({
      id: GHOST_LINE,
      type: 'line',
      source: GHOST_SOURCE,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': token('--rust'),
        'line-width': 1.5,
        'line-dasharray': [2, 2],
        'line-opacity': 0.85,
      },
    })

    return () => {
      for (const id of [GHOST_LINE, GHOST_FILL]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(GHOST_SOURCE)) map.removeSource(GHOST_SOURCE)
    }
  }, [map, isLoaded])

  useEffect(() => {
    if (!map) return
    const source = map.getSource(GHOST_SOURCE) as GeoJSONSource | undefined
    if (!source) return

    const summary = selectedId ? pendingByCat(sightings).get(selectedId) : undefined
    const feature = selectedId
      ? territories.features.find((f) => f.properties?.id === selectedId)
      : undefined

    source.setData({
      type: 'FeatureCollection',
      features: feature && summary ? [translateToward(feature, summary.oldest.point)] : [],
    })
  }, [map, selectedId, territories, sightings])

  return null
}
