# Meowtro — Implementation Plan

**Created:** 2026-08-16
**Design spec:** [`../specs/2026-08-16-meowtro-design.md`](../specs/2026-08-16-meowtro-design.md) (rev 2)
**Visual version of this plan:** https://claude.ai/code/artifact/018f76cd-3ccc-4e62-a168-bc469499f918

> This file is the **checkpoint**. It is the one place that records where the
> work stopped and what happens next. Update the checkboxes and the "Resume
> here" block as phases complete — a new session should be able to read only
> this file and carry on.

---

## RESUME HERE

**Last completed:** phase 8, roles and review, 2026-08-25. The full
write-up including the four design decisions is in the feature roadmap.
Two things to know before touching data: `catsRepo` is now the review
boundary (its public reads return surveyed rows only, and the predicates
behind that live in `data/sightings.ts` so `map/Territories.tsx` can apply
the same policy synchronously), and `?role=admin` mounts `RecordCat` plus
the new `ui/ReviewQueue.tsx`. `npm run check:review` guards the boundary.
**Not yet looked at:** the queue panel and the admin corner.

Before that: the pmtiles failure state and twelve cats, 2026-08-25.
Both are written up in the feature roadmap's cross-cutting section. Two
things from them are worth knowing here. The survey is twelve cats on an
eight-colour palette (`--cat-*` in `tokens.css`, the single list is
`CAT_COLOURS` in `data/cats.seed.ts`, and `npm run check:palette` holds it
to AA in all three themes). And the map now has a failure state:
`map/mapError.ts` decides what counts as fatal, `npm run check:maperror`
covers it. **Neither has been looked at yet** — twelve markers at this zoom
and the rail at twelve rows both want a pair of eyes.

Before that: the front door and its review, 2026-08-25. Phase 7's
landing page shipped and was then read back end to end; what that turned up
is fixed and written up in the feature roadmap
(`2026-08-24-feature-roadmap.md`, phase 7), which is where landing work is
tracked. `npx tsc -b` and `npm run build` pass. **Not yet visually
reviewed.**

The one thing to know before touching anything: **`index.html` is the
landing now and the app is `app.html`.** The landing used to be
`landing.html`, which nothing linked to, and its Explore button pointed at
the app on `/`. Deep links are `/app.html?cat=milo`. `head.html` is a
shared `<head>` for those two pages, injected by a plugin at the bottom of
`vite.config.ts`; the styleguide deliberately does not use it.

Before that: Weather, 2026-08-24 (below). Before that, Phase 9.

---

## Weather: rain and storm, 2026-08-24

Not a numbered phase; picked up from the backlog. `npx tsc -b` and
`npm run build` both pass. **Not yet visually reviewed.**

`Weather` in `map/MapCanvas.tsx` is now `clear | rain | storm`, stepped
through by `WEATHERS` using the same `indexOf + 1 % length` arithmetic
`TOGGLE_THEMES` already uses for the theme button. Still a mock: there is
no feed behind it, same honest framing the record panel gives its
local-only storage.

**Storm is two things, and only one of them is new code.**

- `map/Rain.tsx`'s five module constants became one row per weather
  (`FALL`). Storm is that table turned up: ~1.85x the drops at half again
  the speed, falling **dead vertical**. No second canvas, no second loop.
  `clear` shares rain's row outright.
- `map/Storm.tsx` is new: a **veil** (flat `--storm-veil` tint, CSS
  transition) and a **flash** (radial `--storm-flash` gradient on
  `mix-blend-mode: screen`, driven by WAAPI). Strikes are scheduled on a
  randomised 1.6-4.8s gap, each one an envelope of 1-3 pops with an instant
  attack and a long ease-out decay, at a randomised horizontal origin and
  peak brightness. No drawn bolt: city-scale lightning is sheet lightning,
  and a zigzag polyline is what makes this read as a screensaver.

**The storm is windless by direction (2026-08-24), and the two settings
above are a pair.** Storm's row sets both `wind` and `gust` to zero, opting
out of the slant the rest of that file argues for, because this storm is a
downpour rather than a squall. Lightning was made correspondingly frequent
in the same change: with the rain no longer conveying direction, the
strikes carry it instead, each one landing somewhere different across the
sky. Do not restore storm's slant without revisiting the strike rate, or
two things end up saying the same thing.

### The cloud deck, removed, 2026-08-24

`map/Clouds.tsx` and `map/clouds.glsl.ts` are **deleted**, along with the
`--cloud` / `--haze` tokens (no other consumer) and the `.clouds` CSS.

It was reported as feeling wrong when zooming, and the root cause was real:
the shader sampled the deck from pixel coordinates only, with nothing from
the camera in it, so the city panned and zoomed underneath a cloud pattern
that never moved. That was fixed first, by feeding `uPan` / `uScale` in and
sampling `uPan + deck / uScale`. The fix worked and was verified
numerically, and the deck still did not look good enough to keep, so the
user called it: remove it rather than keep tuning.

**Do not rebuild this as "the fallback".** `style.ts`'s note on the native
`sky` used to point here as Plan B; that pointer is now a warning instead.
The native `sky` is the only atmosphere, and its ceiling (a slow haze
breath, no shapes) is accepted rather than worked around. If some future
pass does want a deck, the two things that made this one hard are: it has
to be anchored to the camera or it reads as dirt on the lens, and a
photoreal cloud over a flat-shaded vector city reads as two different
pictures.

Kept from that work: the `sky` breathing animation, and the storm veil,
which took over `--dur-plate` as its transition.

**`GAP_MS`'s 1.6s floor is a WCAG 2.3.1 constraint, not taste.** A strike
is up to three pops inside its first ~200ms, and the rule allows no more
than three flashes per second for something covering this much screen. At
a 1.6s floor the envelopes cannot overlap, so any one-second window holds
at most one strike. Dropping below ~1.2s requires cutting the pop ceiling
to match.

**Three decisions worth not re-litigating:**

- **The veil is why one blend mode works in both themes.** Screening onto
  light's near-white ground has no headroom, so the flash would have been
  invisible in the *default* theme. Grading the map down first is what
  gives it somewhere to go, exactly as a night exterior is graded in film.
- **The veil sits at z-index 1 *before* `<MapLabels>`, and that ordering is
  an AA constraint, not a preference.** Street labels are `--ink-soft` on
  `--paper` = 4.67:1 in light, barely past the floor the palette was tuned
  to; veiling them takes the composite to 2.32:1. A mock weather toggle
  must not push real text under AA. The ground and markers dim, the guide
  does not. The flash is a rung higher (above the labels, below the rain)
  because a strike lights what is in front of it.
- **Reduced motion disables the flash entirely** rather than softening it.
  Photosensitivity overlaps heavily with that preference, so this is the
  one place the usual "reduce, don't remove" rule is wrong. The veil is
  CSS and stays, and Rain already freezes its field under the same query,
  so a reduced-motion storm is a dark map under a still diagonal hatch.

`strikeKeyframes()` is exported with no in-app consumer, deliberately: its
offsets are assembled from four random ranges and WAAPI throws if they are
not strictly increasing. Verified outside the browser over 200k strikes
(esbuild transform + assertions on offsets, envelope endpoints, opacity
range, flicker front-loading, and first-pop-brightest). There is no test
runner to hang it on, so re-run it that way if the numbers are retuned.

