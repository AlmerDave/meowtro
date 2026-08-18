# Meowtro rev 6 — map material, cat photos, mobile sheet

**Created:** 2026-08-18
**Supersedes nothing.** Extends the rev 5 design spec
([`2026-08-16-meowtro-design.md`](./2026-08-16-meowtro-design.md)); every
decision there still stands unless named below.

---

## 0. Where this came from

The user supplied a reference screenshot: a corporate logistics locator with
a dark, tilted 3D city map. Left rail of result cards with thumbnails, tabs,
a region dropdown, dense POI badges, per-building labels, transit icons.

The brief that came out of reviewing it: **make the map read like that. Do
not make the app work like that.**

That distinction is the whole scope of this rev. The product shape of the
reference (tabs, region switcher, contained map panel, scrolling card list
replacing the floating rail) is explicitly rejected: it would replace rev 4's
glass HUD identity, and it needs entities and tile data this project does not
have.

### What the reference turned out to need that we cannot have

Checked against the actual `public/bgc.pmtiles` metadata rather than assumed.
The extract carries nine layers: `boundaries, buildings, earth, landcover,
landuse, places, pois, roads, water`.

- **Per-building labels are impossible.** `buildings` has `height`,
  `min_height`, `kind`, `addr_housenumber`, and no `name` field. The
  reference's "340 Fremont Street" and "One Rincon Hill" labels have no
  source.
- **Transit, ferry and cable-car icons are impossible.** There is no
  `transit` layer in this extract.
- **Highway shields are possible but out of scope.** `roads` does carry
  `shield_text`, `ref` and `network`. Recorded so it is not re-researched.
- **`landcover` and `places` are in the file and entirely unused** by
  `style.ts`. This rev picks up `landcover`.

---

## 1. The density decision

Spec §6 commits to sparse labelling: *"Labels suppressed except parks and the
three or four streets that orient you. A field survey is sparse; a basemap is
not."*

The reference is dense. Both were put to the user as a direct trade.

**Decision: the field guide wins. No POI badges.** The map gains material,
texture and depth, and gains no information density. §6 is untouched.

Consequences, all of them good for scope:

- No `symbol` layer.
- No glyph pipeline, and no need to revisit `MapLabels.tsx`'s rationale.
- `MapLabels.tsx` is not modified by this rev at all.

> **Correction recorded for the future.** `MapLabels.tsx`'s comment justifies
> DOM labels partly on "symbol layers need SDF glyphs from a font server, and
> the only stack the Protomaps asset server carries is Noto Sans." That is
> true of Protomaps' *hosted* server and not true in general: glyph PBFs can
> be generated from any TTF at build time and served statically (Protomaps
> publishes `font-maker` for exactly this), and generating them from
> JetBrains Mono would add no third typeface. The other half of that
> rationale does still hold: `--font-display` changes face per theme, and an
> SDF atlas cannot follow a theme switch. So if labels are ever revisited,
> the honest shape is a hybrid: mono labels as symbols, display-face labels
> as DOM. Not being acted on now.

---

## 2. Map material

Five changes. Sections 2.1 through 2.4 are style data in `map/style.ts` and
change no interaction or state. Section 2.5 adds one new file, see section 8.

### 2.1 Road casing

A second `line` layer beneath the existing `roads` layer: wider, `--ink` at
higher opacity, same `kind`-match width expression scaled up by a constant.
The existing layer becomes the fill riding on top.

This is the single largest "reads as a real map" gain per line changed. The
reference's roads read as roads because of the casing-plus-fill pair, not
because of colour.

### 2.2 Landcover

New `fill` layer off the unused `landcover` source-layer, below `roads`, in a
low-opacity `--sage` mix. Free ground texture from data already shipped.

### 2.3 Rounded building corners

`fill-extrusion-rounded-corner-distance` on the `buildings` layer. One paint
property. Softens the CAD-block silhouette toward something drawn, which is
on-identity for a project whose whole argument is hand-inked.

MapLibre 6 only. Present in the installed `6.3.0` style-spec types; needs
confirming it is honoured by the renderer and not merely typed.

### 2.4 Directional light

The `light` root style property (`anchor`, `position`, `color`, `intensity`),
plus a `map.setLight()` call folded into `applyMapTheme()` so it re-tunes per
theme. Low and warm for dark, higher and neutral for light.

