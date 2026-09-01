# Meowtro — territory visibility tiers via decoy placement

**Created:** 2026-09-01
**Branch:** `feature/territory-visibility-security`
**Supersedes nothing.** Extends the rev 5 design spec
([`2026-08-16-meowtro-design.md`](./2026-08-16-meowtro-design.md)) §9 (the
safety constraint) and the phase 9 backend spec
([`2026-08-27-phase9-backend-design.md`](./2026-08-27-phase9-backend-design.md))
(auth, `admins/{uid}`, `firestore.rules`). Every decision there still stands
unless named below.

---

## 0. Where this came from

The user wants territory exposure to depend on who is looking:

- A visitor who is **not signed in, or signed in but not yet approved**, must
  not be shown where a cat actually lives.
- A visitor who is **signed in and approved as a feeder** (or is an admin)
  sees the accurate territory, so they can actually be useful to the cat.
- A new **"Apply as a feeder"** action lets a signed-in visitor request that
  approval; an admin grants it from an in-app list.

Spec §9 already committed the project to "territory polygons only, never an
exact point for a real cat" for a future where cats and reports are real.
This feature is the first tier of that, built now against v1's fictional
cats as a craft exercise and as the seam the real thing drops into.

### What this is NOT

**Not a server-enforced boundary.** Decided explicitly with the user
(2026-09-01). The real polygon still ships to every browser inside
`cats/{id}` (`firestore.rules`: `allow read: if true`); only the *rendering*
is degraded for an unprivileged viewer. Someone who opens the network tab,
or hits the Firestore REST endpoint with no app at all, still reads the true
shape. A real boundary needs the data split described in §8 and is deferred
to when cats are real.

**Not a coarsened or blurred territory.** Considered and rejected by the
user. The polygon keeps its real shape and real size. What changes is its
**position**: the whole territory is moved to a stable fake point inside
BGC. "Same experience, fake location."

---

## 1. The two tiers

One derived boolean, computed in `App.tsx` and threaded down exactly like
`admin` and `uid` already are:

```
canSeePrecise = isAdmin || isFeeder
```

| Viewer | `canSeePrecise` | Sees |
| --- | --- | --- |
| Signed out | false | Decoy-placed territories |
| Signed in, not approved | false | Decoy-placed territories |
| Approved feeder | true | Accurate territories + sightings + pings + ghost |
| Admin | true | Everything, plus the admin surfaces |

There is deliberately **no middle tier**. A signed-in-but-unapproved account
is treated identically to a signed-out one for visibility. A throwaway
Google account is not a trust signal, and the threat model is people who
seek out this exact kind of data.

### New hook: `useFeeder()`

Alongside `useAdmin()` / `useUid()` in `App.tsx`. Subscribes auth, and on a
signed-in user reads `feeders/{uid}` once (`isFeeder`, `data/feeders.ts`).
Flips false→true after first paint the same way `useAdmin` already does, and
nothing downstream needs to care because `canSeePrecise` is recomputed on
render.

---

## 2. The decoy — `src/data/decoy.ts` (new)

A pure, deterministic function from a cat id to a fake placement.

```ts
/** A point inside BGC that is stable for this cat forever. Hash the id to a
    number, map that number uniformly into a safe inner rectangle of
    BGC_BOUNDS (inset so nothing lands in the river or off the pmtiles
    extract). No randomness, no per-session state: the same cat is placed at
    the same fake point on every load, every session, every device. */
export function decoyPoint(catId: string): [number, number]

/** The real polygon, moved so its centroid sits on decoyPoint(cat.id).
    Real shape, real size, fake position. Thin wrapper over translateToward
    (already exported and pure, from data/sightings.ts). */
export function decoyFeature(feature: Feature<Polygon>, catId: string): Feature<Polygon>
```

### Why deterministic, not random

A decoy that re-rolls per page load makes the territory visibly jump between
loads — reads as a bug — and buys nothing. A decoy seeded off the cat id is
stable, looks intentional, and still tells an attacker nothing: knowing one
cat's true location reveals nothing about any other cat's.

### The safe rectangle

`BGC_BOUNDS` (`map/style.ts`) is the pmtiles extract's own bounds and is
sized larger than any real viewport. The decoy rectangle is `BGC_BOUNDS`
inset by a fixed margin on all sides, so a decoy polygon (~140 m across)
placed anywhere in it stays fully on rendered ground. Decoys may overlap
each other and may sit on a building or road; they are fake and are not
meant to survive scrutiny, so this is accepted rather than solved with a
hand-picked decoy-zone list.

### Check — `src/data/decoy.check.ts` (new)

Follows the `check:weather` / `check:sightings` pattern (compile one
`*.check.ts` with `tsc`, run under node with asserts; add
`npm run check:decoy`). Asserts:

