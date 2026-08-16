# Meowtro — Design

**Date:** 2026-08-16
**Status:** Approved design, not yet implemented
**Scope:** v1 only. v2 is sketched at the end to protect the seams, not to be built.

---

## 1. What this is

An interactive field guide to the community cats of Bonifacio Global City,
Taguig. Each cat is a named individual with a **roaming territory** drawn on a
custom-styled map, a written profile, and a 3D model you can look at.

Two goals, in priority order:

1. **A craft project.** Real WebGL on the web, motion that carries meaning,
   and a visual identity that could not have come out of a template. Every
   technical choice below is judged first on whether it teaches something.
2. **A real community tool, eventually.** BGC has an actual cat-feeder
   community. v1 is seeded and offline, but the data layer is built so a real
   backend slots in behind it without touching the UI.

### Non-goals for v1

Sighting reports, community-submitted cats, photo upload, moderation,
accounts, any backend, real-time anything. These were considered and cut. See
§9.

---

## 2. Why BGC, and why territories

BGC is a planned grid: small, walkable, bounded, with legible landmarks (Track
30th, Terra 28th, Burgos Circle, Bonifacio High Street, the Net Park loading
docks). A bounded area means a single small map extract, real coordinates that
mean something, and a dataset a human can actually verify on foot.

**Territories, not pins.** A pin says "the cat is here," which is false about
every cat that has ever lived. A soft hatched polygon says "this is her
patch," which is true and is also the more interesting thing to look at.
Overlapping territories are the payload: they show, at a glance, which cats
share turf. That single decision is what makes the map read as a cat map
rather than a restaurant finder.

---

## 3. The name

**Meowtro** — Metro Manila, meow. The name reads *transit* while the design
reads *field guide*. Rather than fight that, each plate carries a route-style
designation (`LINE 03 · TRACK 30TH`) so the transit motif has exactly one
place to live. It is a typographic garnish, not a system: there are no lines,
no interchanges, no route graph.

---

## 4. Art direction — naturalist field guide

The brief was explicitly "no AI slop." That is a real constraint with a real
test: **could this have been produced by prompting for a nice website?** The
default failure mode is dark UI, glassmorphism, a purple-blue gradient, Inter,
and a neon accent. The defense is not taste, it is commitment to a specific
referent.

The referent: a 1950s naturalist's field survey. Cream stock, letterpress
serif, ink linework, pencil hatching, specimen plates numbered in the corner.

| Token | Value | Notes |
|---|---|---|
| `--paper` | `#F4EFE4` | Ground. Never pure white. |
| `--ink` | `#1C1917` | Type and linework. Never pure black. |
| `--ink-soft` | `#57534E` | Secondary type, grid rules. |
| `--rust` | `#9A3F2B` | The one accent. Plate numbers, active territory. |
| `--sage` | `#6B7F62` | Parks and green cover only. |

Type: **Fraunces** for display and body — a variable serif whose optical-size
and `wonk` axes give large headings genuine letterpress character while body
text stays sober — and **JetBrains Mono** for coordinates, dates, and route
designations. **Two families, no more.**

Texture: a fixed paper-grain overlay via SVG `feTurbulence`, composited with
`mix-blend-mode: multiply` at low opacity. It sits above the map and below the
UI so map and interface share one paper. This one detail does most of the work
of making the page look printed rather than rendered.

### The anti-slop checklist

Applied at every review:

- No `border-radius` above 4px. Paper does not have rounded corners.
- No box-shadow used as depth. Depth comes from linework and overlap.
- No gradient except the paper grain.
- No emoji, anywhere.
- No centered hero with a headline and two buttons.
- Every animation must be nameable in terms of what it *tells* the user.

---

## 5. Architecture