Not optional decoration: without directional shading a facade texture reads
as flat wallpaper. Section 2.5 depends on this.

### 2.5 Facade texture

`fill-extrusion-pattern` on `buildings`, from an image generated on a
`<canvas>` at runtime, registered with `map.addImage()` on load and swapped
with `map.updateImage()` on theme change.

- **dark:** warm lit window cells, scattered rather than uniform, so towers
  read as occupied at night.
- **light:** the same grid geometry as thin dark mullions, unlit, which is
  what a building looks like in daylight.
- **paper:** no pattern set. Falls through to today's flat `--building` fill.

Paper is deliberately not given a variant. Per user direction 2026-08-18 the
paper theme is slated for removal in a later pass; this rev neither builds
for it nor deletes it, and paper keeps rendering correctly by falling back.

**Three known hazards, recorded before building:**

1. `fill-extrusion-pattern` **overrides** `fill-extrusion-color`. The
   generated image must carry the building base colour itself, not windows on
   transparency. This is why the image is regenerated per theme rather than
   tinted: pattern images cannot be tinted the way `fill-*-color` can.
2. **The pattern applies to roofs as well as walls.** Window grids on
   rooftops may look wrong. At pitch 75 the view is mostly walls, so it may
   not matter. This is the most likely thing to fail on contact.
3. **This is texture, not simulation.** Pattern tiling will not align to real
   storey heights. It reads as surface detail; it is not architecturally
   accurate and should not be defended as if it were.

Because of hazard 2, **2.5 is built first and reviewed before the rest of the
material work.** If roofs look wrong, the fallback is to drop the pattern and
keep 2.1 through 2.4, which still delivers a large improvement.

---

## 3. Cat photos

`Cat` gains `photo: string`, a URL. Seeded from a placeholder cat-image
service, one distinct URL per cat.

Rendered as a thumbnail in list rows only. **Not in the plate.** The plate's
3D figure is spec §7's centrepiece and a photograph beside it competes with
it directly.

Two constraints this creates, both of which must be handled:

- **It costs the offline claim at runtime.** `style.ts` describes the basemap
  as "one static file with no CDN in front of it" and the README sells the
  app as working offline. With remote photos, no network means no thumbnails.
  The row layout must therefore survive the image failing to load, and the
  rest of the app must be unaffected. Moving the images into `public/` later
  is a data-only edit to `cats.seed.ts`, which is the point of typing the
  field as a URL.
- Spec §9 keeps v1's cats fictional. Placeholder imagery is consistent with
  that; real photographs of real cats would not be.

`catsRepo.ts` is unchanged. The field rides the existing v1/v2 seam.

---

## 4. Mobile sheet

Below **900px** (the rail's 15rem plus the plate's 26.25rem plus gutters is
roughly where the two collide), the rail and plate stop being independently
positioned panels and become content inside one bottom sheet.

**Desktop is untouched.** The sheet is a presentation of the same components
below the breakpoint, not a second implementation of them.

- Three detents: peek (handle plus a hint of the first row), half (50vh),
  full (92vh).
- Drag handle at the top.
- Content swaps: the cat list at rest, the selected cat's plate on selection,
  with a back affordance returning to the list.
- Non-modal. At peek and half the map behind stays interactive, because the
  map is the point.

### Why a dependency, against this project's instincts

Built with **vaul** (`1.1.2`, declares React 19 in its peer range) rather
than hand-rolled on the already-installed `motion/react`.

The reason is one specific behaviour, not general convenience: at the full
detent, dragging down from inside a scrolled list must scroll the list, not
dismiss the sheet, unless the list is already at `scrollTop: 0`. That
scroll-versus-drag handoff is where hand-rolled sheets break, and it is also
where the accessibility work lives (escape handling, focus behaviour, scroll
locking, non-modal semantics). Spec §8 lists accessibility as
non-negotiable.

This is consistent with the project's stated architecture, "assemble from
registries, hand-author only the identity." A bottom sheet is not identity.

It is also chosen knowing that **the implementing agent cannot self-launch a
browser** and therefore cannot iterate visually on subtle gesture bugs.
Leaning on a library that is already correct is the cheaper path when blind,
not the lazier one.

