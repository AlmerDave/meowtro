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

## Phase 8 — Roles and review, still with no server ✅ DONE 2026-08-25

Built in one session after a brainstorm that changed the shape of the phase
before any code was written. Recorded here rather than in a separate spec,
because this is where phase 8 already lived.

### The four decisions

**Review is safety-first, accuracy second.** Spec §9 is the hard rule: a
submission may capture a precise point and the public layer must never serve
it. That single choice killed the option this phase was originally built
around, a pending territory drawn dashed and muted for everybody, because a
dashed territory is still a published claim about where an animal was.

**Only admins propose cats, so only sightings need review.** `RecordCat`
stays behind the role gate, which makes an admin-recorded cat reviewed by
definition. `StoredCat` therefore needs no `status` at all and the original
question, "what does an unreviewed cat look like on a public map", stops
being a question. The phase got considerably smaller and sounder at the same
time.

**A pending sighting holds the map and shows in its own cat's plate**,
marked as awaiting review. The territory does not move. The contributor
still sees their observation, which is what makes the difference between
"recorded" and "applied" legible, and that difference is the whole concept
review introduces.

**A pending sighting can be withdrawn for as long as it is pending.** The
nine-second undo toast becomes the fast path rather than the only path,
which closes the "undo expires with the toast" gap that was sitting in the
cross-cutting list below.

### How it is enforced

`catsRepo` is where "published" is decided, because that is what a real
server does: a public endpoint never serves pending rows, so nothing
downstream can forget to filter and phase 9 replaces the bodies with fetches
without touching the guarantee.

The two predicates themselves live in `data/sightings.ts` (`isSurveyed`,
`isOwnPending`) because `map/Territories.tsx` applies the same policy
synchronously from inside a MapLibre effect and cannot await the repo. One
definition of published, two callers. `npm run check:review` covers both,
and the clause it guards hardest is that owning one pending sighting grants
no visibility of anybody else's.

**One deliberate exception:** `listSightings` returns surveyed rows plus
*this browser's own* pending ones. It is the only place unreviewed data
reaches a non-admin surface, and it is safe for a specific reason, that the
data came from that browser and tells its reader nothing they did not type
in. In phase 9 it becomes "pending rows belonging to the caller's token".

**Two consequences worth knowing**, both of which follow from safety-first
and neither of which was in the original task list. `lastSeen` is derived
from surveyed sightings only, or an unreviewed report would print "Last
seen: Today" on the public record. And `Territories`' "seen elsewhere" zones
draw sighting POINTS onto the map, so they take the same filter, which was
the real reason the three components bypassing the repo had to be routed
through it first.

### What shipped

- [x] **`?role=admin` switch** — `App.tsx`'s `useAdmin`. Read once and held
      for the session rather than consumed like `?cat=`, because here the URL
      is the credential and clearing it would sign an admin out on their own
      refresh. Honest about being a stand-in: phase 10 replaces the one
      function.
- [x] **`status` on `Sighting`** — `'pending' | 'surveyed' | 'discarded'`.
      Not on `StoredCat`, per the decision above. A missing status reads as
      `surveyed`, grandfathering rows written before review existed: they
      are already on that visitor's map and un-publishing them retroactively
      would rewrite what somebody has already seen.
- [x] **Review queue** — `ui/ReviewQueue.tsx`, behind the gate. Oldest
      first, unlike every other list in the app, because a queue is worked
      from the front. Approving is what moves the territory now.
- [x] **Sightings stop applying instantly** — and the panel's copy, which
      used to say out loud that yours was applied straight away because
      nobody reviewed sightings yet, now says the opposite.
- [x] **Withdraw** — from the cat's own plate, for as long as it is pending.
      Deletes rather than marking: nothing was published and no decision was
      made, so there is nothing to audit. An admin's discard does mark, for
      exactly the opposite reason.
- [x] **Audit trail** — under the queue rather than in a panel of its own,
      since what was decided is the context for what is waiting.
- [x] **The landing's sign-in slot opens onto something** for the first
      time. It shipped as a link in phase 7, spent one revision as an inert
      "Soon", and is a link again. The slot never moved.
- [x] **Admin surfaces moved to the top-left corner.** Mounting `RecordCat`
      exposed a collision that could not happen while it was unmounted: its
      trigger and the visitor's sighting trigger were both at
      `left: var(--s-6); bottom: var(--s-6)`. Rather than nudge one, the
      admin tools took their own corner, which also separates the two roles
      spatially.

**Not built, deliberately:** nothing renders differently on the map for
pending data, because under safety-first nothing pending renders on the map
at all. That item is not deferred, it is answered.

**Still to look at with actual eyes:** the queue panel and the admin corner
at `/app.html?role=admin`, and whether the record panel's re-anchor to the
top reads correctly at desktop width.

---

## Phase 9: the backend, done 2026-08-27

Full plan and design in `2026-08-27-phase9-backend-implementation.md` and
`../specs/2026-08-27-phase9-backend-design.md`. Not yet visually reviewed;
see the build plan's RESUME HERE block for the full remaining checklist
(Firebase project setup, security-rule emulator run, browser walkthrough,
one open product question on the vote buttons).

