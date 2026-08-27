# Phase 9 — The backend, design

Status: approved, not yet planned or built.

## What this replaces

Everything `data/catsRepo.ts` currently fakes over `localStorage`:
`data/cats.seed.ts` (frozen seed array), `data/localCats.ts` (recorded cats,
per-browser), `data/overlay.ts` (patches/hides on seed cats), and
`data/sightings.ts`'s storage primitives (the status machine and
predicates in that file stay — only their I/O changes). Also replaces the
`?role=admin` URL param with real sign-in, and turns "mine" (a pending
sighting you can withdraw) from "this browser" into "this account."

## Platform

**Firebase**: Firestore (data), Firebase Storage (photos), Firebase Auth
(Google sign-in only). Chosen over a hand-rolled Node server or Supabase
because it needs no server the project has to write or host — the static
front end talks to Firebase's client SDK directly, matching the project's
existing "assemble from registries, hand-author only the identity" ethos.
No server-side code for the core CRUD loop; **Firestore Security Rules**
(declarative, live in the Firebase project) are the real enforcement layer,
replacing the JS-only review boundary `catsRepo.ts` currently has (which a
browser could simply not call).

Deploy target for the static build is unchanged and unrelated to this
choice — Vercel, Netlify, or Firebase Hosting all work identically, since
Firebase's SDK runs client-side regardless of where the HTML/JS is served
from.

**Cost:** Stay on Firebase's free "Spark" plan. No Cloud Functions in this
phase (Spark has no billing account attached at all, so there is no path to
an unexpected charge — requests past the free daily quota are refused, not
billed). At this project's traffic scale (a niche field guide, single-digit
sightings/day) usage sits at low single-digit percentages of every free
quota. The one deferred feature that would require upgrading to the
pay-as-you-go "Blaze" plan is per-cat share cards (needs a Cloud Function to
serve per-cat OG tags to link-unfurlers) — explicitly out of scope here for
that reason.

## Data model

Three Firestore collections, replacing five files' worth of local
plumbing:

- **`cats`** — one document per cat, keyed by the existing slug id, fields
  matching the `Cat` type as it exists today. Collapses `cats.seed.ts` +
  `localCats.ts` + `overlay.ts` into one collection: with a real database
  there is no reason left to distinguish "frozen seed," "mutable local,"
  and "patch overlay on seed" as three separate mechanisms for the same
  concept. `nextLineNumber`'s scan-and-increment logic and `addCat`'s
  slug-collision loop (`catsRepo.ts:273-298`) port over unchanged, just
  reading `cats` instead of `[...CATS, ...readStored()]`.
- **`sightings`** — one document per report, fields matching `Sighting`
  today (catId, at, point, photo URL, status, votes), plus a new
  `authorUid` field now that every reporter is signed in. The status
  machine and predicates in `data/sightings.ts` (`isSurveyed`,
  `isOwnPending`, `sortForDisplay`, etc.) are unchanged logic — only the
  read/write primitives underneath them move from `localStorage` to
  Firestore queries.
- **`admins`** — one marker document per admin, keyed by their Google UID.
  Security rules check `exists(/databases/$(db)/documents/admins/$(uid))`
  to gate admin-only writes (approving/discarding sightings, editing or
  deleting cats). Admins are added by hand in the Firebase console — no
  invite UI, since this is a one- or two-person admin set.

**Never add a `location` field to `Cat`.** This constraint (CLAUDE.md,
spec §9) carries over unchanged into the Firestore schema — territories
stay polygons, the same safety reasoning applies regardless of storage
backend.

## Photo upload

`RecordCat`/`ReportSighting`'s existing photo picker uploads the file to
Firebase Storage via the client SDK (`uploadBytes`), gets back a download
URL, and writes that URL into the Firestore document — this is exactly
what `Sighting.photo?: string` was already shaped for (feature roadmap,
"URL-shaped end to end, ready for a server"). Add a client-side downscale
before upload (`<canvas>`, no new dependency) so a phone photo doesn't go
up at full resolution.

```
// ponytail: fixed max-dimension downscale via canvas, not a real image
// pipeline (no format negotiation, no multi-size variants). Upgrade to a
// resize Cloud Function / extension if storage cost or quality becomes a
// real problem.
```

## Auth

Landing's "Sign in" link becomes a real Firebase Auth Google sign-in popup,
replacing the `${APP}?role=admin` stub. `App.tsx`'s `useAdmin` becomes: is
a user signed in, and does an `admins/{uid}` doc exist for them (checked
once on auth-state change, held in context — same shape as today's
`useState` read-once, just backed by a real check instead of a URL
param). `?role=admin` is deleted, not kept as a fallback.

Because "who signs in" was decided as **everyone** (not admins-only),
reporting a sighting now requires a Google sign-in too. "Mine," for
withdraw/vote purposes, becomes "sightings where `authorUid` matches the
signed-in user" — this is what makes the cross-device survey backlog item
resolve itself as a side effect, rather than needing separate work.

Browsing (the map, territories, plates, cat descriptions) stays fully
public and unauthenticated — sign-in only gates writes (reporting,
voting, withdrawing, and everything already behind the admin corner).

## What does not change

The review workflow, the status machine in `data/sightings.ts`, the
territory-as-polygon safety constraint, the plate/rail/map UI — none of
this logic moves. Only where it reads and writes does.

## Explicitly out of scope for this phase

- **Per-cat share cards** (`?cat=milo` OG tags) — needs a Cloud Function,
  which needs the Blaze billing plan. Cheap follow-up once this phase's
  Firestore data exists; deliberately not bundled in to keep this phase
  on the free plan and keep its scope to "replace the storage layer."
- **Rate limiting / abuse handling** — Phase 10. Security rules can
  enforce document shape and role checks but not real rate limits; that
  needs App Check or Cloud Functions later.
- **Non-Google sign-in methods** (email/password, magic link) — Google
  only, per the approved design.

## Testing

Follows the project's existing pattern: no framework, a `*.check.ts`
compiled and run under `node` with asserts for non-trivial pure logic.
Firestore Security Rules get their own check via the
[Firebase Rules Unit Testing library](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
against the local emulator — the one piece of this phase that is a branch
worth a real test (admin-vs-non-admin write attempts, own-vs-other-user
withdraw attempts), since a rules bug fails silently as "the wrong person
could write" rather than a visible crash.
