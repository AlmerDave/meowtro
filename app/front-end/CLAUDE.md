# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Meowtro: a field-guide map of the community cats of Bonifacio Global City
(Taguig, PH). Cats are mapped by **territory polygon** (each with a marker
at its centroid and a selection glow), never by a pin that claims an exact
location. Click a territory → a specimen plate opens → the cat renders as a
turning 3D figure in a pencil-and-ink toon shader.

**Three themes, one token file. Two of them ship on the toggle.** `light`
and `dark` are rev 4's glass HUD — translucent blurred panels, rounded,
real shadow, native display stack, no grain — and light is the default
(set as `data-theme="light"` on `<html>` in `index.html`). `paper` is rev
1-3's field-guide identity: cream stock, Fraunces, ink linework, square
corners, paper grain.

**`paper` is deliberately kept but deliberately off the toggle.** Every
token, `Grain.tsx`, the Fraunces `<link>` and the styleguide's paper column
are all still live and still built; the *only* thing excluding it is the
`TOGGLE_THEMES` array in `src/map/style.ts`. Do not delete paper's tokens,
grain or font on the grounds that the app never selects them — that
reachability is the point, and the styleguide exercises them. Bringing it
back is one word in `TOGGLE_THEMES`.

The three are not three codebases: every difference between them is the
same token name with a different value in `src/tokens.css`, selected by a
`data-theme` attribute on `:root`. See "The token bridge" below.

This is also a deliberate learning vehicle: six small libraries, each owning
exactly one motion moment, to practice integrating each rather than building
custom CSS animation. See design spec §8 for the full library-to-moment map.

**Full context lives in two docs at the repo root, not here:**
- `../../docs/superpowers/plans/2026-08-16-meowtro-build-plan.md` — the
  checkpoint. Read its `RESUME HERE` block first; it records what's done,
  what's next, and why. Update it as phases complete.
- `../../docs/superpowers/specs/2026-08-16-meowtro-design.md` — the design
  spec: art direction, architecture, the anti-slop checklist, and the
  per-library motion assignments in §8.

## Commands

Run from `app/front-end/`:

```bash
npm run dev       # vite dev server, defaults to :5173
                   #   /               the app
                   #   /styleguide.html  design-system proof page
npx tsc -b         # typecheck only
npm run build      # tsc -b && vite build (two entry points: app + styleguide)
npm run preview    # serve the production build
```

No lint script and no test runner are configured. Verification is
`npx tsc -b` plus visual review at a gate (see "Gates" below) — there is no
`npm test`.

## Architecture

**Assemble from registries, hand-author only the identity.** Component
behavior (buttons, motion primitives, map wrapper) is pulled from shadcn,
React Bits, etc. Four things stay hand-written because they *are* the
project: the map style (`src/map/style.ts`), the territory layers
(`src/map/Territories.tsx`), the cat markers (`src/map/CatMarkers.tsx`),
and the paper grain (`src/Grain.tsx`).

### The token bridge (read this before styling anything)

`src/tokens.css` is the single source of truth: five colors (`--paper`,
`--ink`, `--ink-soft`, `--rust`, `--sage`), the material tokens
(`--radius`, `--panel-border`, `--blur-glass`, `--shadow-glass`,
`--edge-highlight`, `--surface-glass`, `--surface-glass-strong`,
`--surface-hover`), a 1.25-ratio type scale, an 8px space scale, and the
motion durations. Nothing else in the app should contain a hex value or a
magic size.

`src/app.css` bridges shadcn's variable names (`--background`, `--primary`,
`--radius-*`, `--shadow-*`, ...) onto those tokens, once. Any component
pulled from any registry *after* that bridge automatically renders in the
active theme's material. If a newly-pulled component looks generic/grey, or
keeps its own corner or shadow while the theme changes around it, the bridge
is broken, not the component.

**How the three themes actually work.** Every paper/glass difference is the
*same token name* with a different value, so nothing downstream branches on
the theme: `paper` (bare `:root`, also written as `data-theme="paper"`)
resolves `--blur-glass` to `0`, `--shadow-glass`/`--edge-highlight` to
transparent, `--panel-border` to a real 1px rule and `--radius` to `2px`;
the two glass themes do the reverse. That is what lets `shell.css` carry
**one** rule set for `.rail`/`.plate`/`.map-control` instead of a paper set
and a glass set. Do not add a `:root[data-theme=...] .something` rule to
style a component — add a token and set it per theme.