- [x] **Real API behind `catsRepo`** (the one file). Phase 8's mocked
      review becomes real moderation with no UI rewrite: Firestore
      reads/writes, Firebase Auth for identity, Cloud Storage for photos,
      all behind the same public surface.
- [x] **Sighting photo uploads.** `photo?: string` was already
      URL-shaped, so the field did not change; the URL now comes from
      Cloud Storage.
- [x] **Cross-device survey.** Firestore is the shared store now, not a
      per-visitor `localStorage` blob.
- [x] **Migrate localStorage.** `data/localCats.ts` and `data/overlay.ts`
      are deleted; `data/sightings.ts`'s local storage is gone too.
      Existing local data was abandoned, not imported (the survey was
      fictional seed data, not something worth carrying forward).

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

- [x] **Twelve cats instead of three** — done 2026-08-25. It was called data
      entry and it was mostly right, but four decisions came out of it.
      The palette went from three colours to eight (`--cat-*` in
      `tokens.css`, `CAT_COLOURS` in `cats.seed.ts`), because three is not
      something you hand somebody a picker for; every entry is a mix of the
      five base tokens, no new hex, and `npm run check:palette` asserts all
      eight clear AA as text in all three themes. The photo host moved to
      cataas.com, because placecats has six stable images and twelve named
      individuals cannot share six faces. The landing's roster caps at five
      chips with a count for the rest. And `--sage` turned out to have been
      under the AA floor as text since it was seeded (3.79 on paper, 3.09
      on light), which one cat in three wearing it made easy to miss;
      `--cat-sage` is mixed toward ink and passes, while the raw token is
      untouched because the map's parks are painted with it.
      **Still to look at with actual eyes:** whether twelve markers collide
      at this zoom, and whether the rail wants scrolling now.
- [ ] **Windy weather** — scoped 2026-08-24. Plumbing is ~15 minutes because
      every table is keyed by `Weather`. Needs a second Open-Meteo field
      (`wind_speed_10m`) and a priority rule against storm. The real cost is
      deciding what wind *looks* like, and that is design time, not typing.
- [ ] **`paper` on the theme toggle** — one word in `TOGGLE_THEMES`
      (`map/style.ts`). A whole third visual identity is built, tested by
      the styleguide, and currently unreachable.
- [x] **pmtiles failure state** — done 2026-08-25. `map/mapError.ts` holds
      the rule (nothing is fatal once the map has painted; before that,
      only the basemap source or a failure that names no source at all),
      `npm run check:maperror` covers both directions of it, and
      `MapCanvas` raises a card that explains it and offers a reload. The
      card is not a full-screen overlay and has no backdrop: the rail still
      lists cats and a plate still opens, since the only broken thing is the
      picture underneath. `App.tsx` stops holding the loading curtain the
      moment the failure is known, instead of running out its eight second
      ceiling with nothing left to wait for. Deliberately silent on the
      landing, where a wordmark and one button read fine over blank paper.
- [ ] **"Show every range at once" toggle** — decide *after* twelve cats,
      not before. It gets noisy past a handful.
- [ ] **First-visit hint at the 3D toggle** — the last unbuilt piece of
      rev 3.
- [ ] **Plate refetches sightings while open** — reporting a sighting from
      an open plate does not refresh its stack. Cannot matter yet, since
      visitor sightings carry no photo. Becomes real in phase 9.
- [x] **Undo a sighting after the toast** — done 2026-08-25, as a
      consequence of phase 8 rather than as its own piece of work. A pending
      sighting can be withdrawn from its cat's plate for as long as it is
      pending, and "pending" gives the window a natural end: approval.
- [ ] **Bounded rendering, the rest of it.** Scoped 2026-08-25 after the
      sighting picker was capped to the nearest twelve. The remaining
      per-cat renders, and what each one actually wants, so nobody caps the
      wrong one:
      - **Rail index** — do NOT cap. An index that hides entries is not an
        index, and it already has a search. What it wants is the
        `overflow-y: auto` its own `ponytail:` comment in `shell.css`
        predicted, plus portalling the specimen flight out of the panel so
        the scroll container does not clip it. Check whether twelve rows
        already overflow on a 768px-tall screen.
      - **Flat-mode cat markers** — the only per-frame cost in here. One DOM
        node per cat, repositioned by MapLibre on every frame of a pan. The
        fix when it hurts is viewport culling (render only centroids in
        view), which bounds by screen rather than by survey size. Capping
        would hide cats from the map, which is the one thing the map is
        for. The 3D path is already a single `circle` layer and scales to
        thousands, so this is flat mode only.
      - **Plate sighting stack** — bounded per cat today at two to four
        records. Becomes real in phase 9, when a popular cat could have
        hundreds; cap to the most recent handful then.
      - **Nothing here wants virtualisation.** A windowed list is a scroll
        container, a measurement pass and a dependency, to avoid drawing a
        few dozen buttons.
      Worth saying plainly: at these sizes the thing that makes the app feel
      slow is twelve photographs from a third-party host, not twelve DOM
      nodes. Those are already `loading="lazy"` in the rail and the picker,
      and `Loading.tsx` only ever waits for six.
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