```
src/
  main.tsx
  App.tsx                 layout: map left, plate right
  map/
    MapCanvas.tsx         maplibre instance in a ref
    style.ts              the Protomaps style object (the art direction, as data)
    territories.ts        GeoJSON layers: fill, boundary, hatch
  plate/
    Plate.tsx             the cat detail panel
    CatModel.tsx          react-three-fiber canvas
  data/
    catsRepo.ts           listCats() / getCat(id)  <- the seam
    cats.seed.ts          the twelve cats
    territories.geo.json
public/
  bgc.pmtiles             map extract, static file
  cat.glb                 one model
  hatch.png               hatch sprite
```

### Stack, and why each choice beat the obvious one

| Layer | Choice | Rejected alternative |
|---|---|---|
| App | Vite + React + TS | **Next.js** — no backend, no SSR, no routing needs beyond a panel. It would be dead weight and a deploy story we don't need. |
| Map | `maplibre-gl` directly | **react-map-gl** — a wrapper around ~40 lines of `useEffect`. One less dependency and full access to the imperative API we need for `flyTo` and feature-state. |
| Tiles | **Protomaps** `.pmtiles` extract of BGC | **MapTiler / Stadia** — both need an API key, both meter you, and both ship a house visual language. A BGC-only extract is a few MB of static file: no key, no quota, works offline, and the style is fully authored by us. That last part is not a nicety — it *is* the art direction. |
| 3D | react-three-fiber + drei | Raw three.js — R3F's declarative model composes with React state, which is how the plate drives the scene. |
| Toon look | `MeshToonMaterial` + drei `<Outlines>` | A custom GLSL outline pass. The built-ins land the ink look with zero shader code; revisit only if they visibly fall short. |
| Motion | Motion (framer-motion) for UI; maplibre `flyTo` for camera | GSAP — a second animation runtime for no capability we lack. |
| Model | **One** CC0 low-poly cat, tinted and pattern-swapped per cat | Twelve models — twelve times the sourcing and twelve times the payload, for a difference nobody perceives at plate scale. |

### Data flow

One direction, one piece of state.

```
catsRepo.listCats()
      ↓
  App holds  selectedCatId: string | null
      ↓                        ↓
  MapCanvas                  Plate
  (paints layers,            (renders profile,
   flies camera,              mounts CatModel)
   emits clicks) ─────────────┘
```

`selectedCatId` is the only cross-component state in the app. Map clicks set
it; the plate reads it; closing the plate clears it. No store, no context, no
reducer. If a second piece of shared state ever appears, revisit — one does
not justify a library.

---

## 6. The map layer

**Style.** Authored by hand in `map/style.ts` against the MapLibre style spec:

- Ground `--paper`, water a pale wash, parks `--sage` at low opacity.
- Buildings as **thin outlines only**, no fill. BGC's towers become an
  architectural drawing rather than a field of blocks. This is the single
  most identity-defining line in the stylesheet.
- Labels suppressed except parks and the three or four streets that orient
  you. A field survey is sparse; a basemap is not.

**Territories.** Each cat owns one GeoJSON polygon, rendered as three stacked
layers:

1. `fill` — the cat's colour at `0.14` opacity. Overlaps darken naturally,
   which is exactly the shared-turf signal we want, for free.
2. `line` — dashed ink boundary, `1.5px`.
3. `hatch` — one shared `fill-pattern` sprite above everything at low opacity,
   for pencil texture.

> **Known constraint:** MapLibre cannot tint a `fill-pattern`. That is why
> hatching is one shared uncoloured sprite and per-cat identity comes from the
> fill colour beneath it. Per-cat coloured hatching would mean generating
> twelve sprites at build time — deferred until it's demonstrably missed.

Selection uses `feature-state`, not layer rebuilds: the selected territory
goes to `0.32` opacity and gains a `--rust` boundary while every other drops
to `0.05`.

---

## 7. The plate (3D)

A right-hand panel, roughly 420px, laid out as a specimen plate:

```
PLATE 03                              LINE 03 · TRACK 30TH
────────────────────────────────────────────────────────
        [ 3D cat, turning ]
────────────────────────────────────────────────────────
MILO
Orange tabby · torn left ear · male, est. 3 yrs
First recorded    Mar 2024
Range             Track 30th → Net Park loading dock
Disposition       Approaches for food, not for touch
────────────────────────────────────────────────────────
14.5512° N, 121.0500° E
```

