# Meowtro — Design

**Date:** 2026-08-16
**Revised:** 2026-08-16 (rev 2 — motion goal changed, see §0; rev 3 — opt-in 3D map mode, see §0b; rev 4 — visual identity pivot to a dark/light glass HUD, see §0c); 2026-08-18 (rev 5 — rev 4's pivot downgraded from a replacement to a third theme, see §0d)
**Status:** Rev 5 implemented. Rev 4's glass HUD ships as the app's two toggleable themes (light default, dark); rev 1-3's field-guide identity is **not** deleted after all — it survives as a third, fully-built theme kept off the toggle. See §0d.
**Scope:** v1 only. v2 is sketched at the end to protect the seams, not to be built.

---

## 0. What changed in rev 2, and why

Rev 1 treated motion as something to ration. Three named moments, everything
else a 120ms fade, GSAP explicitly rejected as "a second animation runtime for
no capability we lack."

**The project goal changed.** This is now a vehicle for learning how to
*integrate animation libraries* — how they mount, how they fight each other,
how they interact with React's lifecycle and with imperative non-React APIs.
That is a different skill from authoring CSS transitions, and it is the one
being practised here.

So the constraint inverts. Rev 1 asked "can we do this with fewer
dependencies?" Rev 2 asks **"does each library teach a distinct integration
pattern?"** A library that duplicates another's lesson still gets cut — but
now the currency is lessons, not kilobytes.

One honest note, recorded once and not re-argued: **no production app would
ship this many animation runtimes together.** Motion and GSAP overlap heavily.
That redundancy is deliberate here and should not be read as a
recommendation. §8 says which one you would actually keep.

What did **not** change: the visual identity (§4), the territory concept (§2),
the data seam (§9), and the v2 safety constraint (§9). Those were right.

---

## 0b. What changed in rev 3, and why

Rev 2 fixed the map at `pitch: 0`, buildings as outline-only linework, no
camera-orientation control beyond click-to-select and native pan/zoom.

**A button-triggered 3D mode is added, opt-in, not the default.** Pressing
it switches the camera to `pitch: 55°` and buildings from outline to real
`fill-extrusion` volumes (Protomaps carries real `height`/`min_height` data
for this — confirmed against the docs, not assumed). Pressing it again
returns to flat. The map still lands exactly as rev 2 specified; this is
additive, not a replacement of the default view.

This came out of a live comparison against a reference site
(`interactive-map-3d.vercel.app` — see `docs/images-reference/` and the
saved view-source `.mhtml`): a scoped "how much of that look is worth
adopting" spike, not a wholesale redesign. Two things were adopted, both
native to MapLibre rather than requiring a rewrite onto three.js: pitched
extrusion for buildings, and a small green canopy layer for `forest`/`wood`
landuse (the reference's clearest "not monochrome" cue). Everything else in
the reference — ambient music, a location-list hamburger menu, night
mode/post-processing, a per-pin photo gallery — was evaluated and cut as
real-estate marketing chrome with no equivalent in a cat field guide.

**Interaction is button-only, deliberately.** Every native gesture that
could pitch or rotate the camera — drag-rotate, touch-rotate, touch-pitch,
keyboard shift+arrow — is disabled. The 3D toggle button (new file,
`map/MapControls.tsx`) is the only way in or out. This is a direct design
decision, not a limitation: it keeps orientation to exactly two known
states, which turns the building/territory-circle occlusion problem (a tall
building can hide a territory behind it at a steep pitch) into a bounded,
testable question instead of one that would need solving for every
possible camera angle. A compass/free-rotate control was considered and cut
for the same reason — bearing can never leave `0` now, so there is nothing
for it to reset.

**Onboarding hint.** A first-visit-only tooltip near the toggle button
(e.g. "Press for 3D"), dismissed on first interaction with either the
button or the map, never shown again per session. No animation under
`prefers-reduced-motion`, a plain fade-in otherwise. Designed here; not yet
built — see the build plan.

**New derived token.** `--building` (`color-mix` of `--paper` 70% /
`--ink-soft` 30%) joins `--rule`/`--rule-strong`/`--well`: still zero new
hex values, still every colour traceable to the five root tokens.

**What did not change.** The default flat view, its outline-only buildings,
the five root colour tokens, the territory-circle concept, and the v1/v2
data seam are all untouched. Rev 3 is scoped entirely to an additional,
optional way of looking at the same map.

---

## 0c. What changed in rev 4, and why

Rev 1-3 committed to a single, non-negotiable identity: a 1950s naturalist
field guide, deliberately reacting against "the default failure mode...
dark UI, glassmorphism, a purple-blue gradient, Inter, and a neon accent"
(§4, rev 1-3). That defence held for three revisions.

**Rev 4 reverses it, deliberately and with eyes open.** The user supplied
two reference mockups (`docs/images-reference/dark-theme.jpg`,
`light-theme.jpg`) specifying a dark/light glass-panel HUD for this exact
app — same content model, named cats, plate numbering, `LINE 03 · TRACK
38TH`-style designations — which is, feature for feature, the look §4 was
written to avoid. This was raised directly and confirmed: the call is a
full pivot, not a variant living alongside the field guide.

This is not the first time the idea surfaced. The build plan's decision
log already recorded a "night-mode variant" backlog item, scoped as a dark
HUD **alongside** the cream design, auto-switched by time of day, with
territories visible only on selection. Rev 4 supersedes that framing: both
palettes now use the HUD language (there is no cream variant left to
switch back to), and the toggle is user-controlled, not time-based. One
piece of that old note is kept — territories move from hatching to a glow
treatment, detailed in §6.

**What did not change.** The territory concept (§2), the plate content and
route-designation motif (§3), the v1/v2 data seam (§9), and the motion
library curriculum (§8) — none of those depend on the paper-vs-glass
material choice.

**Why the anti-slop checklist survives, rewritten rather than deleted.**
"No AI slop" was never really about avoiding dark UI or rounded corners
specifically — those were rev 1's chosen tells for that era's default
failure mode. The actual constraint, restated: *could this have been
produced by prompting for a nice website, with nobody making a deliberate
choice at any step?* Rev 4's checklist (§4) targets 2026's actual tells
instead: Inter/Roboto/Space Grotesk as body/display type, the default
indigo-to-purple gradient, and flat semi-opaque rectangles standing in for
real glass. Doing glassmorphism *well* — real blur, one deliberate accent
colour, a material that holds up next to a real Apple HIG surface — is a
harder, more specific commitment than avoiding the aesthetic altogether,
which is the same logic rev 1 used to justify committing to cream and ink.

**On the font complaint that started this.** Fraunces was never the
generic-AI tell — a live check turned up the opposite: Inter, Roboto and
Space Grotesk are what a generator defaults to, and Fraunces was rev 1's
specific rejection of that. What reads as uncanny in the current build is
more likely the `WONK` axis (`shell.css`, headings set `'WONK' 1`), which
deliberately distorts letterforms for a hand-inked wobble — a legitimate
choice for a print pastiche, and an odd one once the print pastiche itself
is gone. Rev 4 drops Fraunces for the native `-apple-system`/`system-ui`
stack: no webfont weight, and it matches the reference's Apple-HIG-adjacent
card language natively rather than approximating it. `JetBrains Mono`
stays for plate/coordinate labels — it was never the part that was flagged.

---

## 0d. What changed in rev 5, and why

Rev 4 was written as a *replacement*: "the call is a full pivot, not a
variant living alongside the field guide" (§0c), and rev 1-3's cream
identity was to be deleted. Rev 5 keeps the pivot's outcome — the app ships
the glass HUD, light by default, dark by toggle — but **does not delete the
field guide.**

The reason is mechanical, not sentimental. Rev 4 had already built a
`data-theme` attribute on `:root` with two complete palettes behind it, and
every single thing that separated paper from glass (colour, radius, border,
blur, shadow, edge highlight, surface, display face) turned out to be
expressible as a value of a token that already had to exist for the
light/dark split anyway. Paper as a *third value* of that same mechanism
costs one CSS block and changes no component. Deleting it would have cost
more edits than keeping it.

So:

- **`light` and `dark`** are the shipped themes. `light` is the default,
  declared as `data-theme="light"` on `<html>` in `index.html` — a bare
  `:root` is the paper theme, so the default has to be stated or the page
  flashes cream before React mounts.
- **`paper`** is complete and reachable (`data-theme="paper"`), including
  the grain overlay and the Fraunces webfont, but is **not** on the map's
  theme button. The single thing excluding it is the `TOGGLE_THEMES` array
  in `map/style.ts`. The styleguide still switches all three, so the paper
  theme stays exercised rather than rotting.
- Rev 4's claim that "there is no cream variant left to switch back to"
  (§0c) is therefore **withdrawn**. There is one; it is just not offered.

**Also folded in at rev 5**, from the branch that had continued on the rev
1-3 line while rev 4 was built: the cat markers (a DOM pin in flat view, a
ground-plane `circle` with `circle-pitch-alignment: 'map'` in pitched view),
the shared centroid helper they and rev 4's glow both use, native `sky`
atmosphere for the 3D view, and the camera recentre onto Milo's territory.
Rev 4's glow and rev 3's markers were developed independently and both
claimed the MapLibre source id `territory-centroids`; they now hold separate
sources, because the marker layer tears its own down on every flat/3D toggle
and the glow must not inherit that lifecycle.

**What did not change.** Everything §0c listed as surviving the rev 4 pivot
(the territory concept, the plate content, the v1/v2 data seam, the motion
curriculum) survives rev 5 too, plus rev 4's own glass material and theme
machinery, which rev 5 only extended by one value.

---

## 1. What this is

An interactive field guide to the community cats of Bonifacio Global City,
Taguig. Each cat is a named individual with a **roaming territory** drawn on a
custom-styled map, a written profile, and a 3D model you can look at.

Goals, in priority order:

1. **Learn animation-library integration.** Six libraries, each with exactly
   one job in the app, each teaching a pattern the others don't. §8 is the
   real spine of this document.
2. **A visual identity that could not have come from a template.** The
   specific identity changed in rev 4 (§0c, §4); the constraint itself
   didn't — the libraries serve the art direction, not the reverse.
3. **A real community tool, eventually.** BGC has an actual cat-feeder
   community. v1 is seeded and offline, but the data layer is built so a real
   backend slots in behind it without touching the UI.

### Reference class

The awwwards roundup of interactive map and street-view experiences is the
target register: scroll-driven map navigation, narrative geography, WebGL
layered over cartography. The recurring techniques across those examples are
scroll-triggered camera movement, heavily customised map styling, and
story-first sequencing rather than free exploration. All three are adopted
below.

### Non-goals for v1

Sighting reports, community-submitted cats, photo upload, moderation,
accounts, any backend, real-time anything. See §9.

---

## 2. Why BGC, and why territories

BGC is a planned grid: small, walkable, bounded, with legible landmarks (Track
30th, Terra 28th, Burgos Circle, Bonifacio High Street, the Net Park loading
docks). A bounded area means a single small map extract, real coordinates that
mean something, and a dataset a human can verify on foot.

**Territories, not pins.** A pin says "the cat is here," which is false about
every cat that has ever lived. A soft hatched polygon says "this is her
patch," which is true and is the more interesting thing to look at.
Overlapping territories are the payload: they show at a glance which cats
share turf. That single decision is what makes the map read as a cat map
rather than a restaurant finder.

---

## 3. The name

**Meowtro** — Metro Manila, meow. The name reads *transit* while the design
reads *field guide*. Rather than fight that, each plate carries a route-style
designation (`LINE 03 · TRACK 30TH`) so the transit motif has exactly one
place to live. Typographic garnish, not a system: no lines, no interchanges,
no route graph.

---

## 4. Art direction — dark/light glass HUD (rev 4)

The brief, restated for rev 4: **could this have been produced by prompting
for a nice website, with nobody making a deliberate choice at any step?**
The 2026 default failure mode is Inter/Roboto/Space Grotesk type, a default
indigo-to-purple gradient, and flat semi-opaque rectangles standing in for
real glass. The defence is the same as rev 1's: commit to a specific
referent and hold every value to it, rather than avoid a whole aesthetic
wholesale.

The referent: the two user-supplied mockups
(`docs/images-reference/dark-theme.jpg`, `light-theme.jpg`) — a
translucent-glass HUD close to Apple's Find My/Maps card language. Rounded
surfaces, real material depth (blur plus a crisp highlight edge plus a soft
colour-matched shadow, not a flat rectangle with `border-radius`), one warm
accent used for selection and glow, one green reserved for parks.

> **Why rev 1-3's identity is gone, not kept as a variant.** Considered and
> rejected: keeping cream-and-ink as a "day" mode and this as "night." Two
> reference images in the same HUD language, not one cream + one dark, is
> what the user actually supplied — see §0c.

**Implemented** in `src/tokens.css`. Two full palettes, light and dark,
selected by a `data-theme` attribute on `:root` and toggled by the user, not
by `prefers-color-scheme`. The five token names from rev 1-3 are kept
(`--paper`, `--ink`, `--ink-soft`, `--rust`, `--sage`) even though "paper"
no longer names a paper surface — renaming every call site for semantic
purity is churn the change doesn't need; the token is the surface colour
regardless of what the era calls it.

`app.css`'s `@custom-variant dark (&:is(.dark *))` bridge (rev 1-3) existed
to do one thing: stop the OS's `prefers-color-scheme` from restyling a page
that was always cream, by making sure `.dark` was never actually set. Rev 4
repurposes rather than removes it — the toggle now deliberately sets
`data-theme` (light/dark) on `:root`, and it is still never driven by the OS
preference, only by the in-app control. The "never let the OS decide" part
of the original intent survives; only the "so nothing happens" part does not.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--paper` | near-white surface | near-black navy | Ground / glass surface base. |
| `--ink` | near-black text | near-white text | Type. |
| `--ink-soft` | muted grey | muted blue-grey | Secondary type. |
| `--rust` | warm orange | brighter warm orange, glow-capable | The one accent — selection, glow, active state. |
| `--sage` | muted green | brighter green, legible on navy | Parks only. |

Exact hex values are pulled from the reference JPGs during implementation,
not guessed here — still two values per token, so the "no sixth hex"
discipline from rev 1-3 holds, just doubled for two themes.

Derived tokens (`--rule`, `--rule-strong`, `--well`, `--building`) stay
`color-mix` results off those five, and recompute automatically per theme
since `color-mix` reads the live custom property.

New tokens for the material itself, same centralisation as colour: a rounded
radius scale (replacing the ≤4px ceiling), a blur amount, and a shadow
recipe (soft, colour-matched, not a default OS drop-shadow) — no component
hand-tunes its own glass.

Type: **`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
sans-serif`** for display and body — zero webfont weight, and it matches the
reference's native-card feel directly rather than approximating it with a
downloaded face. **JetBrains Mono** stays for coordinates, dates, and route
designations. Two families, no more — unchanged in spirit from rev 1-3, just
a different sans.

Texture: the paper-grain overlay (`Grain.tsx`) is dropped. Glass doesn't
have paper grain; keeping it would be the one leftover tell that nobody
revisited the whole system when the material changed.

### The anti-slop checklist (rev 4)

Replaces the rev 1-3 list in full. The target failure mode changed, so the
checklist enforcing against it has to.

- No Inter, Roboto, Space Grotesk, or Geist. The native system-ui stack or
  nothing.
- No default indigo-to-purple gradient. The only accent is the one warm
  colour; the only other hue is the park green.
- No flat semi-opaque rectangle standing in for glass. Every translucent
  surface needs real `backdrop-filter` blur, a crisp inner highlight edge,
  and a shadow tuned to the theme.
- No copy-pasted radius/blur/shadow values per component. Every glass
  surface pulls from the same small token set.
- No emoji, anywhere.
- No centered hero with a headline and two buttons.
- Every animation must be nameable, and attributable to exactly one library
  per §8 — unchanged from rev 2.

---

## 5. Architecture

```
src/
  main.tsx
  App.tsx
  tokens.css              the design system (implemented)
  styleguide.css          styleguide page only, not shipped in the app
  motion/
    lenis.ts              smooth-scroll singleton + GSAP ScrollTrigger bridge
    useScrollChapter.ts   maps scroll progress -> chapter index
  map/
    MapCanvas.tsx         maplibre instance in a ref
    style.ts              the Protomaps style object (art direction as data)
    territories.ts        GeoJSON layers: fill, boundary, hatch
    cameraTimeline.ts     GSAP timeline driving maplibre camera
  plate/
    Plate.tsx             the cat detail panel
    CatModel.tsx          react-three-fiber canvas
    InkMark.tsx           Lottie ink-stamp on plate open
  data/
    catsRepo.ts           listCats() / getCat(id)  <- the seam
    cats.seed.ts          the twelve cats
    territories.geo.json
public/
  bgc.pmtiles             map extract, static file
  cat.glb                 one model
  ink-stamp.lottie        one Lottie file
  hatch.png               hatch sprite
```

### Stack

| Layer | Choice | Why it beat the alternative |
|---|---|---|
| App | Vite + React + TS | **Next.js** — no backend, no SSR, no routing beyond a panel. Dead weight and a deploy story we don't need. |
| Map | `maplibre-gl` directly | **react-map-gl** — a wrapper around ~40 lines of `useEffect`. We need the imperative API for `flyTo` and `feature-state`, and §8 needs to drive the camera from outside React entirely. |
| Tiles | **Protomaps** `.pmtiles` extract of BGC | **MapTiler / Stadia** — both need an API key, both meter you, both ship a house visual language. A BGC-only extract is a few MB of static file: no key, no quota, works offline, style fully authored by us. That last part *is* the art direction. |
| 3D | react-three-fiber + drei | Raw three.js — R3F's declarative model composes with React state, which is how the plate drives the scene. |
| Toon look | `MeshToonMaterial` + drei `<Outlines>` | A custom GLSL outline pass. Built-ins land the ink look with zero shader code; revisit only if they visibly fall short. |
| Model | **One** CC0 low-poly cat, tinted and pattern-swapped per cat | Twelve models — twelve times the sourcing and payload for a difference nobody perceives at plate scale. |

Animation libraries are specified separately in §8, because in rev 2 they are
the subject rather than a supporting choice.

### Data flow

```
catsRepo.listCats()
      ↓
  App holds  selectedCatId: string | null
             chapter: number          <- new in rev 2, owned by scroll
      ↓                        ↓
  MapCanvas                  Plate
  (paints layers,            (renders profile,
   camera driven by GSAP,     mounts CatModel + InkMark)
   emits clicks) ─────────────┘
```

Two pieces of shared state now: `selectedCatId` and `chapter`. Still no store,
no context, no reducer — two `useState` in `App` and props down. If a third
appears, revisit.

> **Integration hazard, stated up front.** `chapter` is written by GSAP
> ScrollTrigger, which lives outside React, and read by React components.
> That boundary is the single most instructive thing in this project and the
> most common source of bugs: stale closures, double-firing under
> `StrictMode`, and ScrollTrigger measuring before layout settles. §8.3 covers
> the handling.

---

## 6. The map layer

**Style.** Authored by hand in `map/style.ts` against the MapLibre style spec:

- Ground `--paper`, water a pale wash, parks `--sage` at low opacity.
- Buildings as **thin outlines only**, no fill. BGC's towers become an
  architectural drawing rather than a field of blocks. The single most
  identity-defining line in the stylesheet — true of the default flat view;
  rev 3 adds an opt-in mode where this is intentionally suspended, see below.
- Labels suppressed except parks and the three or four streets that orient
  you. A field survey is sparse; a basemap is not.

**Territories.** Each cat owns one GeoJSON polygon, rendered as three stacked
layers:

1. `fill` — the cat's colour at `0.14` opacity. Overlaps darken naturally,
   which is exactly the shared-turf signal we want, for free.
2. `line` — dashed ink boundary, `1.5px`.
3. `hatch` — one shared `fill-pattern` sprite above everything at low opacity.

> **Known constraint:** MapLibre cannot tint a `fill-pattern`. Hence one
> shared uncoloured hatch sprite, with per-cat identity coming from the fill
> beneath it. Per-cat coloured hatching would mean generating twelve sprites
> at build time — deferred until demonstrably missed.

Selection uses `feature-state`, not layer rebuilds: the selected territory
goes to `0.32` opacity and gains a `--rust` boundary while every other drops
to `0.05`.

> **Rev 4 — glow treatment.** Hatched fill is replaced by a thin outline.
> The outline and fill (the pre-existing `line`/`fill` layers) stay always
> visible at low resting intensity, unchanged in spirit from before rev 4,
> so overlapping territories still read as shared turf at a glance — the
> payoff §2 is built around, kept deliberately rather than lost to the
> reference's selection-only look. Selecting a cat brings its outline to
> full colour and adds a glow: a third, new `circle` layer at each
> territory's centroid, not a DOM overlay, whose `circle-blur` paint
> property gives the soft radial falloff for free. Unlike the outline/fill,
> the glow itself is selection-only — zero radius and opacity for every
> non-selected state — matching the reference's clean "one spotlight" look
> and avoiding three overlapping blurs turning the resting map into a haze.
>
> The glow does **not** read `feature-state`, unlike the fill and line
> layers — this was tried first and abandoned: MapLibre does not transition
> feature-state-derived (data-driven) paint values, only constant or
> camera-only (zoom-based) ones, so a feature-state-driven radius/opacity
> would snap instead of bloom. The working mechanism is a layer `filter` set
> to the selected cat's id, plus direct `setPaintProperty` calls on
> `circle-radius`/`circle-opacity` fired once per selection change (not
> per-cat; `circle-color` is set separately, on theme change, the same
> token-reread pattern the fill/line layers already use). The filter is
> pinned through a ref rather than tracking `selectedId` directly, so a
> deselect fades the glow out on the feature it was already showing instead
> of yanking the filter to a non-matching id before the fade can play.
> `circle-radius`'s selected value is itself a zoom-interpolate expression,
> camera-only so it still transitions, so the glow's on-screen size tracks
> the territory's actual geographic size across the map's zoom range rather
> than a fixed pixel radius. The general lesson, worth keeping for future
> layers: reach for filter + camera-expression whenever something
> feature-specific needs to actually animate in/out, not feature-state.
>
> **Rev 4 — live theme switching.** `map/style.ts` currently resolves
> colour once via `getComputedStyle` at construction time. Flipping
> `data-theme` on `:root` doesn't repaint an already-built MapLibre style by
> itself, so the toggle handler re-resolves each token and calls
> `map.setPaintProperty()` per layer, rather than `map.setStyle()` (which
> would flicker and re-fetch/re-parse the whole style). Same token-read
> pattern `style.ts` already has, just triggered on toggle instead of once
> at load.

**New in rev 2 — the map is a scroll stage.** The map pins full-viewport while
the narrative column scrolls over it. Camera position is a function of scroll
progress, not of clicks alone. Clicking still works and still wins: a click
jumps the scroll position to that cat's chapter, so the two input modes stay
in sync rather than fighting.

**New in rev 3 — an opt-in 3D mode.** A button (bottom-right,
`map/MapControls.tsx`) toggles the camera between the default flat view and
`pitch: 55°` with buildings rendered as `fill-extrusion` volumes (the
`--building` token, not `--ink`) instead of outlines. A `forest`/`wood`
canopy layer in `--sage` renders only alongside the extrusion. Every native
drag/touch/keyboard gesture that could change pitch or bearing is disabled —
the button is the only control, which keeps camera state to two known
positions rather than a continuous range. See §0b.

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

Per-cat variation is material-level: base tint plus a swappable pattern
texture (tabby / tuxedo / calico / solid). Ear notches and individual marks
are described in the text, not modelled.

**Fallback.** If WebGL is unavailable, the plate renders a static illustration
in the same frame. The page must not depend on 3D to be readable.

---

## 8. Motion — the library curriculum

**This is the spine of rev 2.** Six libraries. Each owns a named moment and
teaches one integration pattern the others cannot.

| # | Library | Owns | Integration lesson |
|---|---|---|---|
| 8.1 | **Motion** (`motion/react`) | Plate enter/exit, list stagger, layout shifts | Declarative, React-idiomatic. Exit animations via `AnimatePresence` — the thing React cannot do alone. |
| 8.2 | **Lenis** | Page smooth-scroll | A library that hijacks a global browser behaviour. Teaches teardown discipline and RAF ownership. |
| 8.3 | **GSAP + ScrollTrigger** | Map camera along scroll | Imperative timeline driving a **non-React** imperative API. The hardest and most valuable integration here. |
| 8.4 | **react-three-fiber + drei** | The 3D cat | A React reconciler targeting something that isn't the DOM. |
| 8.5 | **Lottie** (`@lottiefiles/dotlottie-react`) | Ink-stamp on plate open | Consuming a designer-authored artifact and driving its playback from React state. |
| 8.6 | **SVG `stroke-dashoffset`** (no library) | Territory ink-in on load | The control condition. Proves which moments needed a library and which did not. |

### 8.1 Motion — the plate

`AnimatePresence` around the plate. Enter: slide from `x: 24` with opacity, 
~320ms. Exit: reverse, ~200ms. Profile rows stagger in at ~40ms intervals.

*Why this library:* exit animation is the capability React genuinely lacks —
an unmounting component is gone before you can animate it. This is the clean
justification for a declarative animation library, and worth feeling directly.

### 8.2 Lenis — smooth scroll

A single instance created in `motion/lenis.ts`, started on mount, destroyed on
unmount.

**The gotcha that makes this worth doing:** Lenis and GSAP both want to own
the requestAnimationFrame loop. Running two independent RAF loops causes
visible desync between scroll position and ScrollTrigger's idea of it. The fix
is to drive Lenis from GSAP's ticker and disable Lenis's own RAF. Getting this
wrong produces jitter that looks like a performance problem and is not — which
is exactly why it teaches something.

Lenis is **disabled entirely** under `prefers-reduced-motion: reduce`. Native
scroll returns untouched.

### 8.3 GSAP ScrollTrigger — the map camera

The centrepiece. The map pins for the height of the cat narrative. A GSAP
timeline maps scroll progress to camera state, calling `map.jumpTo()` on each
update with interpolated centre, zoom and bearing.

**Use `jumpTo`, not `flyTo`.** `flyTo` runs its own easing on its own clock;
driving it from a scrub timeline means two animations fighting over one
camera. Scroll-driven camera work interpolates values yourself and jumps.
`flyTo` is still correct for the click path (§6), where the user is not
scrubbing.

Four hazards to expect, in the order they will bite:

1. **Init order.** ScrollTrigger must be created after the map fires `load`,
   or it measures against a map with no layers.
2. **StrictMode double-mount.** Development mounts effects twice. Every
   trigger must be killed in the effect cleanup or you get two timelines and
   double-speed camera movement.
3. **Stale closures.** The `onUpdate` callback captures state from the render
   that created it. Read mutable values through a ref.
4. **Refresh on resize.** `ScrollTrigger.refresh()` after the map container
   resizes, or pin distances are wrong on rotate.

GSAP and all its plugins including ScrollTrigger are free to use.

Under reduced motion: no pinning, no scrub. The narrative becomes a plain
document and each chapter heading `jumpTo`s the camera on intersection.

### 8.4 react-three-fiber — the 3D cat

Covered in §7. The lesson is the reconciler: `<mesh>` is not a DOM element,
and R3F renders React trees into a three.js scene graph. Teaches that React is
a reconciliation model, not a DOM library.

Frame loop set to `demand` while idle so a static cat doesn't burn a
continuous render loop.

### 8.5 Lottie — the ink stamp

One small Lottie: an ink stamp pressing down, as though the plate number were
rubber-stamped onto the page. Plays once per plate open, ~600ms.

*Why this library:* it is the only one here where the animation is **data
authored elsewhere**. The lesson is the boundary — the file arrives from a
designer, you control `play()` / `stop()` and speed from React state, and you
do not author the motion in code at all. That is a different working
relationship from every other library on this list, and the most common one on
real teams.

Keep it to one Lottie. This is the library most likely to be over-applied.

### 8.6 The control — territory ink-in

On first load, territory boundaries draw themselves via `stroke-dashoffset`,
hatching fading in behind. Once, ~900ms, staggered ~60ms. **No library.**

*Why it stays hand-rolled:* it is the moment that most defines the project —
"this map was drawn, not generated" — and it needs about eight lines of CSS.
Having one moment with no library is what makes the other five honest. When
you have finished, compare it against what a library would have cost.

### If you kept only one

**Motion.** It covers 8.1 and could cover 8.6 acceptably. GSAP earns its place
only because of the scroll-pinned camera in 8.3 — remove that feature and GSAP
leaves with it. Recording this so the curriculum is never mistaken for a
production recommendation.

### Accessibility — not negotiable

- Every one of the six respects `prefers-reduced-motion: reduce`.
- The scroll narrative must be fully reachable by keyboard. Pinned scroll
  sections are a known keyboard trap; each chapter gets a real focusable
  heading and skip-links bypass the pinned section entirely.
- Nothing may auto-play with sound. Nothing may trap focus.
- The site must remain readable and navigable with JavaScript animation
  disabled — content first, motion as enhancement.
- **Rev 3.** The 3D toggle is a real `<button>`, keyboard-focusable and
  operable with no special handling. Its camera transition collapses to
  near-instant under `prefers-reduced-motion`, the same pattern as the
  `--dur-*` tokens elsewhere.

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
- **Community-submitted cats** — an unnamed cat enters a pending state for the
  community to name.
- **Photos** — real portraits alongside the 3D plate.

Each needs a backend, moderation, and abuse handling. None is worth building
before the map earns an audience.

### Safety constraint on v2 — decided now, because it constrains v1

Precise public locations of stray animals are a genuine safety problem; people
who harm animals use exactly this kind of data. When real cats and real
reports arrive:

- Display territory polygons only. **Never an exact point for a real cat.**
- Report submission may capture a precise coordinate, but the public layer
  renders only the blurred polygon derived from it.
- Never publish a feeding schedule.

v1 changes nothing today — seeded cats are fictional. Recorded here so v1
never architects itself into a point-location API it would later tear out.

---

## 10. Testing

Proportional to a static front end with no backend:

- **`catsRepo` and territory geometry** — plain assertions: every cat
  resolves, every territory is a closed valid polygon, every cat's polygon
  falls inside the BGC bounding box. Catches the realistic failure —
  fat-fingered coordinates putting a cat in Laguna de Bay.
- **Teardown** — new in rev 2, and the one thing here worth automating.
  Mount and unmount the app; assert zero live ScrollTriggers, zero Lenis
  instances, and zero WebGL contexts remain. Leaks from six animation
  libraries are the defining failure mode of this architecture, and they are
  invisible until the page has been used for a while.
- **Manual, per-moment** — each of the six §8 moments checked once at reduced
  motion and once without.
- **No component tests** for panels that render text from a typed array. The
  type checker covers that.

---

## 11. Definition of done for v1

- Twelve cats, twelve verified territories, all inside BGC.
- Custom Protomaps style ships with no API key and no network call to a tile
  vendor.
- All six §8 moments implemented, each attributable to exactly one library.
- Scroll-driven camera works, and degrades to intersection-triggered `jumpTo`
  under reduced motion.
- Rev 3's 3D toggle switches cleanly between flat and pitched views, no
  drag/touch/keyboard gesture changes orientation outside the button, and
  the transition respects reduced motion.
- 3D plate works, and degrades to a static illustration without WebGL.
- Keyboard-navigable end to end, including past the pinned section.
- Teardown test passes: no leaked triggers, instances, or GL contexts.
- The anti-slop checklist (§4, rev 4) passes on review.
- Deploys as static files.
- **Rev 4.** Both themes reviewed against their reference JPGs. Toggle
  switches instantly with no map flicker. Text contrast checked against both
  the navy and light surfaces (WCAG AA). Territory glow legible and
  performant with all cats' outlines visible at once, not just the selected
  one.
