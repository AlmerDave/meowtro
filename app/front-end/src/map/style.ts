import type { Map as MapLibreMap, StyleSpecification, SkySpecification } from 'maplibre-gl'
import { FACADE_IMAGE_ID, facadeImage } from './facade'

/* The art direction as data, spec §6.
   Colours are read off :root at build time rather than written here, so
   tokens.css stays the only file in the project that contains a hex. */

/* getComputedStyle on a custom property substitutes nested var() calls but
   does not evaluate color-mix() — MapLibre's paint validator then rejects
   the literal "color-mix(...)" text as an invalid colour. Assigning the raw
   value to a real `color` property forces the browser to resolve the maths,
   but per CSS Color 4 a color-mix() result serialises as the modern
   `color(srgb r g b)` function, not legacy `rgb(...)` — confirmed against
   MapLibre's own parser (parse_css_color.ts), which only accepts hex, named
   colours, rgb()/rgba() and hsl()/hsla(), nothing in `color()` syntax. So
   the resolved value still needs converting by hand. */
const probe = (() => {
  if (typeof document === 'undefined') return null
  const el = document.createElement('div')
  el.style.display = 'none'
  document.body.appendChild(el)
  return el
})()

const toLegacyRgb = (value: string) => {
  const match = value.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/
  )
  if (!match) return value
  const [, r, g, b, a] = match
  const channel = (v: string) => Math.round(parseFloat(v) * 255)
  return a !== undefined
    ? `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${a})`
    : `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
}

const token = (name: string) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!probe) return raw
  // Cleared first: the probe is a single long-lived element reused for every
  // lookup, and assigning an invalid value to `style.color` is a silent
  // no-op that leaves the *previous* token's colour in place. Harmless when
  // this only ran once at construction; a real hazard now that applyMapTheme
  // re-reads every token on each theme change.
  probe.style.color = ''
  probe.style.color = raw
  return toLegacyRgb(getComputedStyle(probe).color) || raw
}

/** The extract's bounds. Panning past them shows empty paper, so we clamp.
    Padded to ~4x the original BGC-only cut: at z14.6 a 0.028° extract is
    narrower than almost any desktop viewport, which read as a broken
    basemap (paper on one edge, tiles on the other) rather than a clamp. */
export const BGC_BOUNDS: [[number, number], [number, number]] = [
  [120.994, 14.499],
  [121.106, 14.603],
]

/* Locked on Milo's territory (30th St / Net Park), which sits mid-extract
   rather than down at Venice Grand Canal Mall on McKinley Hill's lower edge. */
export const BGC_CENTER: [number, number] = [121.05, 14.5512]

// EXPERIMENTAL — the mockup's default camera. Committed shape is pitch 0.
// 75, not something gentler like 55: MapLibre's sky only clears the top of
// the viewport once pitch pushes past ~69° (getMercatorHorizon in
// maplibre-gl's transform.ts crosses height/2 there) — below that the
// horizon line sits above y=0 and `sky` never draws a single pixel. 55 was
// silently invisible for exactly this reason.
export const DEFAULT_PITCH = 75
export const FLAT_PITCH = 0

/* Backlog "Clouds" item, plan A: native atmosphere instead of a hand-drawn
   overlay. Pitch-dependent — invisible until the 3D toggle is on. Tokens
   only, no new dependency.

   Extracted from buildStyle() so applyMapTheme can re-apply it: `sky` is a
   root style property, not a layer, so it is the one themed thing below
   that setPaintProperty cannot reach (map.setSky handles it instead). */
// One breath every 24s. `sky` has no texture or position to animate — the
// blend floats are the only lever, so "lively" here reads as the haze
// slowly thickening and thinning, not shapes moving. That's the ceiling of
// native `sky`; see the design spec's Clouds backlog item for the
// canvas-overlay fallback (Plan B) if this ceiling isn't enough.
const SKY_BREATHE_PERIOD_MS = 24_000

function buildSky(elapsedMs = 0): SkySpecification {
  const breathe = Math.sin((elapsedMs / SKY_BREATHE_PERIOD_MS) * Math.PI * 2)
  return {
    // sky-color used to be --paper too — identical to the ground/earth fill,
    // so even a correctly-sized sky region painted the exact same shade as
    // everything below it and read as nothing. --ink-soft gives it an
    // overcast, cloud-grey body distinct from the ground; horizon-color
    // stays --paper (not --ink) so it fades to a pale haze at the skyline
    // instead of a hard dark line.
    'sky-color': token('--ink-soft'),
    'horizon-color': token('--paper'),
    'fog-color': token('--paper'),
    'fog-ground-blend': 0.75 + breathe * 0.08,
    'horizon-fog-blend': 0.85 + breathe * 0.06,
    'sky-horizon-blend': 0.75 + breathe * 0.08,
    'atmosphere-blend': 0.9 + breathe * 0.1,
  }
}

/** Starts the sky's breathing animation; call the returned function to stop
    it (pitch back to flat, theme unmount). Skipped under reduced motion —
    the sky then just holds buildSky()'s t=0 values, same as before this
    existed. */
export function animateSky(map: MapLibreMap): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  const start = performance.now()
  let frame = requestAnimationFrame(function tick(now) {
    map.setSky(buildSky(now - start))
    frame = requestAnimationFrame(tick)
  })
  return () => cancelAnimationFrame(frame)
}

export function buildStyle(): StyleSpecification {
  const paper = token('--paper')
  const ink = token('--ink')
  const sage = token('--sage')
  const building = token('--building')

  return {
    version: 8,
    /* No `glyphs` and no `sprite` on purpose. Every label on this map is a DOM
       element in --font-display or JetBrains Mono (see MapLabels), which keeps
       the type to two families and means the map needs no font server: the
       whole basemap is one 2.7 MB file that works offline. */
    sky: buildSky(),
    sources: {
      bgc: {
        type: 'vector',
        url: 'pmtiles:///bgc.pmtiles',
        // Planet builds stop at z15; MapLibre overzooms past it.
        maxzoom: 15,
        /* The map's attribution control is also the page's only credits
           surface, so the cat model rides along here. That credit is a
           licence condition, not a courtesy: the model is CC-BY. */
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a> · cat by <a href="https://poly.pizza/m/6dM1J6f6pm9">Poly by Google</a> (CC-BY)',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': paper } },
      {
        id: 'earth',
        type: 'fill',
        source: 'bgc',
        'source-layer': 'earth',
        paint: { 'fill-color': paper },
      },
      {
        // A pale wash. There is no blue in this palette, so water is ink.
        id: 'water',
        type: 'fill',
        source: 'bgc',
        'source-layer': 'water',
        paint: { 'fill-color': ink, 'fill-opacity': 0.08 },
      },
      {
        // Flat lawns and grounds — stays a flat wash, these aren't canopy.
        id: 'parks',
        type: 'fill',
        source: 'bgc',
        'source-layer': 'landuse',
        filter: [
          'match',
          ['get', 'kind'],
          ['park', 'garden', 'recreation_ground', 'pitch', 'cemetery'],
          true,
          false,
        ],
        paint: { 'fill-color': sage, 'fill-opacity': 0.28 },
      },
      {
        /* EXPERIMENTAL — canopy for the mockup. Landuse polygons carry no
           height data, so this is a fixed guess at tree-crown height, not a
           real measurement like the buildings layer. Only real colour beyond
           ink/paper in the scene: answers "everything looks black". */
        id: 'canopy',
        type: 'fill-extrusion',
        source: 'bgc',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'kind'], ['forest', 'wood'], true, false],
        paint: {
          'fill-extrusion-color': sage,
          'fill-extrusion-opacity': 0.75,
          'fill-extrusion-height': 6,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'bgc',
        'source-layer': 'roads',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ink,
          'line-opacity': 0.2,
          'line-width': [
            'interpolate',
            ['exponential', 1.6],
            ['zoom'],
            12,
            ['match', ['get', 'kind'], 'highway', 1.2, 'major_road', 0.8, 0.4],
            18,
            [
              'match',
              ['get', 'kind'],
              'highway',
              14,
              'major_road',
              9,
              'medium_road',
              6,
              'minor_road',
              4,
              1.5,
            ],
          ],
        },
      },
      {
        /* EXPERIMENTAL — spike for the "tilted + extruded" mockup, not the
           committed identity line. Real height/min_height come off Protomaps'
           buildings layer, so this reads as actual volume once pitched. */
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'bgc',
        'source-layer': 'buildings',
        paint: {
          // Light putty, not ink: reads as a lit architectural model instead
          // of a dark block. vertical-gradient does the rest of the shading.
          'fill-extrusion-color': building,
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
  }
}

/* buildStyle() only resolves colour once, at construction — flipping
   data-theme on :root doesn't repaint an already-built style by itself.
   setPaintProperty per layer instead of map.setStyle(): setStyle() replaces
   the whole style, including the sources and layers Territories.tsx and
   CatMarkers.tsx added imperatively afterward, and re-diffing that is
   exactly the kind of risk this function exists to avoid. */
// Literal union of just the paint properties THEMED_LAYERS actually uses —
// keeps `prop` a real key MapLibre's setPaintProperty<K extends keyof
// AllPaintProperties> can infer against, instead of a widened `string`
// (which would also collapse the third argument's type to `any`).
type ThemedPaintProp = 'background-color' | 'fill-color' | 'line-color' | 'fill-extrusion-color'

const THEMED_LAYERS: Array<{ id: string; prop: ThemedPaintProp; tokenName: string }> = [
  { id: 'background', prop: 'background-color', tokenName: '--paper' },
  { id: 'earth', prop: 'fill-color', tokenName: '--paper' },
  { id: 'water', prop: 'fill-color', tokenName: '--ink' },
  { id: 'parks', prop: 'fill-color', tokenName: '--sage' },
  { id: 'canopy', prop: 'fill-extrusion-color', tokenName: '--sage' },
  { id: 'roads', prop: 'line-color', tokenName: '--ink' },
  { id: 'buildings', prop: 'fill-extrusion-color', tokenName: '--building' },
]

/** Every theme tokens.css defines. `paper` leads because it is also the
    state with no `data-theme` attribute set at all — a bare `:root` IS the
    paper theme, which is why index.html ships `data-theme="light"` on the
    <html> element rather than letting the default fall through. */
export const THEMES = ['paper', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/** What the map's theme button actually cycles: day and night only.
    `paper` (rev 1-3's cream field-guide identity) is deliberately kept out
    of the cycle but NOT out of the codebase — every token, the grain
    overlay, the Fraunces link and the styleguide's paper column are all
    still live, so setting `data-theme="paper"` by hand or adding it back to
    this array is the whole cost of shipping it again. Do not "clean up" the
    paper theme on the grounds that nothing references it; this array is the
    only thing that doesn't. */
export const TOGGLE_THEMES: Theme[] = ['light', 'dark']

/** What a bare page should start as, now that paper is off the toggle. */
export const DEFAULT_THEME: Theme = 'light'

/* Per-theme facade recipe, rev 6 §2.5. `paper` is absent on purpose, not by
   omission: it gets no pattern at all and falls back to the flat --building
   fill. Do not add a paper entry to "complete" this table. */
const FACADE_RECIPE: Partial<Record<Theme, { glass: string; density: number }>> = {
  // Scattered: a tower at night is partly occupied, never fully lit.
  dark: { glass: '--facade-lit', density: 0.34 },
  // Every cell: in daylight a window is just a mullion, and every floor has
  // one, so the grid is regular rather than random.
  light: { glass: '--facade-glass', density: 1 },
}

/** Adds or refreshes the facade pattern for the active theme. Split out of
    applyMapTheme purely for readability; it is called from there and nowhere
    else.

    Ordering matters: the image has to exist before any layer names it, which
    is why the pattern is never part of buildStyle()'s initial object. The
    first applyMapTheme call (MapCanvas' load effect) is what installs it. */
function applyFacade(map: MapLibreMap, theme: Theme) {
  if (!map.getLayer('buildings')) return
  const recipe = FACADE_RECIPE[theme]

  if (!recipe) {
    // Back to the flat fill. undefined resets the property to its default
    // rather than painting an empty pattern over the wall.
    map.setPaintProperty('buildings', 'fill-extrusion-pattern', undefined)
    return
  }

  const image = facadeImage(token('--building'), token(recipe.glass), recipe.density)
  // No 2D context: leave whatever is already painted alone rather than
  // clearing to an untextured block half way through a theme change.
  if (!image) return

  if (map.hasImage(FACADE_IMAGE_ID)) map.updateImage(FACADE_IMAGE_ID, image)
  else map.addImage(FACADE_IMAGE_ID, image)

  map.setPaintProperty('buildings', 'fill-extrusion-pattern', FACADE_IMAGE_ID)
}

export function applyMapTheme(map: MapLibreMap, theme: Theme) {
  for (const { id, prop, tokenName } of THEMED_LAYERS) {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, token(tokenName))
  }
  // The atmosphere reads --paper/--ink too, and it is only visible in the
  // pitched view — theming it here rather than on the 3D toggle keeps the
  // two controls independent of each other.
  map.setSky(buildSky())
  applyFacade(map, theme)
}
