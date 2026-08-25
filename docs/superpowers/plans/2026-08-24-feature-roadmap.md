# Feature roadmap — phases 7 onward

A tracking document, not a plan. Nothing here is scheduled or approved; it
exists so the options stay visible between sessions and so progress has
somewhere to be recorded. Tick a box when a thing ships.

For what is already built and why, read the build plan
(`2026-08-16-meowtro-build-plan.md`) first — it remains the checkpoint file.
This document only covers what comes *after* phase 6.

Written 2026-08-24, at the end of the session that added sighting photos,
the live sky, the Catdex menu, the favicon and the About panel.

---

## Where things stand

Phases 1–6 are built. Since the build plan was last updated, these also
landed:

- [x] Live weather seeded from the real sky over BGC (`map/liveWeather.ts`)
- [x] Sighting photos, seeded, shown as a draggable card stack in the plate
- [x] `Sighting.photo?: string` — URL-shaped end to end, ready for a server
- [x] `catsRepo.listSightings(catId)` — the per-cat query a backend will serve
- [x] The sighting flow opens with a menu: Catdex Scan / I saw a cat
- [x] Favicon (ear-tipped cat, theme-aware SVG)
- [x] About + credits panel, with a live survey readout
- [x] Open-Meteo attribution (CC-BY 4.0 — a licence condition, was missing)
- [x] Bundle split by change frequency; entry chunk 1032kB → 52kB

Absorbed from `2026-08-23-nice-to-have.md`: the sighting-photo loop and the
About surface are done. The rest of that file's items are carried into the
cross-cutting section below, and it can be treated as superseded once they
are.

---

## The seams that decide what is cheap

Worth reading before estimating anything in this document, because three
findings make several of these far smaller than they look.

**`vite.config.ts` already builds two entry points.** `index.html` and
`styleguide.html` are separate pages today. A landing page is a third entry,
not a router. `App.tsx`'s deliberate "no router — one page, one piece of
navigable state" decision survives a landing page completely intact.

**`ui/RecordCat.tsx` is finished and mounted nowhere.** Draw-a-circle
territory, colour picker, validation, local persistence, the honest footer
about local-only storage — all built. The admin *tool* exists. Only the
*gate* does not. Its own header comment says: "Mount this again behind the
role check and nothing else about it has to change."

**`data/catsRepo.ts` is genuinely the only seam.** Every read routes through
it and every read is already async, so consumers already handle loading.
`data/identify.ts` is shaped identically for the scanner. A backend is an
edit to those two files, not a refactor.

**What is missing for review is one field.** Every sighting already carries
who, what, where and when. `status` is the only thing standing between the
current data model and a moderation queue.

---

## Phase 7 — The front door

No backend. Nothing in this phase needs a server, and it is the phase that
turns the project from a folder into something with an address.

- [x] **Landing / hero page** — done 2026-08-25. `landing.html` is the
      third Vite entry, `landing/Landing.tsx` the page, `landing/Reel.tsx`
      the ambient demo. The ground is the live map, not a still: the reel
      steps the same `theme` / `isFlat` / `weather` state a person steps by
      hand, through the same context setters `MapControls` uses, so the
      front door cannot show a look the app does not have. `MapCanvas` grew
      two props for it, `chrome` and `children`. Sign in points at
      `/?role=admin`, which is phase 8's switch waiting for its handler.
      Fixed on the way: the camera now follows `isFlat` from an effect in
      `MapCanvas` instead of from `MapControls`' onClick, so setting the
      state anywhere tilts the map. The landing was flipping the flag and
      staying flat because it mounts no controls. The 3D button is now a
      one-line state flip.
      No pause button on the reel (user direction): reduced motion never
      starts it, and each tick is a button that jumps to a beat without
      stopping it. The earlier pause-while-held was removed, not fixed —
      it listened on the window, so every incidental click reset the 3s
      countdown. See the note in `landing/Reel.tsx` if this ever needs
      revisiting for WCAG 2.2.2.