Fallback if vaul misbehaves under React 19 in practice: `motion/react` drag
with `dragConstraints` and velocity-based snapping, accepting hazard on the
scroll handoff.

### Motion curriculum note

Spec §8 assigns each library exactly one named moment, and §8.1 gives Motion
"the plate". The sheet is the plate's mobile presentation, so vaul owning the
sheet is a new moment for a new library rather than a second moment for
Motion. The curriculum survives.

---

## 5. Explicitly out of scope

Recorded so they are not re-litigated:

- **POI badges, symbol layers, glyphs.** Section 1.
- **Global state** (`map.setGlobalStateProperty`, the `["global-state"]`
  expression). Real, available in 6.3.0, and would genuinely delete the
  theme-rebuild machinery in `Territories.tsx` and `CatMarkers.tsx`. It is a
  refactor of working code that would touch the mechanism the rev4/rev3 merge
  was just built around, and nothing in this rev needs it. Deferred, not
  rejected.
- **Camera movement on selection.** User direction 2026-08-18: the camera
  stays manual. This interacts with section 4, see Risks.
- **Product shape:** tabs, region switcher, contained map, card-list layout.
- **Removing the paper theme.** Slated by the user for a later pass, not this
  one. CLAUDE.md and rev 5 both guard it; that guard stands until the removal
  is its own task.
- **Terrain, globe projection, heatmap, hillshade.** No data, or no purpose
  at this scale.

---

## 6. Risks

- **Facade on roofs.** Section 2.5, hazard 2. Mitigated by building it first.
- **`rounded-corner-distance` may be typed but not rendered.** Confirm early;
  it is one property, so the cost of it not working is nil.
- **Manual camera plus a bottom sheet.** With no camera response to
  selection, a cat selected near the bottom of a phone screen can sit
  underneath the sheet, and the only remedy is the user dragging the map out
  from under a panel they just opened. The sheet's collapsibility is what
  makes this survivable: the map is always one gesture away. If review shows
  it is still a problem, the next cheapest fix is an off-screen direction
  indicator on the sheet edge, not an automatic camera.
- **Photos are a network dependency in an offline-proud app.** Section 3.
- **No visual verification by the implementing agent.** Every gate needs a
  screenshot from the user. `npx tsc -b` and `npm run build` are the only
  checks that can run unattended.

---

## 7. Verification

No test runner exists and none is being added; CLAUDE.md records that
verification here is `npx tsc -b` plus visual review at a gate.

- `npx tsc -b` after each piece, `npm run build` at the end.
- One runnable check: the window-cell scatter in the facade generator is pure
  logic (seed, columns, rows, density, producing a boolean grid), separable
  from canvas drawing and asserted directly. No framework, no dependency.
- Three visual gates, each needing a user screenshot: after the facade, after
  the rest of the map material, after the sheet.

---

## 8. Files

**New**

- `src/map/facade.ts` — canvas generation of the facade pattern, plus its
  `addImage`/`updateImage` lifecycle. Separated from `style.ts` because
  drawing pixels is a different concern from declaring style data, and
  because `style.ts` is already 297 lines and would reach roughly 400 if this
  landed inside it.
- `src/ui/CatRow.tsx` — one list row (thumbnail, name, line). Shared by the
  desktop rail and the mobile sheet so the two can never drift.
- `src/ui/CatSheet.tsx` — the mobile sheet: detents, drag handle, list and
  plate content swap.

**Changed**

- `src/map/style.ts` — casing layer, landcover layer, rounded corners,
  `light`, and the facade pattern wiring in `applyMapTheme`.
- `src/App.tsx` — breakpoint switch between rail and sheet, sheet state.
- `src/shell.css` — row and thumbnail styles, sheet styles, the one media
  query at 900px.
- `src/data/cats.seed.ts` — the `photo` field on the `Cat` type and on each
  of the three seeded cats.
- `src/tokens.css` — any new material token the facade or sheet needs, per
  the token bridge rule in CLAUDE.md: add a token, never a
  `[data-theme=...]` component rule.

**Untouched, deliberately:** `MapLabels.tsx` (section 1), `catsRepo.ts`
(section 3), `Territories.tsx` and `CatMarkers.tsx` (global state is out,
section 5), `Grain.tsx` and the paper theme (section 5).