Because a bare `:root` *is* the paper theme, the default has to be stated
explicitly or the page paints cream for a frame before React mounts and
corrects it. It's stated in `index.html`/`styleguide.html` (`<html
data-theme="light">`), not in React, for exactly that reason.

CSS-driven surfaces repaint for free (they read the custom properties live),
but **the map is a canvas, not DOM, so it needs its own re-theme path**:
`applyMapTheme()` in `src/map/style.ts` re-reads the tokens and pushes them
onto each themed basemap layer via `setPaintProperty` (plus `setSky`) when
the toggle fires; `Territories.tsx` has a parallel theme-keyed effect that
rebuilds the per-cat color/state paint expressions; `CatMarkers.tsx` folds
`theme` into its existing teardown/rebuild effect instead. `theme` lives in
`MapContext` alongside `isFlat` — but `:root`'s `data-theme` attribute is
the source of truth, and the React state exists only to give those canvas
components something to re-run on.

`@custom-variant dark (&:is(.dark *))` in `app.css` is deliberate: it stops
`prefers-color-scheme: dark` from picking the theme. The app never sets
`.dark`; dark is a choice the user makes with the toggle, not one the OS
makes for them. (The one place that needed a real dark rule, the attribution
button's black SVG, is scoped to `:root[data-theme='dark']` at the bottom of
`app.css`.)

### Map (`src/map/`)

- `style.ts` — the MapLibre style object as data. Colors are read live off
  `:root` via `getComputedStyle`, so `tokens.css` stays the only file with a
  hex in it. No `glyphs`/`sprite`: intentional (see MapLabels below).
  `BGC_BOUNDS`/`BGC_CENTER` describe the pmtiles extract in `public/bgc.pmtiles`
  and are used as `maxBounds` — keep the extract sized comfortably larger
  than any real viewport at the map's zoom, or panning runs off the edge of
  the tile data into flat background paint with no error (this has bitten
  the project once already; see the build plan's decision log).
- `MapCanvas.tsx` — the whole MapLibre wrapper, hand-written (~60 lines: a
  ref, an instance, a React context) rather than pulled from mapcn. Exposes
  `useMap()` to children. Sets `setWorkerUrl`/`addProtocol('pmtiles', ...)`/
  `prewarm()` once at module scope — MapLibre 6 ships no bundled worker, and
  the worker pool is global and survives StrictMode's double-mount.
- `Territories.tsx` — three layers over two sources: `fill`/`line`
  (feature-state driven — `selected`/`hovered`/`dimmed`/`revealed`
  booleans, never a layer rebuild) plus a selection-only blurred `circle`
  glow on a centroid source. Fill and line are **invisible at rest**;
  `CatMarkers` carries the always-visible "cats live here" signal now. The
  glow deliberately does NOT use feature-state: MapLibre never transitions
  feature-state-derived paint values, so the glow's radius/opacity are
  driven by direct `setPaintProperty` calls keyed off a `filter`, with the
  radius a zoom-interpolate expression so it scales with the territory's
  geographic size rather than a fixed pixel value.
- `CatMarkers.tsx` — two representations of the same centroid, swapped on
  the flat/3D toggle: a DOM teardrop pin placed by `maplibregl.Marker` in
  flat mode, a native `circle` layer with `circle-pitch-alignment: 'map'`
  (the ground-tilt look, no three.js) in pitched mode. Centroids come from
  `centroid.ts`, shared with `Territories`' glow, so a pin and a glow can
  never land on different points for the same cat. Note the two components
  keep *separate* centroid sources on purpose — `CatMarkers` tears its own
  down on every toggle, and the glow must not be subject to that.
- `MapLabels.tsx` — labels are DOM `<span>`s in `--font-display` (streets in
  `--font-mono`), reprojected on every `move`, not MapLibre symbol layers.
  Rationale: symbol layers need SDF glyphs from a font server, which would
  add a third typeface and a network dependency to what's meant to be one
  offline `.pmtiles` file — and an SDF atlas could not follow a theme
  switch, since the display face changes with it. Streets are picked by
  geometry length (longest named roads win), never hand-listed.

### Data (`src/data/`)

`catsRepo.ts` is the intentional v1/v2 seam: `listCats`/`getCat` are async
over a seeded array (`cats.seed.ts`) today, a real API later, and every
caller already handles the loading state either way. **Never add a
`location` field to `Cat`** — cats are polygons only (`territories.geo.json`),
by design, so v1 doesn't architect itself into exposing an exact point
location for a real animal (safety constraint, spec §9, binding now even
though v1's cats are fictional).

### App shell (`src/shell.css`, `src/App.tsx`)

Full-viewport fixed map (`z-index: 0`) with an index rail and the specimen
plate as fixed-position overlays above it. `.maplibregl-map.map` is a
two-selector rule on purpose: `maplibre-gl.css` sets
`.maplibregl-map { position: relative }` and is injected after `shell.css`,
so a plain `.map` rule loses the specificity tie and `inset: 0` silently
stops applying — the container gets zero height and the map spins forever
with no error.

### Two build entry points

`vite.config.ts` builds `index.html` (the app) and `styleguide.html`
(`Styleguide.tsx`, imports `styleguide.css`) as separate pages. The
styleguide is the reviewable proof that a new token/component change
actually reads as Meowtro before it ships into the app. Its palette table
samples all three themes live off `:root` (flip the attribute, read with
`getComputedStyle`, restore) rather than listing hexes, so it cannot drift
from `tokens.css`; section 07 borrows the real `.rail` for the same reason.

## Gates

Work proceeds in phases from the build plan, each ending at a **gate**: a
visible, reviewed checkpoint before the next phase starts (e.g. gate 3 is
"the map looks like an architectural drawing, territories overlap legibly,
clicking one selects it — no motion yet"). Check the build plan's gate
table before assuming it's fine to move on to the next phase's dependencies
(e.g. don't start wiring GSAP/Lenis camera work before the map gate is
actually reviewed, not just rendering).