- every seeded cat's `decoyPoint` lands inside the safe rectangle;
- `decoyPoint` is stable across repeated calls;
- `decoyFeature` preserves vertex count and pairwise vertex distances (shape
  and size unchanged), and moves the centroid onto `decoyPoint` within
  rounding.

---

## 3. Read path — `src/data/catsRepo.ts`

Three functions gain a `canSeePrecise: boolean` parameter. Callers already
route everything through this file, so this is where the swap belongs.

### `listTerritories(publicSightings?, canSeePrecise)`

When `canSeePrecise` is **false**:

1. Skip the sighting translation entirely. The "elsewhere" shift that
   `translateToward(feature, sighting.point)` applies is dropped — applying
   it to a decoy would drag the decoy back toward the true reported point
   and re-leak the location. This is the "freeze the decoy" decision
   (2026-09-01): an unprivileged viewer's territories do not move.
2. Replace each feature with `decoyFeature(feature, id)`.

When **true**: unchanged from today.

### `listCats(publicSightings?, canSeePrecise)` / `getCat(id, canSeePrecise)`

When `canSeePrecise` is **false**, blank `cat.coordinates`. It is a real
`14.5501° N, 121.0459° E` string built from the true centroid
([`catsRepo.ts:156`](../../app/front-end/src/data/catsRepo.ts)), and left
intact it hands the real location back as text while the map shows a decoy.
`cat.range` ("About 280 m across, centred on the recorded point") stays: it
states size, not position.

`getCat` is built on `listCats`, so it inherits the behaviour once
`listCats` has it.

---

## 4. Render path

### `src/map/Territories.tsx`

New `canSeePrecise` prop. The fill / line / glow layers key off the
`territories` collection the component is handed, which `catsRepo` has
already decoy-placed, so those draw the decoy with no change. Two effects
must no-op when `canSeePrecise` is false:

- the **habitat-pings** effect (`ZONES` / `PING_A` / `PING_B`) — it plots
  the centroid *and* real sighting points as absolute coordinates;
- the **pending-ghost** effect (`GHOST_SOURCE`) — it plots
  `translateToward(feature, summary.oldest.point)`, an absolute real point.

Guard both at the top: `if (!canSeePrecise) return`. Add `canSeePrecise` to
their dependency arrays so a sign-in / approval that flips it mid-session
builds or tears the layers down correctly.

### `src/map/CatMarkers.tsx`

Reads its centroids from the same handed-in `territories` collection, which
is decoy-placed already. Expected: no change. Confirm during implementation
that it holds no independent fetch of true geometry.

### `src/plate/Plate.tsx`

When `canSeePrecise` is false:

- The **Range** block (`.plate-range`, the glyph + "point A → point B"
  sentence + the derived "inside/outside the known range" line) is replaced
  by a lock affordance: a lock glyph and "Location hidden. Sign in and get
  approved as a feeder to see the accurate territory."
- The **coordinates copy button** in `.plate-foot` is replaced by the same
  lock line (or hidden). `cat.coordinates` is already blanked upstream (§3),
  but the button's label falls back to it, so this needs its own branch.

Everything else on the plate (photo stack, "Last seen", description,
disposition) is unchanged. "Last seen" is a date, not a position.

---

## 5. The feeder gate

### `firestore.rules`

Two new blocks, in the style of the existing `admins/{uid}` block.

```
// Approved feeders. One marker doc per uid, written only by an admin
// (the in-app Feeder requests panel calls approveFeeder). No self-write:
// applying is a feederRequests doc, not this one.
match /feeders/{uid} {
  allow read: if isSignedIn();
  allow write: if isAdmin();
}

// A signed-in visitor's request to be approved. Theirs to create and to
// withdraw; an admin reads the queue and approves or declines. Never
// updated in place.
match /feederRequests/{uid} {
  allow read:   if isAdmin() || (isSignedIn() && request.auth.uid == uid);
  allow create: if isSignedIn() && request.auth.uid == uid
                && request.resource.data.keys().hasOnly(['name', 'email', 'reason', 'at'])
                && request.resource.data.reason is string
                && request.resource.data.reason.size() <= 500;
  allow delete: if isAdmin() || (isSignedIn() && request.auth.uid == uid);
  allow update: if false;
}
```

`feederRequests/{uid}` is keyed by uid (one open request per person), so a
re-apply after a decline is a fresh create at the same path.

### `src/data/feeders.ts` (new)

The single seam for feeder state, same role `data/auth.ts` plays for auth.

