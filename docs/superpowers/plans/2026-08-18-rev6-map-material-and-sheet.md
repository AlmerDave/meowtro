# Meowtro rev 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BGC map read like a dark, tilted 3D city map (facade texture, road casing, landcover, rounded corners, directional light), give cats photo thumbnails, and make the app usable on a phone via a collapsible bottom sheet.

**Architecture:** Sections 2.1 to 2.4 are pure MapLibre style data added to the existing hand-authored `style.ts`. Section 2.5 adds one new module that draws a facade pattern to a canvas and registers it as a MapLibre image. The UI work extracts one shared list row and adds a `vaul` bottom sheet that renders below a 900px breakpoint; desktop is untouched.

**Tech Stack:** Vite, React 19, TypeScript, MapLibre GL 6.3.0, Protomaps pmtiles, motion/react, vaul 1.1.2 (new).

**Spec:** [`../specs/2026-08-18-map-material-and-sheet-design.md`](../specs/2026-08-18-map-material-and-sheet-design.md)

## Global Constraints

- **Branch:** `rev6-map-material-and-sheet`. Already created. Do not work on `master`.
- **No test runner exists and none is being added.** CLAUDE.md: verification is `npx tsc -b` plus visual review at a gate. Do not add vitest, jest, or a `test` script.
- **The implementing agent cannot self-launch a browser.** Visual gates require a screenshot from the user. Stop and ask at every gate; do not self-certify a visual result.
- **No hex values outside `tokens.css`.** Every colour is a token read at runtime. This is the token bridge rule in CLAUDE.md.
- **Never add a `location` field to `Cat`.** Spec §9 safety constraint. Territories are polygons only.
- **Do not delete or modify the paper theme,** its tokens, `Grain.tsx`, or the Fraunces link. It is slated for removal in a later, separate task.
- **No em dashes** in code, comments, docs, or commit messages.
- **Run from `app/front-end/`.** Typecheck is `npx tsc -b`, full build is `npm run build`.
- Commit after every task. Do not push.

---

### Task 1: Facade texture

The riskiest item, built first so a bad result costs an hour. `fill-extrusion-pattern` applies to roofs as well as walls, which may look wrong at the roofline. If it does, the fallback is dropping this task entirely and keeping Tasks 2 and 3.

