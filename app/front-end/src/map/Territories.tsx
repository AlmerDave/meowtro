import { useEffect, useRef } from 'react'
import type { ExpressionSpecification, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'
import { useMap } from './MapCanvas'
import { centroidsById } from './centroid'
import type { Cat } from '@/data/catsRepo'
import territories from '@/data/territories.geo.json'

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

// Static input, computed once at module scope rather than per-render. Same
// helper CatMarkers uses, so a glow and a pin can never land on different
// points for the same cat.
const CENTROIDS = centroidsById(territories as FeatureCollection<Polygon>)

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
  selectedId: string | null
  onSelect: (id: string | null) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}

export function Territories({ cats, selectedId, onSelect, hoveredId, onHover }: Props) {
  const { map, isLoaded, theme } = useMap()
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
      data: territories as FeatureCollection,
      // feature-state needs a real feature id, and ours lives in properties.
      promoteId: 'id',
    })

    map.addSource(GLOW_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [...CENTROIDS].map(([id, coordinates]) => ({
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
  }, [map, isLoaded, cats])

  // Clicks and the pointer cursor. Kept out of the layer effect so the
  // handler can close over a fresh onSelect without rebuilding the layers.
  useEffect(() => {
    if (!map || !isLoaded) return

    const handleClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) onSelect(id === selectedId ? null : id)
    }
    // A click on bare ground clears the selection.
    const handleMapClick = (e: MapMouseEvent) => {
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
      clearHover()
    }
  }, [map, isLoaded, selectedId, onSelect, onHover])

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

  return null
}