**Still open:** overcast, which is now the cheapest of the three: one more
union member, one more `FALL` row (rain's), and the veil with no strikes
scheduled. No new code.

---

## Phase 9, rev 6: the map material pass, 2026-08-18

Built on branch `rev6-map-material-and-sheet`. `npx tsc -b` and `npm run build` both
pass. **Not yet visually reviewed**; three gates are open and each needs a
screenshot from the user (the agent cannot self-launch a browser, see gate
3's decision below).

Design spec: [`../specs/2026-08-18-map-material-and-sheet-design.md`](../specs/2026-08-18-map-material-and-sheet-design.md)
Plan: [`2026-08-18-rev6-map-material-and-sheet.md`](./2026-08-18-rev6-map-material-and-sheet.md)

Before rev 6 started, the **Clouds** work (both plans, plus the sky pitch-floor
fix) was found sitting uncommitted in the working tree from an earlier
session and was committed first, as `9223b6c`, so it could not be lost under
the rev 6 edits to the same three files.

**What rev 6 shipped:** per-theme building facade texture
(`fill-extrusion-pattern` from a runtime canvas, `map/facade.ts`), road
casing, the previously unused `landcover` layer, per-theme directional
`light`, a `photo` URL on `Cat` with thumbnails in a shared `ui/CatRow.tsx`,
and a vaul bottom sheet below 900px (`ui/CatSheet.tsx`).

**What rev 6 deliberately did not ship:** POI category badges. The user was
given the density trade directly and chose the field guide, so spec §6's
sparse-labelling rule stands and no `symbol` layer or glyph pipeline was
built. Rounded building corners were planned and dropped:
`fill-extrusion-rounded-corner-distance` is in maplibre-gl 6.3.0's
TypeScript types but absent from the runtime style spec, so the validator
would reject it. Recheck on a future MapLibre bump.

---

## Phase 8 — the rev 4 / rev 3 branch merge, 2026-08-18

**The shape that came out of it:**
- **Three themes, one mechanism.** Rev 4's `data-theme` attribute on
  `:root` gained a third value, `paper` — rev 1-3's cream/Fraunces/grain
  field-guide identity, which rev 4 had scheduled for deletion. Every
  paper-vs-glass difference turned out to already be a token rev 4 needed
  for its own light/dark split (`--radius`, `--panel-border`,
  `--blur-glass`, `--shadow-glass`, `--edge-highlight`, `--surface-glass`,
  `--surface-glass-strong`, `--surface-hover`, `--font-display`), so paper
  costs one CSS block and no component branches. `shell.css` carries one
  rule set for `.rail`/`.plate`/`.map-control`, not two.
- **The app ships light (default) and dark.** Per user direction
  2026-08-18: day/night on the map's toggle, paper kept in code but off it.
  The only thing excluding paper is the `TOGGLE_THEMES` array in
  `map/style.ts`. Its tokens, `Grain.tsx`, the Fraunces `<link>` and the
  styleguide's paper column are all still live and still built — **do not
  garbage-collect them for being unreferenced by the app.** The styleguide
  switches all three, so paper stays exercised.
- `data-theme="light"` is declared on `<html>` in `index.html` /
  `styleguide.html`, not in React: a bare `:root` *is* the paper theme, so
  the default has to be stated or the page paints cream for one frame.
- **Two collisions resolved.** Rev 4's glow layer and rev 3's cat markers
  were built independently and both claimed the MapLibre source id
  `territory-centroids`; the glow moved to `territory-glow-centroids`, and
  they now share `map/centroid.ts` (rev 4's inline `centroidOf` deleted) so
  a pin and a glow can never disagree about where a cat is. `MapContext`
  carries both `isFlat` and `theme`, replacing rev 4's prop-drilling.
- **Canvas re-theme, three paths.** `applyMapTheme()` (basemap layers +
  `setSky`, so the clouds follow the theme too); `Territories.tsx`'s
  theme-keyed `setPaintProperty` effect; `CatMarkers.tsx` folding `theme`
  into the teardown/rebuild it already does on the flat/3D toggle.
- `style.ts` kept rev 4's `probe.style.color = ''` reset — it matters far
  more now than it did when tokens were read once, since an invalid value
  silently leaves the *previous* token's colour in place on every re-theme.
- Docs reconciled: master's newer README and cat-markers decision-log
  entries kept, the worktree's refined §6 glow write-up and ticked Phase 7
  checkboxes kept.

**Phase 6 items** (keyboard pass, teardown/geometry tests, reduced-motion
audit) remain open — untouched by Phase 7 or 8, still pending from before.

**Phase 5, for context — plate & 3D, built 2026-08-16.** `npx tsc -b`
and `npm run build` both pass. **Current shape:**
- The plate is a Motion `motion.article` inside `<AnimatePresence mode="wait">`
  in `App.tsx`, conditionally mounted. Enter `x:24 → 0` 320ms, exit 200ms,
  `dl` cells stagger 40ms. The old CSS transition and `[data-open]` block
  are gone from `shell.css` — Motion is the only owner of that animation.
- `plate/CatFigure.tsx` is the R3F scene: orthographic camera, `<Bounds fit>`
  instead of hand-tuned zoom, flat `meshToonMaterial` in the cat's own
  territory token with a 2px NEAREST gradient ramp, drei `<Outlines>` for
  the ink edge, 4°/s Y rotation, `OrbitControls` with pan/zoom off and
  polar angle clamped to the horizon. Lazy-imported, so three.js is a
  separate 992 kB chunk that only loads on first plate open.
- `public/cat.glb` — "Cat" by Poly by Google via Poly Pizza, 43 kB, **CC-BY**,
  credited in the map attribution control. Only its geometry is used; its
  texture is discarded (see decision log). **Swapping models:** drop a new
  single-mesh `.glb` in as `public/cat.glb` and update that credit line —
  `<Bounds fit>` + `geometry.center()` mean there is nothing else to retune.
- Deleted: `map/cameraTimeline.ts`, `map/ScrollZoom.tsx`, `.scroll-zoom`
  CSS, `mockup.html`.
- Lenis (`motion/lenis.ts`) stays mounted via `useLenis()` in `App.tsx`,
  still inert (no scrollable content). Kept as spec §8.2's library lesson.

**Gate 5: passed** — user confirmed the plate visually, 2026-08-16, and
separately accepted the cat as it stands. The two things built blind
(`<Bounds margin={1.5}>` and the two-step toon ramp) needed no tuning.

**Next up:** Phase 6 — polish & proof. Two of its items are already
superseded by the phase 4 revert: there is no pinned section to provide a
keyboard path past, and the teardown test's ScrollTrigger assertion now
only guards against regressions rather than live triggers. Also still
open: gate 2 was built but never formally reviewed, and spec §8.3's GSAP
lesson is currently unrepresented in the app.

**Phase 6 progress, 2026-08-16:** §8.6 (territory ink-in) built. §8.5
(Lottie ink stamp) was built, then **removed same day on user feedback**
("it looks dirty") — spec §8's six-library curriculum is now five; see
decision log. Also fixed the same day: the plate's 3D cat visibly zoomed
in then out on open — two overlapping `<Bounds fit>` animations racing
during canvas mount (see decision log). `npx tsc -b` and `npm run build`
both pass. Remaining phase 6 items: keyboard pass (rescoped — no pinned
section left to route past), motion-moments audit at reduced-motion,
teardown test, geometry test, anti-slop review, deploy.

### How the basemap bug actually resolved

The `maxBounds`-vs-viewport suspicion from the prior session was correct, but
the fix wasn't to drop `maxBounds` — it was that the **pmtiles extract itself
was too small**. The original cut was 0.028° × 0.026° (bbox
`121.036,14.538,121.064,14.564`); at z14.6 that's narrower than almost any
real desktop viewport (≈0.028° covers ~990px; the user's browser was ~1900px
wide, needing ≈0.054°). Below that width the map rendered fine on the left
and showed flat `--paper` background (no tile data, no error) past the
extract's edge — indistinguishable from a broken map at a glance.

Fix: re-cut a ~4x larger extract from `build.protomaps.com` with `go-pmtiles`
(binary fetched from GitHub releases, not installed on this machine), same
center, bbox `120.994,14.499,121.106,14.603`, still z0–15. Committed over the
old `public/bgc.pmtiles` (2.6 MB → 10.4 MB — still "a few MB"). `BGC_BOUNDS`
in `map/style.ts` updated to match, and `maxBounds: BGC_BOUNDS` is back on
in `MapCanvas.tsx` — now safe because the extract comfortably exceeds any
realistic viewport at this zoom, so panning to the edge shows the intended
clamp, not a false negative.

```bash
npm run dev                         # http://localhost:5173
```

Next commands, from `app/front-end/`:

```bash
npx tsc -b && npm run build
```

---

## Working agreement

Each phase ends at a **gate** — something visible that gets reviewed before the
next phase starts. Nothing proceeds past a gate unreviewed.

| Gate | What is shown | Cheap to change at this gate | Expensive after it |
|---|---|---|---|
| 1 · Foundation | Live styleguide page | Any colour, type size, spacing | Palette — every installed component inherits it at gate 2 |
| 2 · Bridge | One test component wearing our palette | Radius, shadow policy, which registries | Token naming — later components bind to it |
| 3 · Map | Styled BGC map + territories, no motion | Map colours, label density, polygon shapes | Territory geometry — the camera is authored against it |
| 4 · Narrative | Scroll-driven camera over pinned map | Pacing, chapter order, easing, camera travel | Scroll architecture — pinning decides page structure |
| 5 · Plate & 3D | Panel opening, cat turning | Panel layout, model tint, rotation speed, copy | Little — this phase is isolated by design |
| 6 · Polish | Keyboard + reduced-motion passes, teardown test | Final timings, the one Lottie | Nothing. This is where it ships. |
| 7 · Rev 4 HUD pivot | Both themes toggling live, against their reference JPGs | Exact hex values, radius/blur amounts | The `data-theme` attribute mechanism and the `setPaintProperty`-based map re-theme approach — later map layers bind to this pattern |

Gates 3 and 4 are the two worth slowing down for. Phase 5 can be built out of
order.

---

## Current state of the tree

```
meowtro/
  README.md
  docs/superpowers/
    specs/2026-08-16-meowtro-design.md    design spec, rev 2
    plans/2026-08-16-meowtro-build-plan.md  <- this file
  app/front-end/
    index.html          loads Fraunces + JetBrains Mono from Google Fonts
    components.json     shadcn config — style radix-nova, css src/app.css
    public/
      bgc.pmtiles       the basemap extract, 10.4 MB
      cat.glb           the 3D cat, CC-BY, Poly by Google via Poly Pizza
      cat-loading.json  unwired, staged for a future loading-state attempt
      dotlottie-player.wasm  unwired, local copy of dotlottie's engine (not unpkg)
    vite.config.ts      react + tailwind plugins, '@' -> ./src alias
    tsconfig.json       paths: @/* -> ./src/*
    src/
      main.tsx
      App.tsx           the app shell: map + rail + plate
      Grain.tsx         the paper grain, hand-authored
      Styleguide.tsx    the design-system proof page, its own entry
      app.css           Tailwind on + THE BRIDGE (shadcn names -> our tokens)
      tokens.css        THE DESIGN SYSTEM — five colours, type scale, durations
      shell.css         the app screen's layout
      styleguide.css    styleguide page only, not shipped in the app
      lib/utils.ts      cn(), from shadcn init
      components/
        ui/button.tsx     pulled: shadcn, radix
        FadeContent.tsx   pulled: React Bits (brought gsap with it)
      data/             catsRepo.ts (the v1/v2 seam), seed, territories
      map/              MapCanvas, style, Territories, MapLabels
      motion/lenis.ts   smooth scroll, currently inert
      plate/            Plate.tsx (Motion), CatFigure.tsx (R3F)
```

**Installed:** react 19, react-dom, vite 7, typescript, @vitejs/plugin-react,
tailwindcss 4, @tailwindcss/vite, shadcn 4, radix-ui, lucide-react,
class-variance-authority, clsx, tailwind-merge, tw-animate-css, gsap,
maplibre-gl, pmtiles, lenis, motion, three, @react-three/fiber, drei.

**Not yet installed:** a test runner (phase 6's teardown/geometry tests need
one). `@lottiefiles/dotlottie-react` was installed and removed twice today
(§8.5's ink stamp, then a plate-loading indicator) — see decision log.
`public/cat-loading.json` and `public/dotlottie-player.wasm` are left on
disk, unwired, for a future attempt.

> **gsap arrived early**, as a dependency of React Bits' `FadeContent`, not by
> our choice. Phase 4 wanted it anyway — though after the phase 4 revert there
> is no ScrollTrigger left in the app.

Run it: `cd app/front-end && npm run dev` → `/` is the app,
`/styleguide.html` is the design system.

---

## Strategy

**Install the mechanism, own the identity.**

Component registries supply behaviour. They arrive styled like every other site
on the internet. We bridge our five tokens into the shadcn variable names
**once**, and everything pulled afterwards inherits the field-guide palette
automatically.

Only three things stay hand-written, because they *are* the project:

1. The map style (`map/style.ts`)
2. The territory layers
3. The paper grain

Everything else is an install.

### Registry access — verified 2026-08-16 by direct probe

| Registry | Key needed | Probe | Role |
|---|---|---|---|
| mapcn — `https://mapcn.dev/r/map.json` | No | 200 | MapLibre wrapper: markers, popups, tooltips, controls |
| React Bits — `https://reactbits.dev/r/{Name}-TS-TW.json` | No | 200 | 166 motion components. The lively layer shadcn lacks. |
| Magic UI — `https://magicui.design/r/{name}.json` | No | 200 | Backup for scroll/text effects |
| Aceternity — `https://ui.aceternity.com/registry/{name}.json` | No | 200 | Same role, heavier aesthetic |
| Motion Primitives | No | 429 | Rate-limited at probe time, not paywalled |
| Cult UI | No | 429 | Same — throttling, not a gate |
| 21st.dev | **Yes** | auth | Only gated registry. **Nothing here depends on it.** |

**React Bits components that suit this project** (the rest of the catalogue is
glitch/particle/neon work that fights the field-guide look):

`ScrollReveal` · `ScrollFloat` · `ScrollStack` · `AnimatedContent` ·
`FadeContent` · `SplitText` · `GradualBlur` · `Magnet`

---

## Phase 1 — Foundation ✅ DONE

- [x] Restructure app under `app/front-end/`
- [x] `tokens.css` — five colours, derived rules via `color-mix`, type scale, motion durations
- [x] Styleguide page: palette, type specimens, territory, plate, anti-slop checklist
- [x] Paper grain via SVG `feTurbulence` + `mix-blend-mode: multiply`
- [x] Tailwind v4 + Vite plugin installed, `@/*` alias configured
- [x] Typecheck passes (`npx tsc -b`)

**Gate 1: passed.**

---

## Phase 2 — Registry bridge ✅ BUILT (gate 2 not yet reviewed)

The step that makes every later install look like Meowtro instead of like a
component demo. Do it **before** pulling anything.

- [x] `src/app.css` — `@import "tailwindcss"` + tokens, imported by `main.tsx`. Written **first**: `shadcn init` refuses to run while Tailwind is inert
- [x] `npx shadcn@latest init -y -b radix -p nova` → `components.json`, `src/lib/utils.ts`
- [x] Bridge in `app.css` — `--background` ← `--paper`, `--foreground` ← `--ink`, `--primary` ← `--rust`, `--muted-foreground` ← `--ink-soft`, `--card`/`--popover` ← the plate's paper mix, `--destructive` ← `--rust`
- [x] Every `--radius-*` step collapsed to `var(--radius)` = 2px (shadcn's scale multiplies to 2.6x, which clears the 4px ceiling)
- [x] All eight `--shadow-*` set to `0 0 #0000` (transparent, not `none`, so the composed `box-shadow` stays valid)
- [x] Chart and sidebar variables deleted rather than mapped — nothing here charts, and dead colour is how a palette drifts
- [x] `@custom-variant dark (&:is(.dark *))` kept deliberately: it is what stops a dark-mode OS from applying `dark:` styles to a page that is always cream
- [x] Geist uninstalled, `--font-sans` → `--font-display` (two families, spec §4)
- [x] Pulled `shadcn add button` (radix) and `FadeContent` from React Bits → styleguide section 06
- [x] `npm run build` clean; built CSS shows `--primary:var(--rust)`, `--radius:2px`, and no foreign colour (the only `oklch` left is a colour **space** in the button's hover mix)

**Gate 2:** a pulled component renders in cream/ink/rust with square corners and
no shadow — not grey, rounded and elevated. If it arrives looking generic, the
bridge is wrong and everything after it will be too.

> **CLI drift, 2026-08-16.** `shadcn init -d` no longer means "use defaults for
> this project" — it now means `--template=next` and would scaffold a new app
> over the top of this one. Do not use `-d` here. The prompts it replaces are
> `-b` (component library) and `-p` (preset).

---

## Phase 3 — Map & territories ✅ BUILT (gate 3 not yet reviewed)

Needs a Protomaps `.pmtiles` extract clipped to BGC (a few MB, generated once,
committed as a static asset). Nothing else in the plan is blocked on it.

- [x] ~~`npx shadcn@latest add https://mapcn.dev/r/map.json`~~ reversed — see decision log; `MapCanvas.tsx` is hand-written instead
- [x] Generate + commit `public/bgc.pmtiles` — 10.4 MB, z0–15, bbox `120.994,14.499,121.106,14.603`, cut from `build.protomaps.com/20260815.pmtiles` with the go-pmtiles CLI. First cut (2.6 MB, bbox `121.036,14.538,121.064,14.564`) was too narrow for real viewports at z14.6 — re-cut ~4x larger, same center
- [x] Author `map/style.ts` — ground `--paper`, buildings **outline only**, roads by kind, parks `--sage` at 0.16, water as ink wash. No `glyphs` and no `sprite`: see the labels note below
- [x] `map/MapLabels.tsx` — labels as **DOM, not symbol layers**. The Protomaps asset server only carries Noto Sans, which would be a third typeface (spec §4) and a network dependency for an otherwise offline basemap. Streets are picked by length from the tiles, so no coordinates are hand-guessed
- [x] `map/Territories.tsx` — three stacked layers, hatch drawn to a canvas at runtime rather than shipped as a PNG sprite
- [x] Selection via `feature-state`: two booleans, `selected` and `dimmed`, at 0.32 / 0.05 / 0.14 with a 700 ms transition
- [x] `data/catsRepo.ts` + `cats.seed.ts` + `territories.geo.json` — three cats, async from day one
- [x] App shell: full-viewport map, index rail, `plate/Plate.tsx`. Styleguide moved to its own entry at `/styleguide.html`
- [x] **Make the basemap actually render.** See RESUME HERE.

**Gate 3: passed** — reviewed against code, 2026-08-16 (see decision log).
`Territories.tsx` click handler and per-feature-state opacities confirmed
correct on read; the full-bleed render was already user-confirmed the prior
session. The map looks like an architectural drawing, territories overlap
legibly, clicking one selects it. No motion yet.

> Three cats is enough to prove overlap reads correctly. Twelve is a data-entry
> session and can happen any time after this gate.

---

## Phase 4 — Scroll-to-zoom

Originally specced as a per-cat scroll narrative (see spec §6/§8.3) — went
through three rounds of user-driven simplification in the same session and
landed somewhere much smaller. Full history in the decision log entries
dated 2026-08-16; this section describes the **final built shape only**.

- [x] Install `lenis` and `gsap` (gsap already present, arrived early with FadeContent)
- [x] Lenis instance in `motion/lenis.ts`, **RAF handed to the GSAP ticker** (see hazards). `autoRaf: false` + `gsap.ticker.add` + `gsap.ticker.lagSmoothing(0)`, disabled outright under reduced motion.
- [x] `map/ScrollZoom.tsx` — a plain, invisible spacer (`.scroll-zoom`, `height: 300vh`, `pointer-events: none`) giving the page scroll height. No per-cat structure, no text content.
- [x] `map/cameraTimeline.ts` — one `ScrollTrigger` over `.scroll-zoom`, `scrub: true`, interpolates `zoom` between `MIN_ZOOM`/`MAX_ZOOM` by hand and calls `map.jumpTo()` — **`jumpTo` not `flyTo`**, spec §8.3. No panning, no waypoints. Disabled under reduced motion.
- [x] Map pins full-viewport (true for free — `.map` is `position: fixed`, no ScrollTrigger pin needed)
- [x] Clicking a territory (or a rail entry) opens its plate — plain `setSelectedId`, no scroll interaction at all, in either direction.

**Reverted, 2026-08-16** — see "Scroll-to-zoom reverted: fought MapLibre
natively" in the decision log. The checklist above describes what was
built and then removed; `map/cameraTimeline.ts`/`map/ScrollZoom.tsx` are
unused, not deleted. `useCameraTimeline` is no longer called from
`MapCanvas.tsx` and `<ScrollZoom/>` is no longer rendered from `App.tsx`.

**Gate 4:** superseded. There is no scroll-driven camera to gate on
anymore — dragging and scroll-zoom are native MapLibre, gated by MapLibre
itself. Clicking a territory opens its plate — verified across earlier
iterations this session, unaffected by this revert.

---

## Phase 5 — Plate & 3D ✅ DONE

Self-contained. Buildable in parallel with phases 3–4; needs no real coordinates.

- [x] Install `motion`, `@react-three/fiber`, `@react-three/drei`
- [x] `AnimatePresence` panel — enter from `x: 24` ~320ms, exit ~200ms, rows stagger ~40ms. `mode="wait"` because every plate shares one fixed slot
- [x] R3F canvas mounts on plate open, **unmounts on close** (no idle GL context) — free, since `AnimatePresence` unmounts the whole plate
- [x] Orthographic camera, single key light, `MeshToonMaterial` + drei `<Outlines>`
- [x] Cat turns ~4°/s; drag to orbit, clamped so it never shows the underside
- [x] ~~Per-cat variation is material-level: tint + pattern texture swap~~ **tint only** — the GLB's atlas texture is unused entirely (see decision log)
- [x] Static illustration fallback when WebGL is unavailable — R3F's own `<Canvas fallback>`, no capability probe
- [x] ~~`frameloop="demand"` while idle~~ — `always` while a plate is open, `demand` under reduced motion. A cat turning at 4°/s is never idle; see decision log
- [x] `MotionConfig reducedMotion="user"` at the app root, rotation skipped under reduced motion
- [x] three.js lazy-imported so it loads on first plate open, not on first paint

**Gate 5: passed** — user-confirmed visually, 2026-08-16. The gate had to be
sat on until then: it is the one gate with no source-reading substitute, since
neither the model's framing nor the toon ramp exists anywhere in the code as a
value you can check.

---

## Phase 6 — Polish & proof

The phase that gets skipped and shouldn't.

- [ ] ~~One Lottie ink stamp on plate open~~ **built, then removed same
      day** — user feedback, "it looks dirty." See decision log.
- [x] Territory ink-in on load (spec §8.6, the no-library control) — was not
      built in phase 3 despite being listed done there; built now alongside 8.5
      since "check all six motion moments" needs all six to exist first
- [ ] Keyboard path past the pinned section — rescoped, see RESUME HERE:
      focusable rail → plate → 3D toggle button, no focus trap, since there is
      no pinned section anymore
- [ ] Every one of the six motion moments checked at reduced-motion and without
- [ ] **Teardown test:** mount/unmount → assert zero live ScrollTriggers, zero Lenis instances, zero WebGL contexts
- [ ] **Geometry test:** every territory is a closed valid polygon inside the BGC bounding box
- [ ] Anti-slop checklist (spec §4) passes on review
- [ ] Builds and deploys as static files

**Gate 6:** ships.

---

## Phase 7 — Rev 4: dark/light glass HUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the field-guide visual identity with a real light/dark
glass-HUD toggle, matching `docs/images-reference/dark-theme.jpg` and
`light-theme.jpg`, without changing the app's structure, data, or motion
libraries.

**Architecture:** Two palettes in `tokens.css` under a `data-theme`
attribute on `:root`; a real rounded/blurred/shadowed material replacing
the flat-paper rules in `app.css`/`shell.css`; a user-controlled toggle in
`MapControls.tsx` that flips the attribute and imperatively re-paints the
two things CSS can't reach on its own — the MapLibre base style
(`map/style.ts`) and the territory layers (`map/Territories.tsx`), via
`setPaintProperty`, not a style rebuild. A new native `circle` layer
(`circle-blur`) gives the selection glow, reusing the `feature-state`
mechanism `Territories.tsx` already has.

**Tech Stack:** No new dependencies. `maplibre-gl` (already installed) for
the glow layer and live re-theme; `lucide-react` (already installed) for
the toggle icon.

**Spec:** `docs/superpowers/specs/2026-08-16-meowtro-design.md` §0c
(why), §4 (tokens, type, anti-slop checklist), §6 (glow + live re-theme
mechanism) — rev 4.

## Global Constraints

- No sixth hex per theme: every colour in the app must trace to the five
  root tokens (`--paper`, `--ink`, `--ink-soft`, `--rust`, `--sage`), now
  doubled — one light value, one dark value each — per spec §4.
- Type stays two families: the system-ui stack for display/body, JetBrains
  Mono for coordinates/labels/route designations. No third face.
- No component hand-tunes its own radius/blur/shadow — everything reads
  the tokens added in Task 1.
- The theme toggle is user-controlled only, never bound to
  `prefers-color-scheme` (spec §4).
- **Verification approach.** This project has no test runner (`app/front-end/CLAUDE.md`:
  "No lint script and no test runner are configured... there is no `npm
  test`"). Every task below verifies with `npx tsc -b` (typecheck),
  `grep`-based structural checks where a check is objectively gradable
  (e.g. "no `Fraunces` string remains"), and an explicit visual-confirmation
  checkpoint at the gate-worthy tasks — the same pattern gates 1/3/5 already
  used in this project (visual review, since the agent building this cannot
  self-launch a browser; see the decision log). Steps that need your eyes
  say so explicitly and wait for your confirmation before the next task
  starts.

---

### Task 1: Two-palette tokens, material scale, drop the old identity's assets

**Files:**
- Modify: `app/front-end/src/tokens.css`
- Modify: `app/front-end/index.html`
- Modify: `app/front-end/src/App.tsx`

**Interfaces:**
- Produces: `--paper`, `--ink`, `--ink-soft`, `--rust`, `--sage` (now
  theme-switched via `:root[data-theme='dark']`), `--radius` (20px, was
  2px), `--blur-glass`, `--shadow-glass`, `--edge-highlight`,
  `--font-display` (now the system-ui stack). Every later task reads these
  by name.

- [x] **Step 1: Replace the root token block with light values and add a dark override block**

In `tokens.css`, replace the existing `:root { ... }` block's colour and
font-display lines with:

```css
:root {
  /* Ground and ink — light (default) */
  --paper: #f3f4f7;
  --ink: #191b20;
  --ink-soft: #6c7080;

  /* The one accent, and the only other colour — light */
  --rust: #e8622e;
  --sage: #5b9a4c;

  /* Derived — used for rules, wells, hover states.
     Always mixed from the five above, never a new hex. */
  --rule: color-mix(in srgb, var(--ink) 18%, transparent);
  --rule-strong: color-mix(in srgb, var(--ink) 42%, transparent);
  --well: color-mix(in srgb, var(--ink) 4%, transparent);
  --building: color-mix(in srgb, var(--paper) 70%, var(--ink-soft) 30%);

  /* Type — rev 4: native stack, no webfont. Fraunces is gone; the WONK/opsz
     axes it needed go with it. JetBrains Mono is unchanged. */
  --font-display: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Material — rev 4. One rounded scale (not per-component), one blur
     amount, one shadow recipe, one highlight edge. Shadow and highlight
     are intentionally NOT derived from --ink: --ink flips from near-black
     to near-white between themes, and a shadow needs to stay dark-toned
     and an edge highlight light-toned in both. */
  --radius: 20px;
  --blur-glass: 24px;
  --shadow-glass: 0 12px 40px rgba(0, 0, 0, 0.28);
  --edge-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.18);
  --surface-glass: color-mix(in srgb, var(--paper) 70%, transparent);

  /* Scale — 1.25 minor third off a 16px body */
  --t-xs: 0.7rem;
  --t-sm: 0.8rem;
  --t-base: 1rem;
  --t-lg: 1.25rem;
  --t-xl: 1.563rem;
  --t-2xl: 1.953rem;
  --t-3xl: 2.441rem;
  --t-4xl: 3.052rem;

  /* Space — 8px base */
  --s-1: 0.25rem;
  --s-2: 0.5rem;
  --s-3: 0.75rem;
  --s-4: 1rem;
  --s-6: 1.5rem;
  --s-8: 2rem;
  --s-12: 3rem;
  --s-16: 4rem;

  /* Motion — spec §8. Restraint is the style. */
  --dur-micro: 120ms;
  --dur-plate: 700ms;
  --dur-ink: 900ms;
  --ink-stagger: 60ms;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* Dark palette — rev 4. Same five names, different values; every derived
   token above recomputes automatically since color-mix() reads the live
   custom property. */
:root[data-theme='dark'] {
  --paper: #12141c;
  --ink: #f4f5f8;
  --ink-soft: #9296a6;
  --rust: #ff7a45;
  --sage: #6fbf5c;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-micro: 1ms;
    --dur-plate: 1ms;
    --dur-ink: 1ms;
    --ink-stagger: 0ms;
  }
}
```

Note: the old `--radius: 2px` comment ("Paper does not have rounded
corners") and the removed `font-variation-settings` line on `body` (below)
both went with the field-guide identity — don't carry them forward.

- [x] **Step 2: Drop the Fraunces variation-settings line from the body rule**

In `tokens.css`, find:

```css
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 14, 'SOFT' 0, 'WONK' 0;
  font-size: var(--t-base);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
```

Delete the `font-variation-settings` line — it's a Fraunces-only property
and does nothing on a system-ui stack (harmless if left, but dead and
confusing to a future reader).

- [x] **Step 3: Remove the Fraunces Google Fonts link**

In `index.html`, delete:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

Replace with the JetBrains-Mono-only equivalent (keep the two `preconnect`
lines above it untouched):

```html
<link
  href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

- [x] **Step 4: Stop rendering the paper grain**

In `App.tsx`, remove the `import { Grain } from '@/Grain'` line and the
`<Grain />` element (currently right after `<MapCanvas ... />`). Leave
`Grain.tsx` on disk — it's one self-contained file, not worth deleting
in the same task as a dozen other changes; flag it for removal in Task 8's
cleanup pass once nothing imports it.

- [x] **Step 5: Verify**

Run: `cd app/front-end && npx tsc -b`
Expected: passes clean (no references to a removed export).

Run (ripgrep or equivalent): confirm no remaining `Fraunces` or `WONK`
string anywhere under `src/` or `index.html`.
Expected: zero matches.

- [x] **Step 6: Commit**

```bash
git add app/front-end/src/tokens.css app/front-end/index.html app/front-end/src/App.tsx
git commit -m "rev 4: two-palette tokens, material scale, drop Fraunces + paper grain"
```

---

### Task 2: shadcn bridge — real radius/shadow

**Files:**
- Modify: `app/front-end/src/app.css`

**Interfaces:**
- Consumes: `--radius`, `--blur-glass`, `--shadow-glass`, `--surface-glass`
  from Task 1.
- Produces: shadcn's `--radius-*`/`--shadow-*` variables now resolve to
  real, non-zero values. `--card`/`--popover` resolve to `--surface-glass`.

- [x] **Step 1: Replace the collapsed-radius block**

In `app.css`'s `@theme inline` block, find:

```css
    /* Every radius collapses to the one value. shadcn's default scale
       multiplies up to 2.6x, which would clear the 4px ceiling in spec §4. */
    --radius-sm: var(--radius);
    --radius-md: var(--radius);
    --radius-lg: var(--radius);
    --radius-xl: var(--radius);
    --radius-2xl: var(--radius);
    --radius-3xl: var(--radius);
    --radius-4xl: var(--radius);
```

Replace the comment only (the mapping itself is still correct — rev 4 still
wants one radius everywhere, just a bigger number now that `--radius` is
20px, not 2px):

```css
    /* Every radius collapses to the one value, rev 4: a single rounded
       scale reads as "glass HUD" the same way a single square one read as
       "paper" in rev 1-3. */
    --radius-sm: var(--radius);
    --radius-md: var(--radius);
    --radius-lg: var(--radius);
    --radius-xl: var(--radius);
    --radius-2xl: var(--radius);
    --radius-3xl: var(--radius);
    --radius-4xl: var(--radius);
```

- [x] **Step 2: Replace the zeroed-shadow block**

Find:

```css
    /* Shadows off, spec §4: depth comes from linework and overlap. Transparent
       rather than `none` so the composed box-shadow stays valid CSS. */
    --shadow-2xs: 0 0 #0000;
    --shadow-xs: 0 0 #0000;
    --shadow-sm: 0 0 #0000;
    --shadow: 0 0 #0000;
    --shadow-md: 0 0 #0000;
    --shadow-lg: 0 0 #0000;
    --shadow-xl: 0 0 #0000;
    --shadow-2xl: 0 0 #0000;
```

Replace with:

```css
    /* Real shadows, rev 4: depth comes from the glass material, not
       linework. One recipe, every step aliases to it — no component picks
       its own shadow. */
    --shadow-2xs: var(--shadow-glass);
    --shadow-xs: var(--shadow-glass);
    --shadow-sm: var(--shadow-glass);
    --shadow: var(--shadow-glass);
    --shadow-md: var(--shadow-glass);
    --shadow-lg: var(--shadow-glass);
    --shadow-xl: var(--shadow-glass);
    --shadow-2xl: var(--shadow-glass);
```

- [x] **Step 3: Point card/popover at the glass surface token**

In the bridge's `:root` block, find:

```css
    /* Raised paper, same mix the specimen plate uses. */
    --card: color-mix(in srgb, var(--paper) 60%, #fff);
    --card-foreground: var(--ink);
    --popover: color-mix(in srgb, var(--paper) 60%, #fff);
    --popover-foreground: var(--ink);
```

Replace with:

```css
    /* Translucent glass, rev 4 — replaces the raised-paper mix. */
    --card: var(--surface-glass);
    --card-foreground: var(--ink);
    --popover: var(--surface-glass);
    --popover-foreground: var(--ink);
```

- [x] **Step 4: Verify**

Run: `cd app/front-end && npm run build`
Expected: builds clean. Inspect `dist/assets/*.css` (or the dev server's
computed styles) and confirm `--radius` resolves to `20px` and
`--shadow` resolves to the rgba shadow value, not `0 0 #0000` — mirrors
how gate 2 was originally verified (decision log: "built CSS shows
`--primary:var(--rust)`, `--radius:2px`, and no foreign colour").

- [x] **Step 5: Commit**

```bash
git add app/front-end/src/app.css
git commit -m "rev 4: real radius/shadow in the shadcn bridge, card/popover use glass surface"
```

---

### Task 3: Live map re-theme

**Files:**
- Modify: `app/front-end/src/map/style.ts`
- Modify: `app/front-end/src/map/MapCanvas.tsx`

**Interfaces:**
- Produces: `applyMapTheme(map: MapLibreMap): void`, exported from
  `style.ts`. Re-reads `--paper`/`--ink`/`--sage`/`--building` off `:root`
  and patches every base-style layer via `setPaintProperty`. Task 5 calls
  this from the toggle handler.
- Consumes: the existing local `token()` helper in `style.ts` (unexported,
  stays that way — `applyMapTheme` is defined in the same file and uses it
  directly).

- [x] **Step 1: Add `applyMapTheme` to `style.ts`**

First, update the file's existing import line —

```ts
import type { StyleSpecification } from 'maplibre-gl'
```

— to also bring in the `Map` type, aliased to avoid colliding with the
global `Map`:

```ts
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
```

Then add below `buildStyle()`:

```ts
/* Rev 4. buildStyle() only resolves colour once, at construction — flipping
   data-theme on :root doesn't repaint an already-built style by itself.
   setPaintProperty per layer instead of map.setStyle(): setStyle() replaces
   the whole style, including sources/layers Territories.tsx added
   imperatively afterward, and re-diffing that is exactly the kind of risk
   this function exists to avoid. */
const THEMED_LAYERS: Array<{ id: string; prop: string; tokenName: string }> = [
  { id: 'background', prop: 'background-color', tokenName: '--paper' },
  { id: 'earth', prop: 'fill-color', tokenName: '--paper' },
  { id: 'water', prop: 'fill-color', tokenName: '--ink' },
  { id: 'roads', prop: 'line-color', tokenName: '--ink' },
  { id: 'parks', prop: 'fill-color', tokenName: '--sage' },
  { id: 'canopy', prop: 'fill-extrusion-color', tokenName: '--sage' },
  { id: 'buildings', prop: 'fill-extrusion-color', tokenName: '--building' },
]

export function applyMapTheme(map: MapLibreMap) {
  for (const { id, prop, tokenName } of THEMED_LAYERS) {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, token(tokenName))
  }
}
```

(`token()` is the existing helper already defined earlier in this file —
no change to it.)

- [x] **Step 2: Add theme state and wire it in `MapCanvas.tsx`**

In `MapCanvas.tsx`, update the import line:

```ts
import { buildStyle, BGC_BOUNDS, BGC_CENTER, FLAT_PITCH, applyMapTheme } from './style'
```

Add, near the top of the `MapCanvas` function body (alongside the existing
`map`/`isLoaded` state):

```ts
const [theme, setTheme] = useState<'light' | 'dark'>('light')
```

Add a new effect, after the existing mount effect:

```ts
// Rev 4. The toggle (MapControls) flips document.documentElement's
// data-theme attribute directly, then calls setTheme — this effect is what
// turns that state flip into an actual map repaint.
useEffect(() => {
  if (!map || !isLoaded) return
  applyMapTheme(map)
}, [map, isLoaded, theme])
```

Pass `theme`/`setTheme` down to `MapControls` and `theme` down to
`Territories` (both edited in Tasks 4/5 to accept them):

```tsx
{map && (
  <>
    <Territories
      cats={cats}
      selectedId={selectedId}
      onSelect={onSelect}
      hoveredId={hoveredId}
      onHover={onHover}
      theme={theme}
    />
    <MapLabels />
    <MapControls theme={theme} onToggleTheme={setTheme} />
  </>
)}
```

- [x] **Step 3: Verify**

Run: `cd app/front-end && npx tsc -b`
Expected: fails at this point with "Property 'theme' does not exist on type
'IntrinsicAttributes & Props'" for both `Territories` and `MapControls` —
**expected**, since their Props types aren't updated until Tasks 4/5. This
confirms the wiring compiles against the right shape before those tasks
implement it.

- [x] **Step 4: Commit**

```bash
git add app/front-end/src/map/style.ts app/front-end/src/map/MapCanvas.tsx
git commit -m "rev 4: live map re-theme via setPaintProperty, theme state in MapCanvas"
```

---

### Task 4: Territory glow layer + re-theme

**Files:**
- Modify: `app/front-end/src/map/Territories.tsx`

**Interfaces:**
- Consumes: `theme: 'light' | 'dark'` prop, added to `Territories`' `Props`
  type (from Task 3's `MapCanvas.tsx` wiring). Used only as an effect
  dependency — the effect body re-reads tokens off `:root` directly, same
  pattern `style.ts` uses, so the prop's value is never read inside the
  effect body itself.
- Produces: a new `circle` layer, id `territory-glow`, sourced from
  per-cat territory centroids — selection-only, `circle-blur: 1`.

- [x] **Step 1: Add the centroid helper and glow layer to the mount effect**

First, update the file's existing import line —

```ts
import type { FeatureCollection } from 'geojson'
```

— to also bring in `Feature` and `Polygon`:

```ts
import type { Feature, FeatureCollection, Polygon } from 'geojson'
```

Then add, near the top of the file, alongside the existing
`SOURCE`/`FILL`/`LINE` constants:

```ts
const GLOW_SOURCE = 'territory-centroids'
const GLOW = 'territory-glow'

/* Rev 4. These polygons are already near-regular circles (see the file
   header: "circles, shaded rather than hatched") drawn by hand as many-
   vertex rings, so the mean of the ring's vertices IS the circle's centre,
   not an approximation the way it would be for an irregular concave
   shape. Recomputed once per cat at mount; territory shapes don't change
   at runtime. */
function centroidOf(feature: Feature<Polygon>): [number, number] {
  const ring = feature.geometry.coordinates[0]
  const [sumLng, sumLat] = ring.reduce(
    ([lng, lat], [pointLng, pointLat]) => [lng + pointLng, lat + pointLat],
    [0, 0]
  )
  return [sumLng / ring.length, sumLat / ring.length]
}
```

In the mount `useEffect` (the one that calls `map.addSource(SOURCE, ...)`),
add the centroid source and the glow layer **before** the existing
`map.addLayer({ id: FILL, ... })` call, so the glow paints underneath the
fill/line ink instead of over it:

```ts
const centroidData: FeatureCollection = {
  type: 'FeatureCollection',
  features: (territories as FeatureCollection).features.map((feature) => ({
    type: 'Feature',
    properties: feature.properties,
    geometry: { type: 'Point', coordinates: centroidOf(feature as Feature<Polygon>) },
  })),
}

map.addSource(GLOW_SOURCE, {
  type: 'geojson',
  data: centroidData,
  promoteId: 'id',
})

map.addLayer({
  id: GLOW,
  type: 'circle',
  source: GLOW_SOURCE,
  paint: {
    'circle-color': token('--rust'),
    // Selection-only, spec §6 rev 4 note: the glow is the "intensify on
    // select" half of the effect, not the always-visible half — that's
    // still FILL/LINE below, unchanged in spirit from before rev 4.
    'circle-radius': byState(48, 0, 0, 0, 0) as never,
    'circle-blur': 1,
    'circle-opacity': byState(0.55, 0, 0, 0, 0) as never,
    'circle-radius-transition': inkIn,
    'circle-opacity-transition': inkIn,
  },
})
```

Update the teardown `return` in the same effect to remove the new layer and
source too:

```ts
return () => {
  for (const timer of timers) clearTimeout(timer)
  for (const id of [LINE, FILL, GLOW]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  for (const source of [SOURCE, GLOW_SOURCE]) {
    if (map.getSource(source)) map.removeSource(source)
  }
}
```

- [x] **Step 2: Add `theme` to `Props` and a re-theme effect**

Update the `Props` type:

```ts
type Props = {
  cats: Cat[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
  theme: 'light' | 'dark'
}
```

Update the component signature to destructure it:

```ts
export function Territories({ cats, selectedId, onSelect, hoveredId, onHover, theme }: Props) {
```

Add a new effect after the existing feature-state effect:

```ts
// Rev 4. theme is only a trigger here — the paint values themselves come
// from re-reading :root, the same live-token pattern the mount effect
// above already uses. Rebuilds the same match expression the mount effect
// built, since fill-color/line-color are whole expressions, not single
// colour strings — setPaintProperty needs the complete replacement.
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
```

- [x] **Step 3: Verify**

Run: `cd app/front-end && npx tsc -b`
Expected: passes clean.

- [x] **Step 4: Commit**

```bash
git add app/front-end/src/map/Territories.tsx
git commit -m "rev 4: territory glow layer (native circle-blur) + live re-theme"
```

---

### Task 5: Theme toggle control

**Files:**
- Modify: `app/front-end/src/map/MapControls.tsx`

**Interfaces:**
- Consumes: `theme: 'light' | 'dark'`, `onToggleTheme: (theme: 'light' | 'dark') => void` props (from Task 3's `MapCanvas.tsx` wiring).
- Produces: on click, sets `data-theme` on `document.documentElement`
  (drives every CSS token from Task 1) and calls `onToggleTheme` (drives
  Task 3/4's map repaint via `MapCanvas`'s effect).

- [x] **Step 1: Add the props and the toggle button**

Replace the file's `Props`-less signature and add the theme button
alongside the existing 2D/3D one:

```tsx
import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useMap } from './MapCanvas'
import { DEFAULT_PITCH, FLAT_PITCH } from './style'

type Props = {
  theme: 'light' | 'dark'
  onToggleTheme: (theme: 'light' | 'dark') => void
}

export function MapControls({ theme, onToggleTheme }: Props) {
  const { map } = useMap()
  const [isFlat, setIsFlat] = useState(true)

  if (!map) return null

  return (
    <div className="map-controls">
      <button
        type="button"
        className="map-control"
        aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        onClick={() => {
          const next = theme === 'light' ? 'dark' : 'light'
          document.documentElement.dataset.theme = next
          onToggleTheme(next)
        }}
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
      <button
        type="button"
        className="map-control map-control-text"
        aria-label={isFlat ? 'Switch to 3D view' : 'Switch to flat view'}
        onClick={() => {
          const next = !isFlat
          setIsFlat(next)
          map.easeTo({ pitch: next ? FLAT_PITCH : DEFAULT_PITCH, duration: 500 })
        }}
      >
        {isFlat ? '3D' : '2D'}
      </button>
    </div>
  )
}
```

- [x] **Step 2: Verify types compile end-to-end**

Run: `cd app/front-end && npx tsc -b`
Expected: passes clean — this is what Task 3's Step 3 deliberately left
failing; it should resolve now that `Territories` (Task 4) and
`MapControls` (this task) both have real `theme` props.

- [x] **Step 3: Visual check — ask the user**

Run: `npm run dev`, open `http://localhost:5173`. This is a checkpoint:
**ask the user to confirm** the sun/moon button flips the whole app —
background, map ground/water/parks, territory outlines, the selected cat's
glow, and the DOM map labels (`MapLabels.tsx`, unmodified by this plan —
they read `var(--font-display)`/`var(--ink)`/`var(--ink-soft)`/`var(--sage)`
live, so they should already flip automatically; confirming this here is
what proves that, rather than assuming it) — with no console errors and no
visible flicker on the map. Don't proceed to Task 6 until confirmed; this
is the task that proves Tasks 1-5 actually work together, and everything
after this is chrome on top of it.

- [x] **Step 4: Commit**

```bash
git add app/front-end/src/map/MapControls.tsx
git commit -m "rev 4: theme toggle control, wires tokens + live map re-theme together"
```

---

### Task 6: Glass chrome for the rail, plate, and map controls

**Files:**
- Modify: `app/front-end/src/shell.css`

**Interfaces:**
- Consumes: `--radius`, `--blur-glass`, `--shadow-glass`, `--edge-highlight`,
  `--surface-glass` from Task 1.

- [x] **Step 1: Rewrite `.rail`'s surface**

Find:

```css
.rail {
  position: fixed;
  z-index: 3;
  top: var(--s-8);
  left: var(--s-8);
  width: 15rem;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--paper) 70%, #fff);
}
```

Replace with:

```css
.rail {
  position: fixed;
  z-index: 3;
  top: var(--s-8);
  left: var(--s-8);
  width: 15rem;
  border-radius: var(--radius);
  background: var(--surface-glass);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  box-shadow: var(--shadow-glass), var(--edge-highlight);
}
```

- [x] **Step 2: Drop the WONK/opsz heading styles**

In `.rail h1`, remove the `font-variation-settings` line:

```css
.rail h1 {
  margin: 0;
  padding: var(--s-3) var(--s-4);
  font-size: var(--t-xl);
  font-weight: 600;
  border-bottom: 1px solid var(--rule);
}
```

- [x] **Step 3: Rewrite `.plate`'s surface the same way**

Find:

```css
.plate {
  position: fixed;
  z-index: 3;
  top: var(--s-8);
  right: var(--s-8);
  width: 26.25rem;
  max-height: calc(100vh - 4rem);
  overflow: auto;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--paper) 60%, #fff);
}
```

Replace with:

```css
.plate {
  position: fixed;
  z-index: 3;
  top: var(--s-8);
  right: var(--s-8);
  width: 26.25rem;
  max-height: calc(100vh - 4rem);
  overflow: auto;
  border-radius: var(--radius);
  background: var(--surface-glass);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  box-shadow: var(--shadow-glass), var(--edge-highlight);
}
```

- [x] **Step 4: Drop the WONK/opsz cat-name style**

In `.plate-body h3`, remove the `font-variation-settings` line:

```css
.plate-body h3 {
  font-size: var(--t-2xl);
  font-weight: 600;
  margin: 0;
  line-height: 1.1;
}
```

- [x] **Step 5: Round the map-control buttons and give them the glass surface**

Find:

```css
.map-control {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--paper) 70%, #fff);
  color: var(--ink);
  cursor: pointer;
}
```

Replace with (fully round now that there are two stacked buttons — a pill
of two circles reads better than two 20px-radius squares):

```css
.map-control {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: var(--surface-glass);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  box-shadow: var(--shadow-glass), var(--edge-highlight);
  color: var(--ink);
  cursor: pointer;
}
```

- [x] **Step 6: Verify**

Run: `cd app/front-end && npx tsc -b` (CSS isn't typechecked, this just
confirms nothing else broke).

Visual check — **ask the user**: with the dev server running, confirm the
rail, plate, and both map-control buttons now read as translucent rounded
glass in both themes, matching the two reference JPGs' general material
(exact colours/blur amount still tunable — this is the gate for material,
not final pixel-matching).

- [x] **Step 7: Commit**

```bash
git add app/front-end/src/shell.css
git commit -m "rev 4: glass material for rail/plate/map-controls, drop WONK headings"
```

---

### Task 7: Styleguide parity

**Files:**
- Modify: `app/front-end/src/Styleguide.tsx`
- Modify: `app/front-end/src/styleguide.css`

**Interfaces:**
- None new — this task makes the styleguide describe what Tasks 1-6 built.
  No app code depends on this file (per `app/front-end/CLAUDE.md`, it's
  the review gate, not shipped in the app).

- [x] **Step 1: Remove Fraunces-specific type specimens**

In `Styleguide.tsx`, the specimen array currently sets `opsz`/`wonk` per
row and renders them via `fontVariationSettings` (see the file's existing
`{ label: '--t-4xl · opsz 144', ..., opsz: 144, wonk: 1, ... }` entries).
Since `--font-display` is now a system-ui stack with no variable axes,
replace the array with plain size/weight rows — drop the `opsz`/`wonk`
fields and the `fontVariationSettings` style entirely, keep `fontWeight`:

```ts
const specimens = [
  { label: '--t-4xl', size: 'var(--t-4xl)', text: 'Meowtro' },
  { label: '--t-3xl', size: 'var(--t-3xl)', text: 'Twelve residents' },
  { label: '--t-2xl', size: 'var(--t-2xl)', text: 'Milo' },
  { label: '--t-xl', size: 'var(--t-xl)', text: 'Track 30th' },
  { label: '--t-lg', size: 'var(--t-lg)', text: 'Section heading' },
  { label: '--t-base', size: 'var(--t-base)', text: 'Body copy at the base size.' },
]
```

Update the render loop to drop `fontVariationSettings`/the `opsz`-based
`fontWeight`/`lineHeight` branching, using a flat weight instead:

```tsx
style={{ fontSize: s.size, fontWeight: 600, lineHeight: 1.15 }}
```

- [x] **Step 2: Add a two-palette swatch section and a toggle demo**

Add a new section rendering both themes' five tokens side by side (read
directly off `getComputedStyle`, same technique the app already uses
elsewhere, so the swatches can never drift from the real values) and a
live toggle button that sets `document.documentElement.dataset.theme`,
mirroring `MapControls`'s handler:

```tsx
function ThemeToggleDemo() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  return (
    <button
      type="button"
      onClick={() => {
        const next = theme === 'light' ? 'dark' : 'light'
        document.documentElement.dataset.theme = next
        setTheme(next)
      }}
    >
      Toggle theme (currently {theme})
    </button>
  )
}
```

Render `<ThemeToggleDemo />` near the top of the styleguide page, and add a
glass-material demo section reusing `.rail`'s CSS class on a sample block
so the material can be checked without opening the real app.

- [x] **Step 3: Update the anti-slop checklist text on the page**

Find wherever the styleguide renders the rev 1-3 checklist items (`No
border-radius above 4px`, `No box-shadow used as depth`, `No gradient
except the paper grain`, etc. — check `Styleguide.tsx` for a hardcoded
list or `styleguide.css`'s corresponding section) and replace with the
rev 4 list from spec §4:

```
No Inter, Roboto, Space Grotesk, or Geist.
No default indigo-to-purple gradient.
No flat semi-opaque rectangle standing in for glass.
No copy-pasted radius/blur/shadow values per component.
No emoji, anywhere.
No centered hero with a headline and two buttons.
Every animation nameable and attributable to exactly one library (§8).
```

- [x] **Step 4: Verify**

Run: `cd app/front-end && npm run build` (builds both entry points,
`index.html` and `styleguide.html`).
Expected: clean build.

Visual check — **ask the user**: open `/styleguide.html`, confirm it shows
both palettes, the toggle works, and no Fraunces/WONK specimen remains.
This is the project's own established review gate (`app/front-end/CLAUDE.md`:
"the reviewable proof that a new token/component change actually reads as
Meowtro before it ships into the app") — don't skip it because the app
itself already looked right in Task 6.

- [x] **Step 5: Commit**

```bash
git add app/front-end/src/Styleguide.tsx app/front-end/src/styleguide.css
git commit -m "rev 4: styleguide shows both palettes, system-ui specimens, rev 4 checklist"
```

---

### Task 8: Cleanup and docs

**Files:**
- Modify: `app/front-end/CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-08-16-meowtro-build-plan.md` (this
  file)
- Delete (conditional): `app/front-end/src/Grain.tsx`

- [x] **Step 1: Confirm `Grain.tsx` is fully unused, then delete it**

Run: search `app/front-end/src` for `Grain` (import or JSX usage).
Expected: zero matches outside `Grain.tsx` itself, since Task 1 Step 4
already removed the only call site.

If confirmed unused: `git rm app/front-end/src/Grain.tsx`. If anything
still references it, stop and fix the reference instead of deleting.

- [x] **Step 2: Update `app/front-end/CLAUDE.md`**

Update the "What this is" paragraph (currently: "Cream paper, ink linework,
pencil hatching for turf — no glass cards, no neon, no gradients") — that
last clause is now backwards. Replace it with something like: "A dark/light
glass-HUD map of the community cats of Bonifacio Global City (Taguig, PH),
user-toggleable between themes. Cats are mapped by territory polygon, each
with a selection glow, not a pin." Update "The token bridge" section to
mention the two-palette `data-theme` mechanism and the live map re-theme
(`applyMapTheme` in `map/style.ts`, `Territories.tsx`'s theme-keyed effect)
in place of the rev 1-3 "we never set `.dark`" note, which rev 4 supersedes
— link to design spec §4 for the reasoning rather than re-explaining it in
two places.

- [x] **Step 3: Full verification pass**

Run: `cd app/front-end && npx tsc -b && npm run build`
Expected: both pass clean.

Manually re-check the spec's rev 4 definition-of-done items (§11): both
themes reviewed against their reference JPGs, toggle has no map flicker,
all three territories' glow-outline visible simultaneously with only the
selected one's full glow+ring lit.

**Contrast check, concretely** (this is the one accessibility-relevant
item in this phase, so it gets a real check, not a glance): in each theme,
open the browser devtools color picker (or any WCAG contrast checker) on
`--ink` against `--paper`, and `--ink-soft` against `--paper` — the two
pairs actually used for body/secondary text. Target AA for normal text
(4.5:1) on both. `--ink-soft` is the one most likely to fail — it's
deliberately muted — so if it's under 4.5:1 in either theme, darken (light
theme) or lighten (dark theme) that one token in `tokens.css` from Task 1
until it passes; nothing else in the system needs to change since every
consumer already reads the token, not a hardcoded value.

- [x] **Step 4: Optional Opus 5 second-look pass**

Per the model/effort discussion when this plan was scoped: dispatch a
single Opus 5 subagent, scoped only to `map/style.ts`'s `applyMapTheme`
and `map/Territories.tsx`'s glow layer + re-theme effect (Tasks 3-4) —
the two genuinely novel, non-mechanical pieces in this phase. Ask it to
check for the same class of bug the Phase 4 Opus review caught: stale
closures, effect-dependency gaps, and anything that only manifests under
StrictMode's double-mount. Not required to ship; recommended before
calling Phase 7 done, mirroring how gate-adjacent hard-integration work
was already re-checked once on this project.

- [x] **Step 5: Update this build plan's checkpoint**

Mark all Phase 7 tasks `[x]` above, update **RESUME HERE** to point past
Phase 7, and add a "Gate 7: passed" line once the user has confirmed the
Task 5 and Task 6/7 visual checkpoints.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "rev 4: cleanup, CLAUDE.md update, build plan checkpoint"
```

---

## Known hazards

Written down in advance. All four look like performance problems; none are.

1. **Two RAF loops.** Lenis and GSAP each want to own `requestAnimationFrame`.
   Running both produces scroll desync that reads as jank. Drive Lenis from the
   GSAP ticker and disable its own loop.

2. **`flyTo` inside a scrub.** `flyTo` runs its own easing on its own clock;
   scrubbing it means two animations fighting one camera. Interpolate the values
   yourself and `jumpTo`. Keep `flyTo` for the click path only.

3. **StrictMode double-mount.** Development mounts every effect twice. An
   un-killed ScrollTrigger becomes two timelines and a double-speed camera. Kill
   triggers in effect cleanup, always.

4. **Measuring before load.** A ScrollTrigger created before the map fires
   `load` measures against a map with no layers. Create it after, and
   `ScrollTrigger.refresh()` on resize or pin distances go wrong on rotate.

---

## Decision log

Decisions already made, with the reasoning, so they are not silently reopened.

| Decision | Outcome | Why |
|---|---|---|
| Visual direction | 1950s naturalist field guide — kept | Considered switching to the catsofph.com warm/photographic look and reverted. Heavy motion over a generic look reads as a template with plugins; over a committed print referent it reads as design. |
| Motion goal | Learn library integration, not CSS craft | Changed in spec rev 2. Six libraries, each owning one moment and teaching one distinct integration pattern. |
| Build vs. assemble | Assemble from registries | Explicit user goal. Only map style, territories and paper grain stay hand-authored. |
| 21st.dev key | Not needed | Every component wanted exists on an open registry. |
| mapcn | **Reversed, 2026-08-16.** Installed, then deleted | Its `<Map>` never got past requesting tiles under maplibre-gl 6, and it pins the worker to unpkg, which would put a CDN in front of a basemap whose whole point is one static offline file. `map/MapCanvas.tsx` replaces it in ~60 lines: a ref, an instance, a context. Phase 4 needs that raw instance for the GSAP camera anyway, so the wrapper was going to be in the way. |
| Browser verification | Edge headless via `--screenshot` | Needed because gate 3 is a visual gate. Works, with two traps: it writes the file **after** the process exits (sleep before reading), and a second Edge sharing the install can make it silently no-op (kill only processes whose command line contains `scratchpad`, never all of `msedge.exe`). puppeteer-core could not launch Edge at all. |
| shadcn component library | Radix, not Base UI | Base UI is the CLI's new recommendation, but mapcn and the older registries were authored against radix-based shadcn. Compatibility beats newness for a bridge everything else installs through. |
| Static layout mockup | Added 2026-08-16, **deleted 2026-08-16** once phase 5 landed, as planned | Reversed the "no third artifact" call below in one narrow case: the styleguide shows the parts, not the screen, and the first real composition was two phases away. `mockup.html` used the real tokens and the real `.plate` rules, so it could not drift from the system. The real plate now exists, so it went. |
| Google Stitch | Not used | Would add a third artifact (mockup + styleguide + app) to keep in sync. The styleguide page is already the reviewable visual, and it shares tokens with the real app so approved changes are already applied. |
| Next.js | Rejected | No backend, no SSR, no routing beyond a panel. |
| react-map-gl | Rejected | mapcn + direct `maplibre-gl` gives the imperative API phase 4 needs. |
| Twelve 3D models | Rejected | One CC0 model, tinted and pattern-swapped. No perceptible difference at plate scale. |
| pmtiles extract size, 2026-08-16 | Re-cut ~4x larger (2.6 MB → 10.4 MB) | The first cut (0.028° × 0.026°) was narrower than the app's own viewport at z14.6 — any window over ~990px wide ran past the data edge into flat background paint, which looked identical to a broken map. Not a rendering bug; the extract just needed to be bigger than any realistic viewport. `maxBounds` was reinstated once it was. |
| Gate 3 sign-off, 2026-08-16 | Passed on code review, not a screenshot | The agent building this session cannot self-launch a browser. Read `Territories.tsx`'s click handler and feature-state opacities directly instead of eyeballing a screenshot; user confirmed the full-bleed render visually the prior session. Gate 4 cannot be signed off this way — camera motion has no equivalent in source. |
| Phase 4 build order, 2026-08-16 | Three checkpoints, not one pass | User-approved: (1) Lenis+GSAP ticker alone, verify smooth scroll only, (2) `cameraTimeline.ts` against static chapter waypoints, verify camera motion, (3) click-to-seek + reduced-motion branch, verify gate 4 in full. Isolates the spec's four named hazards (init order, StrictMode double-mount, stale closures, resize refresh) instead of debugging all of them in one wired system. |
| Narrative overlay blocked map clicks, 2026-08-16 | Fixed: `pointer-events: none` on `.narrative`, `auto` back on `.chapter-card` | Each `.chapter` is a full-viewport, mostly-transparent flex box (only the small card in the corner has visible content), sitting at `z-index: 2` above the map. Without `pointer-events: none` it silently swallows every map click across its whole height, not just where the card is drawn — territory clicks stopped working the moment checkpoint 1 added the narrative column. Scroll was unaffected (native scroll doesn't hit-test through `pointer-events`), which is what made it visible as "clicking does nothing, but scrolling still moves the camera fine." Same pattern already used by `.map-labels`, just missed here originally. |
| Opus review of Phase 4, 2026-08-16 | Requested by user after noting the build was done on Sonnet 5 for "the hardest integration in the project" | Dispatched an Opus 5 subagent to re-check the four named hazards (spec §8.3), the waypoint/chapter math, and the click↔scroll sync — the exact things gate 4's unfinished visual check was meant to catch. Found and fixed three real issues: (1) **the segment math used `N` chapters where the actual layout only provides `N-1` scroll transitions between them** (the last chapter needs no extra scroll beyond arriving at it) — both `cameraTimeline.ts`'s `onUpdate` and `lenis.ts`'s `scrollToChapter` divided by the wrong count, so clicking Milo landed on Biscuit, clicking Biscuit landed on Tala, and only Tala (which clamps to max scroll) happened to land correctly — this is why it read as working when tested. Fixed by rebuilding both formulas on `N-1` segments and dropping the "overview" waypoint, which had no corresponding scroll room to begin with. (2) Reduced motion's `IntersectionObserver` was auto-opening the plate on page load, since an observer reports its initial state as its own first callback — now explicitly skipped. (3) `gsap.ticker.lagSmoothing(0)` was missing from the Lenis+GSAP wiring. The review separately confirmed hazards 1/2/4 (init order, StrictMode double-mount, resize refresh) were correctly handled as originally written, and hazard 3 (stale closures)'s full-rebuild-on-deps-change strategy was equivalent to a ref-based fix, not a gap. One deferred pacing note from the review: dropping the overview waypoint means the camera now starts framed on chapter 0's cat immediately rather than pulling back to a wide establishing shot first; restoring that would need an actual lead-in `.chapter` section (no content, just the overview), which is a real DOM/pacing change, not a bug fix — left for a future session if the establishing shot is missed. |
| Click-to-seek removed, 2026-08-16 | Spec §6's "a click seeks scroll position to that cat's chapter" — built, math-corrected per the Opus review above, then removed on user feedback ("it looks buggy and glitchy") | The mechanism was doing exactly what it was built to do post-fix, but the *experience* of a click triggering a ~1s animated scroll — during which selection visibly flickered through every intermediate chapter's cat before settling (a documented, accepted consequence at build time, spec'd as "the two input modes stay in sync") — read as broken rather than intentional once actually used. Rather than tune it further (e.g. suppressing the intermediate flicker), removed the coupling entirely per explicit user request: scroll now only drives the camera, clicking only opens the plate, and the two don't touch each other. Deleted: `motion/useScrollChapter.ts`, `lenis.ts`'s `scrollToChapter` and its module-scoped `instance` tracking, `App.tsx`'s `handleSelect` wrapper and the scroll→selection sync effect. `cameraTimeline.ts`'s camera-scrub math (the Opus-review fix) is untouched — only the `setScrollChapter` calls were removed from it. This is a deliberate deviation from spec §6; the spec's "two input modes stay in sync" goal is superseded by this decision. |
| Narrative text removed, 2026-08-16 | The per-chapter text card (name/description/range, shown bottom-left while scrolling) — removed | User mistook the scroll-triggered narrative card for the click-triggered plate opening ("why does scrolling down instantly click the territory") — both reused the same field labels ("PLATE 0X", description, range), so a scroll-revealed card and an actual selection looked identical at a glance, even though nothing was selected (no rail highlight, no right-side plate). Rather than restyle it to look distinct, removed it outright per user choice: cat info now only ever appears via the click path, which is the least ambiguous fix. `Narrative.tsx` keeps empty `<section data-chapter>` elements — still needed as scroll-height spacers for `cameraTimeline.ts`'s `ScrollTrigger`, and `.chapter`'s `data-chapter` attribute is still read by the reduced-motion `IntersectionObserver` branch — but renders no visible content. `.chapter-card`/`.chapter-number` CSS deleted from `shell.css` as dead code. |
| Scroll reduced to zoom-only, 2026-08-16 | The per-cat camera pan/chapter system — removed entirely, replaced with a plain scroll-to-zoom | Explicit user request: "when they scroll it zooms out/in the map only nothing else." This is the third and final round of simplifying phase 4's scroll behavior in one session (chapter panning → text removed → panning itself removed), each round removing more of the original spec §8.3 design rather than patching it further. `map/cameraTimeline.ts` rewritten from scratch: no waypoints, no `centroid()`, no chapter/segment math, no reduced-motion `IntersectionObserver` branch (nothing discrete left to jump between) — just one `ScrollTrigger` lerping `zoom` between two constants and calling `jumpTo`. `territories.geo.json`'s per-cat polygons are no longer read by the camera at all; they still exist for the territory *layers* (`Territories.tsx`, unrelated, untouched). `Narrative.tsx` replaced by `map/ScrollZoom.tsx` — moved out of a now-deleted `src/narrative/` into `src/map/` since it's purely a camera-scroll spacer now, not narrative content of any kind; `.narrative`/`.chapter` CSS renamed to `.scroll-zoom`. Lenis (smooth scroll feel) and the reduced-motion bail-out are both untouched — this round only changed what scroll *does* to the map, not how scrolling itself behaves. |
| Cat model source, 2026-08-16 | One GLB, committed as `public/cat.glb`. **Currently:** "Cat" by Poly by Google via Poly Pizza (`static.poly.pizza/5d32eb38-9546-4ce4-aa77-bcef9328ee61.glb`, `poly.pizza/m/6dM1J6f6pm9`), 43 kB, **CC-BY** — credited in the map's attribution control (`map/style.ts`), which is a licence condition, not a courtesy. Previously Quaternius' CC0 cat (233 kB), swapped on user preference | Considered hand-building the cat from R3F primitives (offline, no licence question) and dropping 3D for an inked SVG. A GLB is by far the least code for something that actually reads as a cat, and dropping 3D would delete spec §8.4's entire library lesson. Swapping models is a file replacement plus, for a non-CC0 licence, an attribution line: `CatFigure.tsx` reads whatever single mesh the file contains and normalises size and position through `<Bounds fit>` + `geometry.center()`, so there are no per-model constants to retune. **The one real constraint:** it takes the *first* mesh it finds. A model split into several meshes would render only part of itself — merge it or extend the traverse. |
| The model's own materials are discarded, 2026-08-16 | Only geometry is kept, baked through its node's `matrixWorld` and re-centred. Textures, rigs and animations are all dropped | A downloaded asset's baked colours are the single fastest way to make this look like an asset store rather than a field guide. Flat toon in the cat's own territory token (`--rust`/`--sage`/`--ink-soft`, read off `:root` the same way `map/style.ts` does) keeps the plate inside the five-colour palette. Dropping the rig also matters mechanically: drei `<Outlines>` *can* bind to a `SkinnedMesh`, but as a JSX child of a plain `<mesh>` it needs no portal, no skeleton re-binding and no mixer — the plate wants one still figure, not a walk cycle. (Relevant to the first model, which shipped rigged with 8 animations; the current one is a single static mesh.) Consequence: spec §7's "swappable pattern texture (tabby/tuxedo/calico)" is not built — pattern lives in the description text only, same as ear notches already do. |
| `frameloop="demand"` vs. a turning cat, 2026-08-16 | `always` while a plate is open, `demand` only under reduced motion | Spec §7 asks for both a cat turning at 4°/s and `frameloop="demand"` while idle; those contradict — a continuously rotating object is never idle, and `demand` would render one frame and stop. Resolved in favour of the rotation, which is safe here only because the canvas is unmounted on close: the continuous loop exists exactly as long as the plate is on screen. |
| three.js code-split, 2026-08-16 | `CatFigure` is a `React.lazy` import behind a `<Suspense>` in `Plate.tsx` | The first build put three + drei in the initial chunk: 1.43 MB before a user had clicked anything, on a page whose first screen is a map. Lazy import moves it to a 992 kB chunk fetched on first plate open. Three lines, and it makes "no idle WebGL context" true of the download as well as the runtime. |
| Ink stamp asset, 2026-08-16 | Hand-authored `public/ink-stamp.json` (raw Lottie/Bodymovin JSON, not a fetched `.lottie`) instead of a sourced designer asset | LottieFiles blocks non-browser fetches (403 via `WebFetch`) and this agent cannot self-launch a browser (see feedback memory). Rather than burn tokens on unreliable scraping for something ~20 lines of hand-written keyframe JSON solves directly, wrote a minimal scale+opacity "thump" (rust-coloured circle, 18 frames @30fps = 600ms). The integration lesson spec §8.5 cares about — React only calls `play()`/`autoplay`, never authors a keyframe at runtime — is unaffected: `InkMark.tsx` still just points `DotLottieReact` at a static file. Revisit if a real designer-authored asset shows up later; swapping is a file replacement, same as the cat model. |
| Ink stamp lazy-loaded, 2026-08-16 | `InkMark` is a `React.lazy` import in `Plate.tsx`, gated behind the same `reduced()` check that decides whether to render it at all | First build imported it eagerly; `npm run build` showed `dotlottie-react`'s ~500 kB WASM engine landing in a chunk the browser `modulepreload`s on first paint — same mistake phase 5 deliberately avoided for three.js. Fixed to match `CatFigure`'s existing pattern exactly. Gating the `<Suspense>` behind `reduced()` (rather than letting `InkMark` internally return `null`) means the fetch itself is skipped under reduced motion, not just the render — there's no "static ink stamp" to fall back to. |
| Territory ink-in adapted from spec, 2026-08-16 | Spec §8.6 says "SVG `stroke-dashoffset`"; built as a MapLibre feature-state reveal (`revealed` boolean, staggered `setFeatureState` calls) driving the existing `fill-opacity`/`line-opacity` paint transitions instead | Territories are MapLibre GL canvas layers (`Territories.tsx`), not SVG DOM — there is no `<path>` to apply `stroke-dashoffset` to, and duplicating the polygons as a synced SVG overlay just to get that one CSS property would mean maintaining two coordinate-projected copies of the same shapes (the exact cost `MapLabels.tsx`'s DOM-label approach already accepts for text, but not worth it here for a fill+line reveal that GL's native paint-transition system does natively). Kept the spirit — "no library," once, staggered ~60ms, ~900ms — on the rendering surface that actually exists. Also fixed while in there: the transition duration was hardcoded to `700` (labelled `--dur-plate` in a comment, but actually spec'd as `--dur-ink` 900ms for §8.6) and didn't respect `prefers-reduced-motion` at all; now reads `--dur-ink`/`--ink-stagger` live off `:root`, same pattern `style.ts` uses for colour, so reduced motion (which tokens.css already collapses both to ~0) applies with no extra branch. |
| Lottie ink stamp removed, 2026-08-16 | §8.5 built (`plate/InkMark.tsx`, `public/ink-stamp.json`, `@lottiefiles/dotlottie-react`), then deleted the same day on direct user feedback — "I dont like it remove it it looks dirty" | Not a bug, a taste call: the hand-authored stand-in stamp (see the two entries above, now moot) visibly read as rough rather than "designer-authored ink." Fully reverted rather than reworked — component, asset, CSS and dependency all removed, `Plate.tsx` back to its pre-§8.5 shape. Spec §8's "six libraries, six moments" curriculum is now five; §8's own "if you kept only one" note already flagged Lottie as "the library most likely to be over-applied" and non-essential to the other five, so this doesn't cascade into anything else. Revisit only if a real designer-authored asset shows up later — the integration point (`Plate.tsx`'s `.plate-head`) is still exactly where it'd go back. |
| 3D cat zoom-in-then-out on plate open, fixed 2026-08-16 | `<Bounds fit clip observe margin={1.5}>` in `CatFigure.tsx` given `maxDuration={0.01}` (drei's default is `1.0` second) | User-reported: the cat's entrance visibly zoomed in, then back out, on every plate open. Root cause: R3F's `<Canvas>` reports its container size in two passes right after mount (an initial measurement, then a ResizeObserver-corrected one) — `Bounds`'s `observe` prop re-runs `.fit()` on every size change, so two animated camera-zoom lerps started back to back, the second restarting from wherever the first had gotten to. Read straight from `@react-three/drei`'s `Bounds.js` source (`useLayoutEffect` deps include `size`; `fit()` always restarts `t.current` at 0), not guessed. Fix makes the fit apply in effectively one frame instead of animating, which removes the visible artifact without losing what `observe` is actually for (refitting on a real window resize while a plate is open). |
| CatFigure loading state, 2026-08-16 | Added `plate/CatLoading.tsx` (Lottie, plays while `CatFigure`'s three.js/GLTF chunk downloads) as a nested `Suspense` fallback in `Plate.tsx`, in front of the previously-blank placeholder | User-reported: opening a plate showed a visible "glitch" — the blank `.plate-figure` box popping straight to the fully-rendered 3D cat once the chunk arrived. `cat-loading.json` is a Lottie the user supplied directly (`Cat Crying emojiSticker animation.json`, moved into `public/`); asked to try it before reaching for anything hand-rolled. `CatLoading` is `React.lazy`-imported exactly like `CatFigure`, nested one `Suspense` deeper — the outer boundary's plain blank-box fallback only has to cover the instant before `CatLoading`'s own (much smaller, ~60 kB) chunk arrives, then `CatLoading` covers the rest of `CatFigure`'s download. Swap-out is Suspense unmounting the fallback the instant `CatFigure` resolves — no manual timer, more precise than "hide it after a few seconds." Kept animating under reduced motion, unlike §8.5's stamp: a loading indicator communicates state (operation in progress), it isn't decorative, so the usual "skip under reduced motion" call doesn't apply the same way. |
| dotlottie's WASM engine pointed at a local copy, 2026-08-16 | `setWasmUrl('/dotlottie-player.wasm')` called in `CatLoading.tsx`, copied from `node_modules/@lottiefiles/dotlottie-web/dist/` into `public/` | Checked `dotlottie-web`'s source before wiring it up (not assumed): unconfigured, it fetches its ~1.2 MB render engine from `unpkg.com` at runtime — the same CDN-in-front-of-a-static-asset problem that got mapcn rejected in phase 3. One line of config keeps it same-origin, consistent with `bgc.pmtiles`/`cat.glb` both being local files with no vendor in between. Only fetched when a plate first opens (same as the JSON), not on page load. |
| CatFigure fades in on mount, 2026-08-16 — **reverted same day** | `CatFigure.tsx`'s root became a `motion.div` (`opacity: 0 → 1`, 250ms) instead of a plain `div`. Didn't fix it to the user's eye ("it still shows aaaaaaa"); reverted back to the plain `div`, `motion` import removed | The loading-state fix above solved the blank-box glitch but surfaced the next layer of the same problem: the Suspense swap from `CatLoading` to `CatFigure` is still an instant cut, and the 3D render popping in at full detail read as its own small glitch. Offered two fixes — fade the new cat in, or crossfade the loading Lottie out over the already-rendered cat — user picked the simpler one, but it didn't read as fixed once seen. Rather than iterate further on animating the swap, backed off the whole loading-state feature instead (next entry) — sometimes removing the moving part beats smoothing it. |
| Plate loading indicator removed, 2026-08-16 — same day it was built | `CatLoading.tsx` deleted, the nested `Suspense` in `Plate.tsx` collapsed back to the single plain blank-box fallback from phase 5, `@lottiefiles/dotlottie-react` uninstalled again. `public/cat-loading.json` (the user's file) and `public/dotlottie-player.wasm` (the local engine copy) left on disk, unwired | The fade-in above was the last attempt at smoothing the loading→cat swap; user called it still glitchy and asked to strip the whole loading-state feature back out rather than keep iterating on it, while keeping the two asset files for a future attempt. The `Bounds maxDuration={0.01}` fix (a few entries up — the actual camera zoom-pump bug) was deliberately **not** touched here: it fixed a different, already-confirmed issue, and this round of feedback was specifically about the loading swap, not that. |
| Black flash on plate open, root cause found and fixed, 2026-08-16 | Moved `useGLTF(MODEL)` out of `Figure` (inside `<Canvas>`) to the top of `CatFigure`'s own function body (outside `<Canvas>`), passing the resolved `scene` down as a prop. Removed the now-pointless inner `<Suspense fallback={null}>` around `<Bounds>` | The actual bug behind the "quick glitch"/loading complaints all along — confirmed by reading `@react-three/fiber`'s source, not guessed. `<Canvas>` always wraps its own children in an internal `Suspense` whose fallback (`Block`) halts the render loop entirely — zero frames, not even lights-only — while anything inside suspends. `Figure` suspended on `useGLTF` on every genuinely-new load (`useGLTF.preload` at module scope is fire-and-forget per `suspend-react`'s source — it returns `void`, nothing to await, so it doesn't stop `Figure` suspending the instant it renders). An unpainted WebGL canvas reads as solid black, for the whole fetch+parse window. Every previous attempt at this (the loading Lottie, the fade-in, both reverted) operated one level too high — Plate.tsx's own Suspense/motion layer — and could never have touched an internal-to-Canvas suspend. Loading the GLTF before `<Canvas>` mounts means nothing inside it ever suspends, so its first frame is the real one. GLTFLoader parsing doesn't touch WebGL (pure geometry parsing), so nothing is lost moving it outside — textures are discarded anyway (see the model-materials decision above). |
| Pending-sighting ghost opened to all visitors, 2026-08-26 | `map/Territories.tsx`'s dashed "where this territory would move to" preview — previously gated on `admin` (spec §9: never show the public an exact reported point) — now renders for every visitor, admin or not | Explicit user request: visitors should be able to see a reported sighting's exact claim on the map themselves, not just take an admin's word for it, so they can judge whether it matches what they saw. Spec §9's safety concern is about *real* stray cats' exact locations reaching people who could harm them; v1's cats are all fictional, so there is no one to protect yet. The gate is fully removed (not narrowed to a blurred shape) — `admin` prop dropped from `Territories`' `Props` entirely. **Revisit before real cats or real reports are ever added** — that is the actual scenario spec §9 was written to guard against, and this decision reopens it. |
| Scroll-to-zoom reverted: fought MapLibre natively, 2026-08-16 | `useCameraTimeline`/`<ScrollZoom/>` removed from `MapCanvas.tsx`/`App.tsx`; files left on disk, unused | User reported dragging and scroll-down felt broken; root cause found by an Opus subagent reading `maplibre-gl`'s and `lenis`'s actual source (not assumption): `MapCanvas.tsx` never disabled MapLibre's native `dragPan`/`scrollZoom` (only `dragRotate: false` was set), so every wheel tick over the map fired **two** zoom writers on the same gesture — MapLibre's own `scroll_zoom.ts` (cursor-centered, calls `preventDefault()`, but never `stopPropagation()`) *and* Lenis (attached on `window`, `onVirtualScroll` never checks `event.defaultPrevented`) feeding `ScrollTrigger` → `cameraTimeline.ts`'s `map.jumpTo({zoom})`. MapLibre's scroll-zoom handler detects the external `jumpTo` change mid-gesture and folds it back into its own easing target (`scroll_zoom.ts:280-288`), so the two effects compounded rather than one overwriting the other: zoom ran ~2x too fast, jittered every frame, and the center drifted (native zoom pivots on the cursor, `jumpTo` doesn't touch center) — clamped only at `maxBounds`. Confirmed by the panel-hover control case: over `.rail`/`.plate` (z-index 3, outside the map), only Lenis fires and the zoom is smooth with no drift — the discrepancy was the tell. Drag-to-pan itself was never broken; it only looked broken because the fighting scroll-zoom was dragging the center out from under it independently. User chose, given the choice between (a) going fully native MapLibre for both gestures or (b) keeping the scroll-driven camera and setting `scrollZoom: false` to give Lenis sole ownership: **(a)** — matches "dragging and scrolling should use MapLibre, not another overlay" literally. This reverses the "Scroll reduced to zoom-only" decision directly above it; the map now has no scroll-driven camera of any kind, only native MapLibre `dragPan`/`scrollZoom`. `map/cameraTimeline.ts` and `map/ScrollZoom.tsx` are dead code, deliberately not deleted (see RESUME HERE) since spec §8.3 assigns GSAP ScrollTrigger to "map camera along scroll" as one of the six deliberate library lessons — deleting outright forecloses reviving it later. Lenis (`motion/lenis.ts`, spec §8.2) is likewise left wired via `useLenis()` in `App.tsx` but is now inert with no scrollable page content. `.scroll-zoom` in `shell.css` is dead CSS, also left as-is. `npx tsc -b` passes clean after the removal (no dangling imports). |
| Cat markers built lighter than the backlog note scoped, 2026-08-17 | New `map/CatMarkers.tsx` + `map/centroid.ts`. Flat mode: a hand-authored DOM pin via `maplibregl.Marker` + `createPortal`, animated with the already-installed `motion/react`. Pitched mode: a native MapLibre `circle` layer (`circle-pitch-alignment: 'map'`) at each territory's centroid. `MapContext` gained `isFlat`/`setIsFlat` (lifted out of `MapControls.tsx`'s local state) so both representations know which one to show | The original backlog note (below, pre-edit) scoped this as "a genuine rebuild: a synced render layer, per-cat coordinates, and 3D hit-testing for click-to-select," assuming a `CustomLayerInterface` + raw three.js approach. Brainstormed instead toward rev 4's *already-planned* centroid `circle`/glow layer (§6, "Rev 4 — glow treatment") rather than a parallel render stack — reference checked against the user-supplied `docs/images-reference/map-look-reference-2.png` (an interactive 3D real-estate map): its markers' foreshortened-ellipse look toward the horizon is the signature of a flat disc on the ground plane under a pitched camera, i.e. exactly `circle-pitch-alignment: 'map'`, not a three.js billboard. Checked React Bits (per project convention: assemble from registries) for an existing pin/marker component before hand-authoring one — none exists in its Animations/Components catalogs; closest is `ModelViewer`, the same R3F/drei stack `CatFigure.tsx` already hand-rolls for one big embedded viewer, wrong shape for N always-on map markers (would mean multiple simultaneous WebGL contexts, which this project has avoided elsewhere). Neither marker representation gets its own click/hover listener: a centroid sits inside its own territory polygon, so `Territories.tsx`'s existing FILL handlers already fire correctly when a marker is clicked (DOM pin occludes the canvas in flat mode; the circle sits over the same FILL geometry in pitched mode) — avoids the double-fire risk of two independent MapLibre layer-click listeners matching the same click. This also means "clicking a marker reveals that cat's territory" (the backlog note's other ask) falls out of rev 4's existing selected/dimmed feature-state model for free, no new reveal logic. Position is a computed polygon centroid (arithmetic mean of ring vertices — the territories are near-regular circles, so this is close enough without a geometry library), never a stored field: `Cat` still has no `location` (spec §9). Verified with `npx tsc -b` (clean) and a dev-server module-transform check; full visual review is pending — the agent building this session cannot self-launch a browser (see gate 3's decision above). |
| Territory circle hidden at rest, 2026-08-17 | `Territories.tsx` fill/line `resting` and `dimmed` opacity both set to `0` (was `0.26`/`0.35` resting, `0.06`/`0.15` dimmed); `selected`/`hovered` unchanged | User review of the cat-markers wireframe: the pin/dot must stay always-visible, but the territory circle around it must not — it should only draw in on hover or selection, nothing showing the rest of the time. Now that `CatMarkers.tsx`'s pin/dot already carries the "where are the cats" signal at rest, the territory shape's old job (reading as "cats live here" with nothing selected) is redundant; it's purely a hover/click payoff now. Scoped to `Territories.tsx` only — `CatMarkers.tsx`'s own dimmed state (`circle-radius`/`opacity` 4/`.35`) is untouched and deliberately stays nonzero, since the marker itself is the thing that must never fully disappear. Side effect, not chased further: the ink-in reveal's `hidden`→`revealed` flip (spec §8.6) is now a `0`→`0` transition for a resting cat, invisible until that cat is actually hovered — the mechanism is left in place rather than removed, since a future layer (rev 4's glow, spec §6) may want `resting`/`hidden` to diverge again. |

---

## Open items

- **The cat model is settled for now, deliberately** — user's call, 2026-08-16:
  keep the CC-BY Poly-by-Google cat and revisit later. It has no skeleton and
  no clips, so the plate's only motion is the 4°/s turntable and drag-to-orbit;
  that is the whole animation budget for the figure until the model changes.
  If it ever wants to breathe or idle, the two paths are (a) ~6 lines of
  procedural motion in `useFrame`, which works on any static mesh, or (b) swap
  to a rigged CC0 cat (Quaternius' has Idle + Idle_Eating) and add drei
  `useAnimations`, which also moves the ink outline onto drei's `SkinnedMesh`
  path — roughly 25 lines in `CatFigure.tsx`. Whichever, the attribution line
  in `map/style.ts` tracks whatever file is in `public/cat.glb`: it is a
  licence condition for the current CC-BY model and optional only if a CC0
  one replaces it.
- **Three cats or twelve** — three proves the overlap; twelve is data entry, any time after gate 3.
- **Rev 3 opt-in 3D map mode** — spec §0b/§6/§8. Mostly built: the flat/3D
  toggle button, building `fill-extrusion`, the `--building` token, the
  `forest`/`wood` canopy layer, and locking orientation to button-only
  (drag/touch/keyboard rotate all disabled) are all live in code
  (`map/style.ts`, `map/MapCanvas.tsx`, `map/MapControls.tsx`,
  `tokens.css`). **Not yet built:** the first-visit onboarding hint
  pointing at the toggle button.
- **v2 safety constraint** — recorded in spec §9 and binding on v1 architecture:
  never expose an exact point location for a real cat, polygons only, never
  publish a feeding schedule. v1 cats are fictional so nothing changes today,
  but v1 must not architect itself into a point-location API.
- **Night-mode variant, 2026-08-16 — superseded by design spec rev 4.** This
  item originally scoped a dark HUD as a variant *alongside* the cream
  field-guide design, swapped by time of day. The user has since supplied a
  second reference (`docs/images-reference/light-theme.jpg`, alongside the
  originally-referenced `dark-theme.jpg`) in the same HUD language rather
  than cream, and confirmed a full pivot: the field-guide identity is
  replaced outright, not kept as a "day" mode, and the toggle is
  user-controlled, not time-based. Full rationale and the visual-identity
  rewrite are in `docs/superpowers/specs/2026-08-16-meowtro-design.md` §0c
  and §4 (rev 4). The territory behavior this item called for — glow only
  on selection — was reconsidered during rev 4 planning and changed to
  "always-visible thin glow, intensifying on selection," to preserve the
  spec's overlap-at-a-glance payoff; see §6's rev 4 note. **Not yet
  implemented** — an implementation plan for this phase is next.
- **3D cat markers on the map, 2026-08-16 — done, 2026-08-17,** reviewed via
  a wireframe (the agent building this cannot self-launch a browser — see
  gate 3's decision above) rather than a live screenshot. Cat markers
  rendered as fixed points directly on the map instead of only inside the
  plate. Originally scoped (see the struck-through detail below) as a
  `CustomLayerInterface` + three.js rebuild; brainstormed down to a much
  smaller design instead — see the decision log's "Cat markers built
  lighter than the backlog note scoped" entry for the full reasoning.
  Built: `map/CatMarkers.tsx` + `map/centroid.ts`, a hand-authored DOM pin
  in flat mode (`maplibregl.Marker` + `createPortal`, animated with
  `motion/react`) and a native MapLibre `circle` layer in pitched mode
  (`circle-pitch-alignment: 'map'`, matching the ground-tilt look in
  `docs/images-reference/map-look-reference-2.png`). No new
  `CustomLayerInterface`, no 3D hit-testing — clicks/hover route through
  `Territories.tsx`'s existing FILL handlers, since a centroid always sits
  inside its own polygon. One adjustment made after the wireframe review:
  the territory circle around each pin/dot now stays hidden until hover or
  selection instead of always faintly shaded — see the decision log's
  "Territory circle hidden at rest" entry; the pin/dot itself is the thing
  that must never disappear, not the territory shape under it. `npx tsc -b`
  is clean.
  ~~Original scoping: confirmed feasible via MapLibre's official
  `CustomLayerInterface` + three.js pattern (`MercatorCoordinate` for
  georeferencing) — real work, not experimental, but a genuine rebuild: a
  synced render layer, per-cat coordinates, and 3D hit-testing for
  click-to-select.~~ Still true and worth keeping in mind: this reverses the
  README's "territory not a pin, because cats don't sit still" premise —
  the safety constraint in spec §9 (never an exact point for a real cat)
  still applies once real cats are involved, fictional v1 cats aside. The
  built version keeps that constraint (position is a computed centroid,
  never a stored field).
  **Deferred, 2026-08-17 — a "billboarded" pitched-mode pin.** Discussed
  instead of built: rather than the flat ground-plane dot, the pitched-mode
  marker could be the *same* teardrop pin, standing upright and always
  facing the camera (`icon-pitch-alignment: 'viewport'` on a MapLibre
  `symbol` layer, tinted per cat via `icon-color` on an SDF icon — the same
  runtime-tint trick `circle-color`/`fill-color` already use, so still one
  shared asset, still no three.js, still free click/hover). This is the
  Google/Apple-Maps-style pin behaviour, and a genuinely different choice
  from the ground-tilt look currently built (which was matched deliberately
  against `map-look-reference-2.png`) — worth deciding intentionally later,
  not a bug to fix. A plain `fill-extrusion` teardrop footprint (reusing
  the mechanism `style.ts` already uses for canopy/buildings) was
  considered and set aside: extrusion sweeps a footprint straight up, so it
  reads as a small tower/turret rather than a recognisable pin silhouette.
- **Clouds** (CLOSED 2026-08-24, do not reopen from here). Both plans were
  built. Plan A, MapLibre's native `sky`, shipped and stays: it is an
  atmosphere-scattering gradient tied to camera pitch, so it is invisible
  until the 3D toggle is on, and its ceiling is a slow haze breath with no
  shapes. Plan B, a drifting cloud deck on a canvas overlay, shipped as a
  WebGL fragment shader and was **deleted on 2026-08-24** for not looking
  good enough, after its one real bug (screen-space sampling, no camera
  input) had already been found and fixed. See the removal entry near the
  top of this file before considering a third attempt.