**Files:**
- Create: `src/map/facade.ts`
- Create: `src/map/facade.check.ts`
- Modify: `src/tokens.css` (two new tokens per glass theme)
- Modify: `src/map/style.ts` (recipe + wiring in `applyMapTheme`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `windowCells(seed: number, cols: number, rows: number, density: number): boolean[]`, `facadeImage(base: string, glass: string, density: number, seed?: number): ImageData | null`, `FACADE_IMAGE_ID: string`, `FACADE_COLS: number`, `FACADE_ROWS: number`.

- [ ] **Step 1: Add the two facade tokens**

In `src/tokens.css`, inside the existing `:root[data-theme='light']` block, add:

```css
  /* Facade texture, rev 6. Unlit mullion tone for daylight: a window in
     daylight is darker than the wall around it, not brighter. */
  --facade-glass: color-mix(in srgb, var(--ink) 22%, var(--building));
  --facade-lit: color-mix(in srgb, var(--ink) 22%, var(--building));
```

Inside the existing `:root[data-theme='dark']` block, add:

```css
  /* Warm interior light for night. Deliberately not --rust: rust is the
     one selection accent and windows must never compete with a selected
     territory's glow. */
  --facade-glass: color-mix(in srgb, var(--ink) 18%, var(--building));
  --facade-lit: #ffd9a3;
```

Paper gets neither token. It never asks for a pattern.

- [ ] **Step 2: Write the pure cell function and the canvas generator**

Create `src/map/facade.ts`:

```ts
/* The building facade pattern, spec rev 6 §2.5. Drawn to a canvas at
   runtime and handed to MapLibre as an image, because
   `fill-extrusion-pattern` takes an image id and MapLibre cannot tint a
   pattern the way it tints `fill-extrusion-color`. That is also why this
   is regenerated per theme rather than recoloured.

   This module deliberately knows nothing about themes or tokens: it takes
   two resolved colour strings and a density. style.ts owns the token probe
   and the per-theme recipe. */

/** Tile size in px. 128 keeps the grid crisp at the zooms this map allows
    (14.6 to 17) without paying for a large texture upload on every theme
    flip. */
const TILE = 128
export const FACADE_COLS = 8
export const FACADE_ROWS = 8

export const FACADE_IMAGE_ID = 'building-facade'

/* A seeded LCG, not Math.random: the pattern is regenerated on every theme
   change, and an unseeded shuffle would move every lit window each time the
   user toggled day/night. Same seed, same building. */
const lcg = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Which cells of a cols x rows grid are lit. Pure and deterministic, which
    is the whole reason it is separate from the drawing below: it is the only
    part of this file that can be checked without a browser. */
export function windowCells(
  seed: number,
  cols: number,
  rows: number,
  density: number
): boolean[] {
  const random = lcg(seed)
  const cells: boolean[] = []
  for (let i = 0; i < cols * rows; i++) cells.push(random() < density)
  return cells
}

/** The pattern tile. `base` must be the building's own colour: setting
    `fill-extrusion-pattern` overrides `fill-extrusion-color` entirely, so
    the image carries the wall, not just the windows.
    Returns null where there is no 2D context (no canvas support); callers
    leave the flat fill in place rather than failing. */
export function facadeImage(
  base: string,
  glass: string,
  density: number,
  seed = 1
): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = base
  ctx.fillRect(0, 0, TILE, TILE)

  const cellWidth = TILE / FACADE_COLS
  const cellHeight = TILE / FACADE_ROWS
  // The gap between windows is the mullion. Rounded and floored at 1px so
  // the grid never closes up into a solid block at small tile sizes.
  const inset = Math.max(1, Math.round(cellWidth * 0.22))

  ctx.fillStyle = glass
  const cells = windowCells(seed, FACADE_COLS, FACADE_ROWS, density)
  cells.forEach((lit, i) => {
    if (!lit) return
    const x = (i % FACADE_COLS) * cellWidth
    const y = Math.floor(i / FACADE_COLS) * cellHeight
    ctx.fillRect(x + inset, y + inset, cellWidth - inset * 2, cellHeight - inset * 2)
  })

  return ctx.getImageData(0, 0, TILE, TILE)
}
```

- [ ] **Step 3: Write the runnable check**

Node here is v20, which cannot strip TypeScript types, so the check is bundled with the esbuild already present as a Vite dependency. No new package.

Create `src/map/facade.check.ts`:

```ts
/* The one runnable check in this project, spec rev 6 §7. `windowCells` is
   the only part of the facade that is pure, and it is the part with real
   logic (seeding, density, grid size). Everything else needs a canvas.
   Run: see the command in the plan, or the npm-less one-liner below.
   No framework on purpose: this project has no test runner. */
import assert from 'node:assert/strict'
import { windowCells } from './facade'

// Length is always cols * rows, whatever the density.
assert.equal(windowCells(1, 8, 8, 0.5).length, 64)
assert.equal(windowCells(1, 4, 2, 0.5).length, 8)

// Density 0 lights nothing, density 1 lights everything. These are the two
// values the real recipes actually use at the extremes.
assert.equal(windowCells(1, 8, 8, 0).filter(Boolean).length, 0)
assert.equal(windowCells(1, 8, 8, 1).filter(Boolean).length, 64)

// Deterministic: same seed, same grid. This is the property that stops
// windows from reshuffling on every theme toggle.
assert.deepEqual(windowCells(7, 8, 8, 0.4), windowCells(7, 8, 8, 0.4))

// Different seeds must actually differ, or the LCG is broken and every
// building would carry an identical pattern.
assert.notDeepEqual(windowCells(7, 8, 8, 0.4), windowCells(8, 8, 8, 0.4))

// A mid density lands somewhere sane rather than at either rail. Wide
// bounds on purpose: this asserts the distribution is not degenerate, it
// does not pin the LCG's exact output.
const lit = windowCells(3, 16, 16, 0.35).filter(Boolean).length
assert.ok(lit > 40 && lit < 140, `expected a mid-range count, got ${lit}`)

console.log('facade.check.ts: all assertions passed')
```

- [ ] **Step 4: Run the check and confirm it passes**

From `app/front-end/`:

```bash
npx esbuild src/map/facade.check.ts --bundle --platform=node --format=esm --outfile=../../.check.mjs && node ../../.check.mjs && rm ../../.check.mjs
```

Expected: `facade.check.ts: all assertions passed`

If it fails, fix `facade.ts` before continuing. Do not proceed to Step 5 with a failing check.

- [ ] **Step 5: Wire the recipe into style.ts**

In `src/map/style.ts`, add the import at the top:

```ts
import { FACADE_IMAGE_ID, facadeImage } from './facade'
```

Add the recipe next to `THEMED_LAYERS`:

```ts
/* Per-theme facade recipe, rev 6 §2.5. `paper` is absent on purpose, not by
   omission: it gets no pattern and falls back to the flat --building fill.
   Do not add a paper entry to "finish" this table. */
const FACADE_RECIPE: Partial<Record<Theme, { glass: string; density: number }>> = {
  // Scattered: a night tower is partly occupied, never fully lit.
  dark: { glass: '--facade-lit', density: 0.34 },
  // Every cell: in daylight a window is a mullion, and every floor has one.
  light: { glass: '--facade-glass', density: 1 },
}
```

Then add this function below `applyMapTheme`:

```ts
/** Adds or refreshes the facade pattern for the active theme. Split out of
    applyMapTheme only for readability; it is called from there and nowhere
    else.

    Ordering matters: the image has to exist before any layer names it, which
    is why the pattern is never part of buildStyle()'s initial object. The
    first applyMapTheme call (MapCanvas' load effect) is what installs it. */
function applyFacade(map: MapLibreMap, theme: Theme) {
  if (!map.getLayer('buildings')) return
  const recipe = FACADE_RECIPE[theme]

  if (!recipe) {
    // Back to the flat fill. undefined resets the property to its default
    // rather than painting an empty pattern.
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
```

Change `applyMapTheme`'s signature to take the theme, and call the new function. Replace the existing function's closing section so it reads:

```ts
export function applyMapTheme(map: MapLibreMap, theme: Theme) {
  for (const { id, prop, tokenName } of THEMED_LAYERS) {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, token(tokenName))
  }
  // The atmosphere reads --paper/--ink too, and it is only visible in the
  // pitched view - theming it here rather than on the 3D toggle keeps the
  // two controls independent of each other.
  map.setSky(buildSky())
  applyFacade(map, theme)
}
```

- [ ] **Step 6: Update the one caller**

In `src/map/MapCanvas.tsx`, the theme effect currently calls `applyMapTheme(map)`. Change it to pass the theme:

```ts
  useEffect(() => {
    if (!map || !isLoaded) return
    applyMapTheme(map, theme)
  }, [map, isLoaded, theme])
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b`
Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add src/map/facade.ts src/map/facade.check.ts src/map/style.ts src/map/MapCanvas.tsx src/tokens.css
git commit -m "Texture building facades with a per-theme window pattern"
```

- [ ] **Step 9: GATE 1, visual review**

Stop. Ask the user to run `npm run dev`, switch to the dark theme, press the 3D toggle, and send a screenshot.

What to check in their screenshot:
- Do window grids appear on tower walls?
- **Do the roofs look wrong?** This is the known hazard. Window grids on rooftops is the expected failure.
- Does toggling light/dark swap the texture without the windows reshuffling position?

If roofs look wrong: revert this task (`git revert`) and continue from Task 2. The spec records this as an accepted outcome, not a failure to debug.

---

### Task 2: Road casing and landcover

**Files:**
- Modify: `src/map/style.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: two new layer ids, `roads-casing` and `landcover`, both registered in `THEMED_LAYERS`.

- [ ] **Step 1: Add the landcover layer**

In `buildStyle()`'s `layers` array, insert immediately after the `earth` layer and before `water`:

```ts
      {
        /* rev 6 §2.2. This source-layer ships in the extract and was never
           used. Ground cover under everything else: a wash, not a shape,
           so the roads and buildings above still read as the subject. */
        id: 'landcover',
        type: 'fill',
        source: 'bgc',
        'source-layer': 'landcover',
        paint: { 'fill-color': sage, 'fill-opacity': 0.14 },
      },
```

- [ ] **Step 2: Add the road casing layer**

Insert immediately BEFORE the existing `roads` layer. Layer order is paint order, so the casing must be earlier in the array to sit underneath.

```ts
      {
        /* rev 6 §2.1. The casing half of a casing-and-fill pair: a wider,
           darker line under `roads`, which turns a flat stroke into
           something that reads as a road with edges.

           The width is its own `interpolate` rather than the roads layer's
           expression plus a constant, because MapLibre rejects a zoom
           expression nested inside arithmetic - `['+', ['interpolate',
           ...], 2.5]` fails validation. So the stops below are the roads
           layer's stops with the casing width already added in. If you
           change one, change both. */
        id: 'roads-casing',
        type: 'line',
        source: 'bgc',
        'source-layer': 'roads',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ink,
          'line-opacity': 0.34,
          'line-width': [
            'interpolate',
            ['exponential', 1.6],
            ['zoom'],
            12,
            ['match', ['get', 'kind'], 'highway', 3.2, 'major_road', 2.8, 2.4],
            18,
            [
              'match',
              ['get', 'kind'],
              'highway',
              18,
              'major_road',
              13,
              'medium_road',
              10,
              'minor_road',
              8,
              5.5,
            ],
          ],
        },
      },
```

- [ ] **Step 3: Register both in THEMED_LAYERS**

The canvas cannot repaint from CSS, so any layer with a token colour must be listed or it will keep its load-time colour through a theme switch. Add two entries:

```ts
const THEMED_LAYERS: Array<{ id: string; prop: ThemedPaintProp; tokenName: string }> = [
  { id: 'background', prop: 'background-color', tokenName: '--paper' },
  { id: 'earth', prop: 'fill-color', tokenName: '--paper' },
  { id: 'landcover', prop: 'fill-color', tokenName: '--sage' },
  { id: 'water', prop: 'fill-color', tokenName: '--ink' },
  { id: 'parks', prop: 'fill-color', tokenName: '--sage' },
  { id: 'canopy', prop: 'fill-extrusion-color', tokenName: '--sage' },
  { id: 'roads-casing', prop: 'line-color', tokenName: '--ink' },
  { id: 'roads', prop: 'line-color', tokenName: '--ink' },
  { id: 'buildings', prop: 'fill-extrusion-color', tokenName: '--building' },
]
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/map/style.ts
git commit -m "Give roads a casing and pick up the unused landcover layer"
```

---

### Task 3: Rounded corners and directional light

**Files:**
- Modify: `src/map/style.ts`

**Interfaces:**
- Consumes: `applyMapTheme(map, theme)` from Task 1.
- Produces: `LIGHT_BY_THEME` record, consumed by nothing outside `style.ts`.

- [ ] **Step 1: Confirm the rounded-corner property is real**

`fill-extrusion-rounded-corner-distance` is present in the installed style-spec types, but typed is not the same as rendered. Confirm it is in the runtime spec before relying on it:

```bash
node -e "const s=require('@maplibre/maplibre-gl-style-spec');console.log(Object.keys(s.latest['paint_fill-extrusion']).filter(k=>k.includes('round')))"
```

Expected: `[ 'fill-extrusion-rounded-corner-distance' ]`

If the array is empty, skip Step 2 and note it in the commit message. The rest of this task still stands.

- [ ] **Step 2: Add rounded corners to the buildings layer**

In `buildStyle()`'s `buildings` layer paint block, add one property:

```ts
          // rev 6 §2.3. Softens the CAD-block silhouette toward something
          // drawn. MapLibre 6 only. In metres, so this is a small real-world
          // radius, not a pixel value: it does not change with zoom.
          'fill-extrusion-rounded-corner-distance': 2,
```

- [ ] **Step 3: Add the per-theme light table**

Add the import for the type at the top of `style.ts`:

```ts
import type { Map as MapLibreMap, StyleSpecification, SkySpecification, LightSpecification } from 'maplibre-gl'
```

Add the table next to `FACADE_RECIPE`:

```ts
/* rev 6 §2.4. Without a light direction the facade pattern reads as flat
   wallpaper, so this is a dependency of §2.5 rather than decoration.

   `position` is [radial, azimuthal, polar]. Polar 0 is directly overhead
   and 90 is at the horizon, so the higher number is the LOWER sun. Dark
   gets a low, warm, weak sun (long raking shadows, evening); light gets a
   higher, neutral, stronger one (midday). anchor 'map' rather than
   'viewport' because bearing never changes here, so a fixed geographic
   sun direction is both more physical and stable across a pitch change. */
const LIGHT_BY_THEME: Record<Theme, LightSpecification> = {
  paper: { anchor: 'map', position: [1.5, 210, 40], color: '#ffffff', intensity: 0.3 },
  light: { anchor: 'map', position: [1.5, 210, 35], color: '#ffffff', intensity: 0.45 },
  dark: { anchor: 'map', position: [1.5, 235, 70], color: '#ffd9b0', intensity: 0.28 },
}
```

The three hex values here are the one deliberate exception to the no-hex rule, and they are not palette colours: they are the colour of light itself, which has no token and should not gain one, since it never appears as a surface anywhere in the UI. Note this in the commit message.

- [ ] **Step 4: Apply it on theme change**

In `applyMapTheme`, add one line after the `setSky` call and before `applyFacade`:

```ts
  map.setLight(LIGHT_BY_THEME[theme])
```

- [ ] **Step 5: Set the initial light in buildStyle**

In the returned style object, next to `sky: buildSky(),` add:

```ts
    light: LIGHT_BY_THEME[
      (document.documentElement.dataset.theme as Theme | undefined) ?? DEFAULT_THEME
    ],
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/map/style.ts
git commit -m "Light the buildings directionally and round their corners"
```

- [ ] **Step 8: GATE 2, visual review**

Stop. Ask the user for two screenshots: flat view and 3D view, in dark theme.

What to check:
- Roads now have a visible darker edge, and the road hierarchy reads.
- Buildings are shaded directionally rather than uniformly.
- Building corners are visibly softened (only if Step 1 confirmed the property).

---

### Task 4: Cat photos and the shared list row

**Files:**
- Modify: `src/data/cats.seed.ts`
- Create: `src/ui/CatRow.tsx`
- Modify: `src/App.tsx`
- Modify: `src/shell.css`

**Interfaces:**
- Consumes: `Cat` from `@/data/catsRepo`.
- Produces: `CatRow` with props `{ cat: Cat; selected: boolean; onSelect: () => void; onHover: (hovering: boolean) => void }`. Task 5 renders this same component inside the sheet.

- [ ] **Step 1: Verify the placeholder image host is reachable**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://placecats.com/millie/88/88
```

Expected: `200`

If this is not 200, do not substitute a different host silently. Stop and tell the user, then seed `photo` as an empty string so Step 4's error path renders and the rest of the task proceeds.

- [ ] **Step 2: Add the photo field**

In `src/data/cats.seed.ts`, add to the `Cat` type after `coordinates`:

```ts
  /** A URL, not a bundled asset, so v2 can point this at real hosted photos
      without touching anything but this file. Note the cost: it is the one
      network dependency in an app that is otherwise a single offline
      pmtiles file, so every consumer must render correctly when it fails to
      load. See CatRow's onError. */
  photo: string
```

Add to each of the three cats. Milo:

```ts
    photo: 'https://placecats.com/millie/88/88',
```

Biscuit:

```ts
    photo: 'https://placecats.com/neo/88/88',
```

Tala:

```ts
    photo: 'https://placecats.com/bella/88/88',
```

These are placeholder images of unrelated cats. That is deliberate and consistent with spec §9: v1's cats are fictional, so a real photograph of a real animal would be the wrong claim to make.

- [ ] **Step 3: Create the shared row**

Create `src/ui/CatRow.tsx`:

```tsx
import type { Cat } from '@/data/catsRepo'

/* One row of the cat index, rev 6 §3. Shared by the desktop rail
   (App.tsx) and the mobile sheet (CatSheet.tsx) so the two can never drift
   apart. A real <button> rather than a styled div, for free keyboard
   focus and activation. */

type Props = {
  cat: Cat
  selected: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
}

export function CatRow({ cat, selected, onSelect, onHover }: Props) {
  return (
    <button
      type="button"
      className="cat-row"
      data-selected={String(selected)}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* alt is empty on purpose: the cat's name is right there in text, so
          announcing the photo too would just repeat it. This is decoration.
          onError hides the element rather than leaving a broken-image glyph,
          which is the whole offline story for this feature: no network means
          a text row, not a damaged one. Width and height are set so the row
          does not reflow when the image resolves or fails. */}
      <img
        className="cat-row-thumb"
        src={cat.photo}
        alt=""
        width={44}
        height={44}
        loading="lazy"
        decoding="async"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
      <span className="cat-row-text">
        <span className="cat-row-name">{cat.name}</span>
        <span className="cat-row-line">{cat.line.split(' · ')[0]}</span>
      </span>
    </button>
  )
}
```

- [ ] **Step 4: Use it in the rail**

In `src/App.tsx`, replace the `cats.map(...)` block inside `<nav className="rail">` with:

```tsx
        {cats.map((cat) => (
          <CatRow
            key={cat.id}
            cat={cat}
            selected={cat.id === selectedId}
            onSelect={() => setSelectedId(cat.id === selectedId ? null : cat.id)}
            onHover={(hovering) => setHoveredId(hovering ? cat.id : null)}
          />
        ))}