- [x] **Front-door review, 2026-08-25.** Read the page back and fixed what
      it turned up. `index.html` IS the landing now and the app moved to
      `app.html`: the landing was reachable only by typing
      `/landing.html`, while its own Explore button pointed at `/`. Deep
      links are `/app.html?cat=milo`; `App.tsx` needed no change. Also:
      the reel seeds its starting beat from the theme the clock script
      left (it used to write `light` on mount and flip a midnight visitor
      to daytime); a `pageshow` handler clears the leaving curtain, which
      bfcache used to restore as a blank paper screen; the three nav links
      that all pointed at the same place are gone (the page is a mystery
      box on purpose, and shortcuts past the front door work against
      that); the sign-in slot is a `<span>` reading "Soon" until phase 8
      gives it something to do; Fraunces is no longer downloaded by pages
      that cannot use it; roster photos are requested at 104px instead of
      640x480; `head.html` is now one shared head for the two app pages so
      the day/night script cannot drift between them. `<noscript>`,
      `description` and Open Graph shipped with it.
- [x] **Page-level metadata** — done 2026-08-25. `description` and an Open
      Graph block on both pages. Open Graph only, no `twitter:*`: LinkedIn
      and GitHub are where this gets posted and both read `og:*`.
      **`og:url` and `og:image` are deliberately still missing** — both
      must be absolute, so both need the deploy URL. Add them in the same
      commit as the domain, and that is also when an OG image has to be
      drawn (1200×630).
- [ ] **Per-cat share cards** — `?cat=milo` links produce no per-cat social
      preview. Needs prerendered OG images at build time or a small edge
      function. Decide which before starting; they are different jobs. The
      site-level OG block above is the floor this builds on.
- [x] **`apple-touch-icon`** — done 2026-08-25. `public/apple-touch-icon.png`,
      180×180, the favicon's path over light `--paper` on an opaque tile.
      Rasterised by a throwaway node script (zlib only, no dependency and
      no browser) that was not kept: the PNG is the deliverable. Redraw it
      the same way if the mark changes.
- [x] **About / credits surface** — done 2026-08-24.

**Deploy is deliberately not in this phase.** Moved out 2026-08-25: it
happens once the app is finished enough to be worth an address, not as the
step that reveals what is unfinished. Two things are already known to be
waiting for it, and neither should be discovered by a visitor. The 10.4MB
`public/bgc.pmtiles` is fine on desktop and slow on Philippine mobile data,
and it wants measuring on a real handset before a host is chosen. The
pmtiles failure state (cross-cutting, below) is the app's last ungraceful
failure, and going public is exactly when a blank map stops being a private
problem.

---

## Phase 8 — Roles and review, still with no server

The most interesting phase to build, and the last large feature that needs
no backend. It proves the entire moderation experience in localStorage,
which is the same honesty the rest of the mock already practises.

The real design question in here is not the queue. It is: **what does an
unreviewed cat look like on a public map?** Answer that and the rest is
mechanical.