**The 3D scene.** One `<Canvas>`, mounted only while a plate is open and
unmounted on close — no hidden WebGL context idling. Orthographic camera, a
single key light, `MeshToonMaterial` with a two-step gradient map, and drei
`<Outlines>` for the ink edge. The cat turns at ~4°/s. Drag to orbit, clamped
so it can never show the underside.

Per-cat variation is material-level: base tint, plus a swappable pattern
texture (tabby / tuxedo / calico / solid). Ear notches and other individual
marks are described in the text, not modelled.

**Fallback.** If WebGL is unavailable, the plate renders a static
illustration in the same frame. The page must not depend on 3D to be
readable.

---

## 8. Motion

Three named moments. Every one has to answer *what does this tell the user?*
If the answer is "it looks nice," it gets cut.

| Moment | What happens | What it tells you |
|---|---|---|
| **Ink-in** | On first load, territory boundaries draw themselves via `stroke-dashoffset`, hatching fading in behind. Once, ~900ms, staggered ~60ms. | This map was drawn, not generated. Establishes the whole premise in under a second. |
| **Plate open** | Map eases to the territory (`flyTo`, ~700ms) as the plate slides in and unselected territories fade to `0.05`. | You are now looking at *one* cat, and this patch is hers. |
| **Breathing** | The 3D cat turns slowly; paper grain drifts almost imperceptibly. | The page is alive without asking for anything. |

Everything else — hovers, panel scroll — is a 120ms opacity or 2px transform.
Restraint is the style.

All motion respects `prefers-reduced-motion: reduce`: ink-in resolves
instantly, `flyTo` becomes `jumpTo`, breathing stops.

---

## 9. The v1/v2 seam

`src/data/catsRepo.ts` is the entire concession to the future:

```ts
export async function listCats(): Promise<Cat[]>
export async function getCat(id: string): Promise<Cat | null>
```

Async from day one over a seeded array, so every consumer already handles
loading. Swapping to a real API is an edit to one file. That is the whole
abstraction — no auth stubs, no ORM, no schema for a database that does not
exist.

### Deferred to v2

- **Sighting reports** — "saw her here, just now," animating onto the map and
  nudging the territory.
- **Community-submitted cats** — an unnamed cat enters a pending state for
  the community to name.
- **Photos** — real portraits alongside the 3D plate.

Each needs a backend, moderation, and abuse handling. None is worth building
before the map earns an audience.

### Safety constraint on v2 — decided now, because it constrains v1

Precise public locations of stray animals are a genuine safety problem;
people who harm animals use exactly this kind of data. When real cats and
real reports arrive:

- Display territory polygons only. **Never an exact point for a real cat.**
- Report submission may capture a precise coordinate, but the public layer
  renders only the blurred polygon derived from it.
- Never publish a feeding schedule.

v1 changes nothing today — seeded cats are fictional. It is recorded here so
v1 never architects itself into a point-location API it would later have to
tear out.

---

## 10. Testing

Proportional to a static front end with no backend:

- **`catsRepo` and territory geometry** — plain assertions: every cat resolves,
  every territory is a closed valid polygon, every cat's polygon actually
  falls inside the BGC bounding box. This catches the realistic failure —
  fat-fingered coordinates putting a cat in Laguna de Bay.
- **Manual, per-moment** — each of the three motion moments checked once at
  reduced-motion and once without.
- **No component tests** for panels that render text from a typed array. The
  type checker already covers that.

## 11. Definition of done for v1

- Twelve cats, twelve verified territories, all inside BGC.
- Custom Protomaps style ships with no API key and no network call to a tile
  vendor.
- Ink-in, plate-open, and breathing all implemented and reduced-motion safe.
- 3D plate works, and degrades to a static illustration without WebGL.
- The anti-slop checklist (§4) passes on review.
- Deploys as static files.