```ts
export function isFeeder(uid: string): Promise<boolean>
// feeders/{uid} exists

export type FeederStatus = 'none' | 'pending' | 'approved'
export function myFeederStatus(uid: string): Promise<FeederStatus>
// approved if feeders/{uid}; else pending if feederRequests/{uid}; else none

export function applyAsFeeder(user: User, reason: string): Promise<boolean>
// writes feederRequests/{uid} = { name, email, reason, at }

export type FeederRequest = { uid: string; name: string; email: string; reason: string; at: number }
export function listFeederRequests(): Promise<FeederRequest[]>   // admin; oldest first
export function approveFeeder(uid: string): Promise<boolean>     // write feeders/{uid}, delete request
export function declineFeeder(uid: string): Promise<boolean>     // delete request only
```

---

## 6. UI

### `src/ui/AccountMenu.tsx` — "Apply as a feeder"

A row in the account menu whose state comes from `myFeederStatus`:

| State | Row |
| --- | --- |
| Signed out | "Sign in to apply as a feeder" → runs the existing Google sign-in |
| `none` | "Apply as a feeder" → opens a small form: one textarea ("Why do you want accurate locations?"), Submit calls `applyAsFeeder` |
| `pending` | "Feeder application pending" (disabled) |
| `approved` / admin | row hidden |

The form is inline in the menu, not a new modal: one field and a button.

### `src/ui/FeederRequests.tsx` (new) — the admin list

Mounted behind the existing admin gate in `App.tsx`, next to
`ui/ReviewQueue.tsx`, and modelled on it. Renders `listFeederRequests()`;
each row shows name, email, the reason text, and **Approve** / **Decline**
buttons calling `approveFeeder` / `declineFeeder`. Empty state: "No feeder
applications waiting."

---

## 7. Sightings are feeder-gated too

Decided with the user (2026-09-01). A signed-in non-feeder sees a **decoy
map**, so any point they tap is a real-world coordinate placed against a
fake location — unusable data. Therefore:

- The floating **`ui/ReportSighting.tsx`** flow and the plate's **"I saw
  this one here"** button are shown only when `canSeePrecise` is true.
- Where the report entry point was, a non-feeder sees "Get approved as a
  feeder to report sightings."
- `firestore.rules` for `sightings` create is **left as it is** (any
  signed-in user). This is a UI gate, consistent with the rest of the
  feature being visual-only (§8). A server-enforced version would tighten
  the create rule to feeders; noted, deferred.

This makes the tiers coherent: to contribute location data you must be
trusted to see location data.

---

## 8. Honesty notes (carried into code comments)

**On the decoy path (`decoy.ts`, `catsRepo.ts`):**

> `ponytail:` this degrades the view, not the data. The real polygon still
> reaches every browser inside `cats/{id}`; a determined viewer reads it off
> the network tab or the Firestore REST endpoint. A real boundary needs the
> data split — a public fuzzed polygon in `cats/{id}` and the precise ring
> in a `cats/{id}/precise` doc that `firestore.rules` serves only to
> `feeders/{uid}` / `admins/{uid}` holders — and lands when cats are real.

**On the decoy itself (spec §9 extension):**

> A decoy placed at a plausible BGC point is a *confident false claim* about
> where an animal lives. That is acceptable for v1's fictional cats and is
> the point of the exercise. Before real cats or real reports land, revisit
> whether an honest "location hidden" beats a convincing fake — a fake that
> sends someone to a real address is its own harm.

---

## 9. Files

New:

- `src/data/decoy.ts`
- `src/data/decoy.check.ts` (+ `check:decoy` script in `package.json`)
- `src/data/feeders.ts`
- `src/ui/FeederRequests.tsx`

Changed:

- `src/data/catsRepo.ts` — `canSeePrecise` param on `listCats` / `getCat` /
  `listTerritories`
- `src/App.tsx` — `useFeeder()`, `canSeePrecise`, thread into repo calls and
  props, mount `<FeederRequests>` behind the admin gate
- `src/map/Territories.tsx` — `canSeePrecise` prop, guard pings + ghost
- `src/map/CatMarkers.tsx` — confirm no independent geometry fetch (likely
  no change)
- `src/plate/Plate.tsx` — lock affordance for Range + coordinates when
  `!canSeePrecise`
- `src/ui/AccountMenu.tsx` — "Apply as a feeder" row + inline form
- `src/ui/ReportSighting.tsx` — gate behind `canSeePrecise` (or gate its
  mount in `App.tsx`)
- `firestore.rules` — `feeders/{uid}`, `feederRequests/{uid}`
- `docs/superpowers/plans/2026-08-24-feature-roadmap.md` — record the tier

---

## 10. Out of scope

- Server-enforced geometry (data split or Cloud Functions) — §8.
- A middle visibility tier — §1.
- Tightening the `sightings` create rule to feeders — §7.
- Rate limiting on feeder applications — same deferral as phase 10 item 2
  (waits on real cats).
- Any change to how `admins/{uid}` is provisioned.