- [ ] **`?role=admin` switch** — same one-shot pattern `?cat=` already uses
      (`App.tsx`'s `useUrlSelection`). Unparks `RecordCat`. Roughly 20 lines,
      because the panel it reveals is already finished.
- [ ] **`status` on submissions** — `'pending' | 'surveyed'` on `Sighting`
      and on `StoredCat`. The single field that makes everything below
      possible. Add it to both type guards.
- [ ] **Review queue** — a dashboard of pending submissions with approve and
      discard. Approving is what `listTerritories` already does on apply
      today; the change is that it stops being automatic.
- [ ] **Pending renders differently on the map** — dashed territory, muted
      marker, and the plate saying so. This is the design question above.
- [ ] **Sightings stop applying instantly** — today a sighting moves a
      territory the moment it is made, and the panel says so out loud
      (`data/sightings.ts`). Under review, that becomes a proposal.
- [ ] **Audit trail** — who, what, where, when are all already stored. This
      is a display problem, not a data one.

---

## Phase 9 — The backend

- [ ] **Real API behind `catsRepo`** — the one file. Phase 8's mocked review
      becomes real moderation with no UI rewrite.
- [ ] **Sighting photo uploads** — `photo?: string` is already URL-shaped, so
      the field does not change; only where the URL comes from does.
- [ ] **Cross-device survey** — today every visitor has a private one.
- [ ] **Migrate localStorage** — `data/localCats.ts` and `data/sightings.ts`
      are the two stores that move. Decide whether existing local data is
      imported or abandoned.

---

## Phase 10 — Accounts, abuse, safety

- [ ] **Auth and roles** — the thing `?role=admin` is a stand-in for.
- [ ] **Rate limiting and abuse handling** — an open submission endpoint on
      a public map about real animals.
- [ ] **Enforce spec §9 server-side** — binding, and see the note below.
      Submissions may capture a precise coordinate; the public layer must
      only ever serve the blurred polygon derived from it.
- [ ] **Real cats replace the fiction** — the point at which every safety
      constraint stops being theoretical.

---

## Phase 11 — Real identification

- [ ] **Replace `identify.ts`'s mock match** — with a hosted model or a
      lazily-loaded detector. The frame gate is already real arithmetic;
      only the match is pretending, and the file says so.
- [ ] **Sighting photos as training data** — once uploads exist, they are
      already labelled by the cat they were filed under.

Honestly the hardest item in this document and the least essential. Cat
re-identification needs many labelled photos per individual and a trained
embedding. Worth doing only if the survey earns a real corpus first.

---

## Cross-cutting improvements

Independent of the phases. Any of these can be picked up at any time.

- [ ] **Twelve cats instead of three** — data entry, but it is the input to
      several design calls: whether the rail scrolls well, whether the
      labels collide, whether the sighting grid's search earns its place,
      and whether "show all ranges" is even a good idea.
- [ ] **Windy weather** — scoped 2026-08-24. Plumbing is ~15 minutes because
      every table is keyed by `Weather`. Needs a second Open-Meteo field
      (`wind_speed_10m`) and a priority rule against storm. The real cost is
      deciding what wind *looks* like, and that is design time, not typing.
- [ ] **`paper` on the theme toggle** — one word in `TOGGLE_THEMES`
      (`map/style.ts`). A whole third visual identity is built, tested by
      the styleguide, and currently unreachable.
- [ ] **pmtiles failure state** — MapLibre fires `error` and nothing
      listens. Everything else in the app degrades gracefully; a corrupt
      tile cache is a blank screen with no explanation. The last ungraceful
      failure in the app.
- [ ] **"Show every range at once" toggle** — decide *after* twelve cats,
      not before. It gets noisy past a handful.
- [ ] **First-visit hint at the 3D toggle** — the last unbuilt piece of
      rev 3.
- [ ] **Plate refetches sightings while open** — reporting a sighting from
      an open plate does not refresh its stack. Cannot matter yet, since
      visitor sightings carry no photo. Becomes real in phase 9.
- [ ] **Undo a sighting after the toast** — undo exists but expires with the
      nine-second confirmation. It is the one destructive visitor action
      with no recovery after that window.
- [ ] **The landing pays for `motion` and never animates with it.** 234kB
      of the front door's preload graph, because `MapCanvas` statically
      imports `CatMarkers` and `MapControls` and both import `motion/react`.
      The landing renders neither (no cats, `chrome={false}`), so a
      `React.lazy` pair inside `MapCanvas` would drop the chunk from this
      page entirely. Deliberately NOT done 2026-08-25: it moves the app's
      controls and markers behind a dynamic import too, so they would pop
      in a beat after the map on the page where they matter. Only worth it
      if the landing's load is measured on a real handset and this is
      actually what hurts. The pmtiles read is the far bigger number.
- [ ] **Delete the reverted Lottie leftovers** — `public/cat-loading.json`
      and `dotlottie-player.wasm`, ~2MB. Explicitly kept as of 2026-08-24.
      They cost users nothing at runtime, since nothing fetches them; this
      is repo and `dist` weight only.

---

## Binding constraints

Carried forward from spec §9 and not negotiable by anything in this
document.

- **Territory polygons only. Never an exact point for a real cat.** A
  submission may capture a precise coordinate; the public layer renders only
  the blurred polygon derived from it.
- **Never publish a feeding schedule.**
- **Do not add a `location` field to `Cat`.** Position is derived from the
  polygon's centroid at read time, never stored.
- v1's cats are fictional, so none of this changes anything today. It is
  recorded so the app never architects itself into a point-location API it
  would later have to tear out.

---

## How to use this file

Pick one item, say so, and it gets brainstormed properly before any code is
written. Items are deliberately not estimated in hours — the ones that look
big are often a single file because of the seams above, and the ones that
look small are often a design question wearing a small diff.
