# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Meowtro** — a hand-inked field guide to the community cats of Bonifacio
Global City, Taguig. Named cats are mapped by the **territory polygon they
roam**, never by a pin claiming an exact location. Click a territory and a
specimen plate opens with the cat as a slowly-turning 3D figure in a
pencil-and-ink toon shader.

There is no backend. All data is seeded or in `localStorage`; `catsRepo.ts`
is the single async seam a real API drops into later. The project is also a
deliberate craft/learning vehicle: assemble behaviour from component
registries (shadcn, React Bits) and animation libraries, hand-author only
the four things that *are* the identity (map style, territory layers, cat
markers, paper grain).

## Layout

```
app/front-end/     the entire application (Vite + React 19 + TS)
  CLAUDE.md        <- the detailed guide. Read it before touching src/.
docs/superpowers/
  plans/2026-08-16-meowtro-build-plan.md   the checkpoint file: what is done,
                                           what is next, and the decision log
  plans/2026-08-24-feature-roadmap.md      phases 7-11, unscheduled options
  specs/2026-08-16-meowtro-design.md       art direction, architecture, §8
                                           library-to-motion map, §9 safety
  specs/2026-08-18-map-material-and-sheet-design.md
  images-reference/                        theme + map look references
```

There is no root package.json. Everything runs from `app/front-end/`.

## Commands

```bash
cd app/front-end
npm run dev            # vite, :5173
                       #   /                 the landing (index.html)
                       #   /app.html         the map
                       #   /styleguide.html  design system
npx tsc -b             # typecheck — this is the verification step
npm run build          # tsc -b && vite build (three entry points)
npm run check:weather  # standalone node check for map/liveWeather.ts
npm run check:sightings
```

No lint script, no test runner, no `npm test`. Verification is `npx tsc -b`
plus visual review at a gate. The two `check:*` scripts are the pattern for
non-trivial pure logic: compile one `*.check.ts` with `tsc` and run it under
node with asserts.

## Working rules

- **Read `app/front-end/CLAUDE.md` first** for anything under `src/`. It
  carries the token-bridge rules, the map re-theme path, and the traps that
  have already bitten this project once each.
- **Read the build plan's `RESUME HERE` block** before starting a phase, and
  update it when one completes. It is the only file that records state
  across sessions.
- **Never add a `location` field to `Cat`.** Position is derived from the
  polygon centroid at read time. Binding safety constraint (spec §9), even
  though v1's cats are fictional. Same source: never publish a feeding
  schedule.
- **Do not self-launch a browser.** Visual gates are closed by a screenshot
  from the user, not by an agent driving Chromium.
- Comments in this codebase explain *why*, often at length, and several
  record decisions not to re-litigate. Match that density; do not strip them.