```

Add the import:

```tsx
import { CatRow } from '@/ui/CatRow'
```

- [ ] **Step 5: Style the row**

In `src/shell.css`, replace the existing `.rail button` rule set (the block covering `.rail button`, `:last-child`, `:hover`, `[data-selected='true']`, and `.rail button span`) with:

```css
/* One row, used by the rail and the mobile sheet. */
.cat-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: var(--t-sm);
  color: var(--ink);
  padding: var(--s-2) var(--s-4);
  text-align: left;
}
.cat-row:last-child {
  border-bottom: 0;
}
.cat-row:hover {
  background: var(--well);
}
.cat-row[data-selected='true'] {
  color: var(--rust);
}
/* Square, cropped, and corner-matched to the active theme's material: 20px
   radius on glass reads as a rounded tile, 2px on paper as a printed chip. */
.cat-row-thumb {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  object-fit: cover;
  border-radius: calc(var(--radius) / 2);
  background: var(--well);
}
.cat-row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cat-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-row-line {
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/data/cats.seed.ts src/ui/CatRow.tsx src/App.tsx src/shell.css
git commit -m "Give each cat a photo and share one row between rail and sheet"
```

---

### Task 5: Mobile bottom sheet

**Files:**
- Modify: `package.json` (add vaul)
- Create: `src/ui/CatSheet.tsx`
- Modify: `src/App.tsx`
- Modify: `src/shell.css`

**Interfaces:**
- Consumes: `CatRow` from Task 4, `Plate` from `@/plate/Plate`.
- Produces: `CatSheet` with props `{ cats: Cat[]; selectedId: string | null; onSelect: (id: string | null) => void; onHover: (id: string | null) => void }`.

- [ ] **Step 1: Install vaul**

```bash
npm install vaul@^1.1.2
```

Then confirm it did not force a React downgrade:

```bash
npm ls react
```

Expected: a single `react@19.x`. If npm reports a peer conflict or two React versions, stop and report it. The spec's recorded fallback is hand-rolling the sheet on the already-installed `motion/react`.

- [ ] **Step 2: Create the sheet**

Create `src/ui/CatSheet.tsx`:

```tsx
import { Drawer } from 'vaul'
import type { Cat } from '@/data/catsRepo'
import { CatRow } from '@/ui/CatRow'
import { Plate } from '@/plate/Plate'

/* The mobile presentation of the rail and the plate, rev 6 §4. Below 900px
   the two stop being independently positioned panels and share one sheet:
   the list at rest, the selected cat's plate on selection, back to the list
   on close.

   vaul rather than a hand-rolled motion/react drag, for one specific
   behaviour: at the full detent, dragging down from inside a scrolled list
   has to scroll the list rather than dismiss the sheet, unless the list is
   already at scrollTop 0. That handoff is where hand-rolled sheets break.

   modal={false} is the important prop. The map behind stays interactive at
   every detent, which it must, because with the camera manual (spec rev 6
   §5) dragging the map is the only way to see a cat sitting under the
   sheet. dismissible={false} for the same reason: this sheet is furniture,
   not a dialog, and there is no state where it should be gone entirely. */

const SNAP_POINTS = ['96px', 0.5, 0.92]

type Props = {
  cats: Cat[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

export function CatSheet({ cats, selectedId, onSelect, onHover }: Props) {
  const selected = cats.find((c) => c.id === selectedId) ?? null

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={SNAP_POINTS}
      // Uncontrolled: vaul owns which detent is active. Nothing in this app
      // needs to read or force it, and controlling it would mean fighting
      // the drag gesture for the same value.
      defaultActiveSnapPoint={SNAP_POINTS[1]}
    >
      <Drawer.Portal>
        <Drawer.Content className="cat-sheet">
          <div className="cat-sheet-handle" aria-hidden="true" />
          {/* vaul requires a title for the dialog's accessible name. It is
              visually hidden because the sheet's content already says what
              it is, but a screen reader announcing an unnamed dialog does
              not. */}
          <Drawer.Title className="cat-sheet-title">
            {selected ? selected.name : 'Cats of Bonifacio Global City'}
          </Drawer.Title>

          <div className="cat-sheet-body">
            {selected ? (
              <Plate cat={selected} onClose={() => onSelect(null)} />
            ) : (
              cats.map((cat) => (
                <CatRow
                  key={cat.id}
                  cat={cat}
                  selected={false}
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
```

- [ ] **Step 3: Switch on the breakpoint in App.tsx**

Add the import and a hook above the component:

```tsx
import { CatSheet } from '@/ui/CatSheet'

/* 900px: the rail is 15rem and the plate 26.25rem, so with gutters the two
   collide somewhere just above 700px. 900 leaves margin rather than
   switching at the exact failure width. Subscribed rather than read once,
   so rotating a tablet moves between the two presentations. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 900px)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)')
    const onChange = () => setIsMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return isMobile
}
```

Then in the component, add `const isMobile = useIsMobile()` after the other hooks, and replace the `<nav className="rail">` block and the `<AnimatePresence>` block with:

```tsx
      {isMobile ? (
        <CatSheet
          cats={cats}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
        />
      ) : (
        <>
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
        </>
      )}
```

- [ ] **Step 4: Style the sheet, and unpin the plate inside it**

Append to `src/shell.css`:

```css
/* --- Mobile sheet, rev 6 §4, ui/CatSheet.tsx ---------------------------
   Same panel recipe as .rail and .plate, rounded at the top only because
   the bottom edge is off-screen at every detent. */
.cat-sheet {
  position: fixed;
  z-index: 4;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  max-height: 96vh;
  border-radius: var(--radius) var(--radius) 0 0;
  background: var(--surface-glass-strong);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  box-shadow: var(--shadow-glass), var(--edge-highlight);
}
.cat-sheet-handle {
  flex-shrink: 0;
  width: 2.25rem;
  height: 0.25rem;
  margin: var(--s-2) auto;
  border-radius: 999px;
  background: var(--rule-strong);
}
/* Visually hidden, still announced. Not display:none, which would remove it
   from the accessibility tree and defeat the point. */
.cat-sheet-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
/* The one scroll container in the sheet. vaul reads scrollTop here to decide
   between scrolling and dragging, so nothing inside may scroll on its own,
   which is what the .plate override below is for. */
.cat-sheet-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

/* The plate is a fixed-position panel on desktop and plain content inside
   the sheet on mobile. Scoping the positioning to the desktop breakpoint is
   the whole adaptation: no second component, no variant prop. Its own
   overflow has to go too, or it becomes a nested scroll container and vaul
   can no longer tell a scroll from a drag. */
@media (max-width: 900px) {
  .plate {
    position: static;
    width: 100%;
    max-height: none;
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: none;
  }
  .map-controls {
    /* Clear of the sheet's peek detent and of a thumb reaching the handle. */
    bottom: calc(96px + var(--s-4));
  }
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc -b`
Expected: exit 0.

Run: `npm run build`
Expected: exit 0, two entry points emitted.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/ui/CatSheet.tsx src/App.tsx src/shell.css
git commit -m "Add a collapsible bottom sheet for phones"
```

- [ ] **Step 7: GATE 3, visual review**

Stop. Ask the user to open the dev server, narrow the window below 900px or use device emulation, and send screenshots at each detent plus one with a cat selected.

What to check:
- The sheet drags between three detents and the handle is grabbable.
- The map stays draggable while the sheet is at peek and half. This is the critical one: with the camera manual, a map that cannot be dragged under the sheet is a dead end.
- Selecting a cat swaps the sheet's content to the plate, and CLOSE returns to the list.
- At the full detent, dragging down inside a scrolled plate scrolls it rather than collapsing the sheet.

---

### Task 6: Update the project's checkpoint docs

The build plan is described in CLAUDE.md as the file a new session reads to carry on. Leaving it stale is how the Clouds work ended up uncommitted and unrecorded.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-16-meowtro-build-plan.md`
- Modify: `README.md`

- [ ] **Step 1: Update the build plan's RESUME HERE block**

Replace the "Last completed" paragraph with a rev 6 summary: which tasks landed, which were reverted at a gate (Task 1 in particular, if the roofs failed), and what the next step is.

- [ ] **Step 2: Add decision-log entries**

Add one row per non-obvious decision made here: the density trade that killed POI badges, the glyph correction, why vaul rather than motion/react, and the facade-on-roofs outcome once it is known.

- [ ] **Step 3: Fix the stale README claim**

`README.md` opens with "Twelve named residents". There are three. Change it to three, or to a phrasing that does not carry a count.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-16-meowtro-build-plan.md README.md
git commit -m "Record rev 6 in the build plan and correct the README's cat count"
```

---

## Self-Review

**Spec coverage.** §1 density decision, no badges: honoured, no task adds a symbol layer. §2.1 casing: Task 2. §2.2 landcover: Task 2. §2.3 rounded corners: Task 3. §2.4 light: Task 3. §2.5 facade: Task 1. §3 photos: Task 4. §4 sheet: Task 5. §5 out-of-scope items: no task touches global state, camera, tabs, region switcher, or the paper theme. §6 risks: every one has either a gate or an explicit fallback. §7 verification: `tsc -b` in every task, the runnable check in Task 1, three gates.

**Two deviations from the spec's file plan, both deliberate:**
- The spec listed `src/ui/CatSheet.tsx` and `src/ui/CatRow.tsx` but did not anticipate that the plate needs no component change. Scoping `.plate`'s positioning to a media query replaced what would have been a `PlateContent` extraction. Less code, same result.
- The spec did not mention `facade.check.ts`. It exists to satisfy §7's runnable-check requirement.

**Type consistency.** `applyMapTheme` gains a second parameter in Task 1 Step 5 and its only caller is updated in Step 6. `CatRow`'s prop shape is defined in Task 4 and consumed unchanged in Task 5. `facadeImage` and `windowCells` signatures match between `facade.ts`, `facade.check.ts`, and `style.ts`'s call site. `FACADE_COLS`/`FACADE_ROWS` are exported but only used inside `facade.ts`; they are exported so the check file can assert against the real grid size rather than hardcoded numbers.

**One known gap, accepted.** Task 3 Step 3 introduces three hex values for light colour, against the global no-hex constraint. They are the colour of light rather than a surface colour, no token exists for them, and inventing one would put a value in `tokens.css` that no CSS surface ever reads. Flagged in the task and in its commit message rather than silently done.
