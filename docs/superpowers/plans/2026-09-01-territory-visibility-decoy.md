# Territory Visibility Tiers (Decoy Placement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show unprivileged viewers territories relocated to a stable fake BGC point (real shape/size, fake position), while approved feeders and admins see accurate territories, sightings, pings and the pending ghost.

**Architecture:** One derived boolean `canSeePrecise = isAdmin || isFeeder` computed in `App.tsx` and threaded down like `admin`/`uid` already are. The swap happens in `data/catsRepo.ts` (the single read seam): when `canSeePrecise` is false it relocates each territory via a new pure `data/decoy.ts` and drops sighting translation. Render components gate the effects that plot absolute real points. A `feeders/{uid}` marker doc mirrors `admins/{uid}`; a `feederRequests/{uid}` collection plus an in-app admin list handle self-application. Visual-only by decision: the real polygon still ships to every browser.

**Tech Stack:** Vite + React 19 + TS, MapLibre 6, Firebase (Auth + Firestore), `firestore.rules`. No test runner: verification is `npx tsc -b` plus `*.check.ts` compiled and run under node (the `check:*` pattern in `package.json`).

**Spec:** `docs/superpowers/specs/2026-09-01-territory-visibility-decoy-design.md`

## Global Constraints

- **Run all commands from `app/front-end/`.** There is no root `package.json`.
- **Verification is `npx tsc -b`** (from `app/front-end/`) plus the relevant `check:*` script. No `npm test`. Do not self-launch a browser; visual review is the user's.
- **Never add a `location` field to `Cat`.** Position stays derived from polygon geometry (spec §9, CLAUDE.md).
- **No em dashes** in any output including code comments and commit messages. Use a comma, colon, parentheses, or a separate sentence.
- **Comments explain _why_, at the density of the surrounding file.** This codebase records decisions in comments; match that.
- **`tokens.css` is the only file with hex/magic sizes.** New CSS uses existing tokens (`--rust`, `--ink-soft`, `--radius`, the space scale, etc.).
- **Decoy is deterministic**, seeded off `cat.id`, computed once, identical every load/session/device. Never random per session.
- **Visual-only.** Every decoy code path carries a `ponytail:` comment: this degrades the view, not the data; a real boundary needs the data split, deferred to real cats.

---

### Task 1: `data/decoy.ts` and its check

**Files:**
- Create: `app/front-end/src/data/decoy.ts`
- Create: `app/front-end/src/data/decoy.check.ts`
- Modify: `app/front-end/package.json` (add `check:decoy` script)

**Interfaces:**
- Consumes: `translateToward` from `data/sightings.ts` (exported, pure: `(feature: Feature<Polygon>, to: [number, number]) => Feature<Polygon>`). `BGC_BOUNDS` from `map/style.ts` (`[[number, number], [number, number]]`, `[[west, south], [east, north]]` order: confirm by reading `style.ts:58-65`).
- Produces:
  - `decoyPoint(catId: string): [number, number]`
  - `decoyFeature(feature: Feature<Polygon>, catId: string): Feature<Polygon>`

- [ ] **Step 1: Read `map/style.ts:55-70`** to confirm the exact shape and lng/lat ordering of `BGC_BOUNDS`, and `map/centroid.ts` for `ringCentroid`.

- [ ] **Step 2: Write `data/decoy.ts`**

```ts
import type { Feature, Polygon } from 'geojson'
import { BGC_BOUNDS } from '@/map/style'
import { translateToward } from './sightings'

/* Decoy placement: an unprivileged viewer sees a cat's real territory
   outline moved to a fake point inside BGC. Real shape, real size, fake
   position. "Same experience, fake location" (spec
   2026-09-01-territory-visibility-decoy-design.md).

   ponytail: this degrades the VIEW, not the DATA. The real polygon still
   ships to every browser inside cats/{id} (firestore.rules: read if true),
   so a determined viewer reads it off the network tab. A real boundary
   needs the data split (public fuzzed doc + gated precise doc) and lands
   when cats are real. Recorded, deferred, on purpose. */

/* Inset from BGC_BOUNDS on every side so a ~140m decoy polygon dropped
   anywhere in the rectangle stays fully on rendered ground rather than in
   the river or off the pmtiles extract. Degrees: ~0.004 is ~440m at this
   latitude, comfortably more than any territory's half-width. */
const INSET_DEG = 0.004

/* A stable 32-bit hash of the id. Deterministic and dependency-free: the
   decoy must be identical on every load, every device, so a cat never
   appears to "jump" between page loads and averaging many loads reveals
   nothing. */
function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A point inside the safe inner rectangle of BGC, stable forever for this
    cat. Two independent hash streams (the id, and the id reversed) give
    lng and lat their own spread so ids that are close as strings do not
    land in a diagonal line. */
export function decoyPoint(catId: string): [number, number] {
  const [[west, south], [east, north]] = BGC_BOUNDS
  const w = west + INSET_DEG
  const e = east - INSET_DEG
  const s = south + INSET_DEG
  const n = north - INSET_DEG
  const fx = hash(catId) / 0xffffffff
  const fy = hash([...catId].reverse().join('')) / 0xffffffff
  return [w + fx * (e - w), s + fy * (n - s)]
}

/** The feature's real polygon, moved so its centroid lands on
    decoyPoint(catId). Delegates to translateToward, which is a flat
    per-vertex offset (correct at this scale, see its own note), so vertex
    count and every pairwise vertex distance are preserved: shape and size
    are unchanged, only position moves. */
export function decoyFeature(feature: Feature<Polygon>, catId: string): Feature<Polygon> {
  return translateToward(feature, decoyPoint(catId))
}
```

- [ ] **Step 3: Write `data/decoy.check.ts`**

```ts
import assert from 'node:assert/strict'
import type { Feature, Polygon } from 'geojson'
import { decoyPoint, decoyFeature } from './decoy'
import { BGC_BOUNDS } from '../map/style'

/* Run: npm run check:decoy (no test runner in this project, see
   package.json). Pure geometry only: no Firestore, no DOM. */

const SEED_IDS = ['milo', 'tala', 'mingming', 'ashes', 'biryani', 'zero']

// --- decoyPoint: inside the safe rectangle, and stable ------------------
const [[west, south], [east, north]] = BGC_BOUNDS
for (const id of SEED_IDS) {
  const [lng, lat] = decoyPoint(id)
  assert.ok(lng > west && lng < east, `${id} decoy lng inside BGC`)
  assert.ok(lat > south && lat < north, `${id} decoy lat inside BGC`)
  const again = decoyPoint(id)
  assert.deepEqual(decoyPoint(id), again, `${id} decoy is stable across calls`)
}

// distinct ids get distinct points
const points = SEED_IDS.map((id) => decoyPoint(id).join(','))
assert.equal(new Set(points).size, SEED_IDS.length, 'decoy points are distinct per id')

// --- decoyFeature: shape and size preserved, centroid moved ------------
function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
const square: Feature<Polygon> = {
  type: 'Feature',
  properties: { id: 'milo' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[121.05, 14.55], [121.051, 14.55], [121.051, 14.551], [121.05, 14.551], [121.05, 14.55]]],
  },
}
const moved = decoyFeature(square, 'milo')
const src = square.geometry.coordinates[0] as [number, number][]
const dst = moved.geometry.coordinates[0] as [number, number][]
assert.equal(dst.length, src.length, 'vertex count preserved')
for (let i = 1; i < src.length; i++) {
  const a = dist(src[i - 1], src[i])
  const b = dist(dst[i - 1], dst[i])
  assert.ok(Math.abs(a - b) < 1e-9, `edge ${i} length preserved`)
}
// centroid of the moved ring is near decoyPoint (within coordinate rounding)
const cx = dst.reduce((s, p) => s + p[0], 0) / dst.length
const cy = dst.reduce((s, p) => s + p[1], 0) / dst.length
const [tx, ty] = decoyPoint('milo')
assert.ok(Math.abs(cx - tx) < 1e-3 && Math.abs(cy - ty) < 1e-3, 'moved centroid near decoy point')

console.log('decoy.check.ts OK')
```

Note: the mean-of-vertices centroid above is a rough check, not `ringCentroid`. `translateToward` uses `ringCentroid` internally; the 1e-3 tolerance absorbs the difference for a near-regular ring. If it fails, loosen to 3e-3, do not switch the check to import `ringCentroid` (keep the check independent of the impl).

- [ ] **Step 4: Add the `check:decoy` script to `package.json`**

In `"scripts"`, after `"check:sightings"`:

```json
"check:decoy": "tsc src/data/decoy.check.ts --outDir node_modules/.tmp/dccheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck --resolveJsonModule --rootDir src && node node_modules/.tmp/dccheck/data/decoy.check.js",
```

- [ ] **Step 5: Run the check**

Run: `cd app/front-end && npm run check:decoy`
Expected: `decoy.check.ts OK`, exit 0. If `@/map/style` fails to resolve under node's tsc, change `decoy.ts`'s import to a relative `../map/style` (the same fix `sightings.ts` documents for the `@/` alias under node) and re-run.

- [ ] **Step 6: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/front-end/src/data/decoy.ts app/front-end/src/data/decoy.check.ts app/front-end/package.json
git commit -m "Add decoy territory placement (deterministic, view-only)"
```

---

### Task 2: `catsRepo.ts` takes `canSeePrecise`

**Files:**
- Modify: `app/front-end/src/data/catsRepo.ts`

**Interfaces:**
- Consumes: `decoyFeature` from `data/decoy.ts`.
- Produces (new signatures, all callers updated in Task 4):
  - `listCats(publicSightings?: Sighting[], canSeePrecise?: boolean): Promise<Cat[]>`
  - `getCat(id: string, canSeePrecise?: boolean): Promise<Cat | null>`
  - `listTerritories(publicSightings?: Sighting[], canSeePrecise?: boolean): Promise<FeatureCollection<Polygon>>`
  - Default for `canSeePrecise` is `false` (fail safe: an un-updated caller degrades rather than leaks).

- [ ] **Step 1: Import `decoyFeature`** at the top of `catsRepo.ts`:

```ts
import { decoyFeature } from './decoy'
```

- [ ] **Step 2: `listTerritories`** — add the parameter and the swap. Current signature is `listTerritories(publicSightings?: Sighting[])`. New:

```ts
export async function listTerritories(
  publicSightings?: Sighting[],
  canSeePrecise = false
): Promise<FeatureCollection<Polygon>> {
```

Inside the `features: snap.docs.map(...)` callback, the tail currently reads:

```ts
      const sighting = seen.get(docSnap.id)
      return sighting ? translateToward(feature, sighting.point) : feature
```

Replace with:

```ts
      /* ponytail: view-only degrade (spec 2026-09-01). An unprivileged
         viewer gets the real outline moved to a fake BGC point, and NO
         sighting translation: applying the real "seen elsewhere" shift to
         a decoy would drag it back toward the true point and re-leak the
         location. The frozen decoy is the whole point. */
      if (!canSeePrecise) return decoyFeature(feature, docSnap.id)
      const sighting = seen.get(docSnap.id)
      return sighting ? translateToward(feature, sighting.point) : feature
```

- [ ] **Step 3: `listCats`** — add the parameter and blank coordinates. New signature:

```ts
export async function listCats(
  publicSightings?: Sighting[],
  canSeePrecise = false
): Promise<Cat[]> {
```

At the end of the `snap.docs.map((docSnap) => { ... })` callback, the return currently is:

```ts
    return { ...cat, lastSeen: cat.lastSeen ?? (sighting ? describeWhen(sighting.at) : undefined) }
```

Replace with:

```ts
    const resolved = { ...cat, lastSeen: cat.lastSeen ?? (sighting ? describeWhen(sighting.at) : undefined) }
    /* ponytail: view-only degrade (spec 2026-09-01). cat.coordinates is a
       real lat/lng string built from the true centroid; left intact it
       hands the real location back as text while the map shows a decoy.
       cat.range stays: it states size, not position. */
    return canSeePrecise ? resolved : { ...resolved, coordinates: '' }
```

- [ ] **Step 4: `getCat`** — thread the parameter:

```ts
export async function getCat(id: string, canSeePrecise = false): Promise<Cat | null> {
  return (await listCats(undefined, canSeePrecise)).find((cat) => cat.id === id) ?? null
}
```

- [ ] **Step 5: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: errors ONLY in `App.tsx` (and any other caller) for the now-changed call sites if the parameter were required. Because `canSeePrecise` defaults, there should be **no** errors. Confirm zero errors.

- [ ] **Step 6: Re-run the sightings check** (unchanged logic, but `catsRepo` imports moved):

Run: `cd app/front-end && npm run check:sightings`
Expected: passes as before.

- [ ] **Step 7: Commit**

```bash
git add app/front-end/src/data/catsRepo.ts
git commit -m "catsRepo: canSeePrecise param swaps territories for decoys and blanks coordinates"
```

---

### Task 3: `data/feeders.ts` and `firestore.rules`

**Files:**
- Create: `app/front-end/src/data/feeders.ts`
- Modify: `app/front-end/firestore.rules`
- Modify: `app/front-end/tests/rules.test.mjs` (add coverage if the file exists and the emulator is available; otherwise skip the run, see Step 6)

**Interfaces:**
- Consumes: `db` from `@/firebase`, `type User` from `firebase/auth` (re-exported by `data/auth.ts`).
- Produces:
  - `isFeeder(uid: string): Promise<boolean>`
  - `type FeederStatus = 'none' | 'pending' | 'approved'`
  - `myFeederStatus(uid: string): Promise<FeederStatus>`
  - `applyAsFeeder(user: User, reason: string): Promise<boolean>`
  - `type FeederRequest = { uid: string; name: string; email: string; reason: string; at: number }`
  - `listFeederRequests(): Promise<FeederRequest[]>`
  - `approveFeeder(uid: string): Promise<boolean>`
  - `declineFeeder(uid: string): Promise<boolean>`

- [ ] **Step 1: Read `data/auth.ts` fully** (the pattern this file mirrors) and `firestore.rules` fully.

- [ ] **Step 2: Write `data/feeders.ts`**

```ts
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/firebase'
import type { User } from './auth'

/* Feeder status, the second trust tier after admin (spec
   2026-09-01-territory-visibility-decoy-design.md). `feeders/{uid}` is a
   marker doc exactly like `admins/{uid}`: written only by an admin (the
   in-app Feeder requests panel), read by any signed-in caller to decide
   what the map shows. Applying is a separate `feederRequests/{uid}` doc,
   never a self-write to `feeders`. */

export type FeederStatus = 'none' | 'pending' | 'approved'

export type FeederRequest = {
  uid: string
  name: string
  email: string
  reason: string
  /** Epoch ms, for oldest-first ordering in the admin queue. */
  at: number
}

/** Whether `uid` holds a `feeders/{uid}` marker. Mirrors auth.ts's
    isAdmin: the rules are what enforce access, this is only ever a read
    the client uses to pick what to render. */
export async function isFeeder(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'feeders', uid))
  return snap.exists()
}

/** approved if the marker exists, else pending if a request is open, else
    none. One extra read on the "none" path is fine: this runs once when
    the account menu opens, not on every render. */
export async function myFeederStatus(uid: string): Promise<FeederStatus> {
  if ((await getDoc(doc(db, 'feeders', uid))).exists()) return 'approved'
  if ((await getDoc(doc(db, 'feederRequests', uid))).exists()) return 'pending'
  return 'none'
}

/** A signed-in visitor asking to be approved. Keyed by uid, so a re-apply
    after a decline is a fresh write to the same path. `name`/`email` come
    off the Google account so the admin has something to recognise. */
export async function applyAsFeeder(user: User, reason: string): Promise<boolean> {
  const trimmed = reason.trim()
  if (!trimmed) return false
  try {
    await setDoc(doc(db, 'feederRequests', user.uid), {
      name: user.displayName?.trim() || user.email?.split('@')[0] || 'Unknown',
      email: user.email ?? '',
      reason: trimmed.slice(0, 500),
      at: Date.now(),
    })
    return true
  } catch {
    return false
  }
}

/** The admin queue, oldest first (a queue is worked from the front, same
    reasoning as data/catsRepo.ts's listPending). Admin-only at the rule
    level; this function verifies nothing itself. */
export async function listFeederRequests(): Promise<FeederRequest[]> {
  const snap = await getDocs(collection(db, 'feederRequests'))
  return snap.docs
    .map((d) => ({ uid: d.id, ...(d.data() as Omit<FeederRequest, 'uid'>) }))
    .sort((a, b) => a.at - b.at)
}

/** Approve: write the marker and clear the request together, so a viewer
    can never be both pending and approved. */
export async function approveFeeder(uid: string): Promise<boolean> {
  try {
    const batch = writeBatch(db)
    batch.set(doc(db, 'feeders', uid), { at: Date.now() })
    batch.delete(doc(db, 'feederRequests', uid))
    await batch.commit()
    return true
  } catch {
    return false
  }
}

/** Decline: drop the request, write no marker. A re-apply is allowed
    (fresh create at the same path). */
export async function declineFeeder(uid: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'feederRequests', uid))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Add the two rules blocks** to `firestore.rules`, inside `match /databases/{database}/documents {`, after the `match /admins/{uid}` block:

```
    // Approved feeders, the second trust tier (spec 2026-09-01). One
    // marker doc per uid, same shape as admins/{uid}. Written only by an
    // admin (data/feeders.ts approveFeeder, from the in-app requests
    // panel); a visitor asking for access writes feederRequests/{uid}
    // below, never this.
    match /feeders/{uid} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // A signed-in visitor's request to be approved as a feeder. Theirs to
    // create and to withdraw; an admin reads the queue and approves
    // (writes feeders/{uid}, deletes this) or declines (deletes this).
    // Never updated in place. Keyed by uid: one open request per person,
    // and a re-apply after a decline is a fresh create at the same path.
    match /feederRequests/{uid} {
      allow read: if isAdmin() || (isSignedIn() && request.auth.uid == uid);
      allow create: if isSignedIn() && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['name', 'email', 'reason', 'at'])
        && request.resource.data.reason is string
        && request.resource.data.reason.size() <= 500;
      allow delete: if isAdmin() || (isSignedIn() && request.auth.uid == uid);
      allow update: if false;
    }
```

- [ ] **Step 4: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors (`feeders.ts` has no consumer yet; that is Tasks 4/6/9).

- [ ] **Step 5: Read `tests/rules.test.mjs`** if it exists. If it does, add a small block exercising: a signed-in non-owner cannot read someone else's `feederRequests` doc; the owner can create their own with a valid `reason`; a non-admin cannot write `feeders/{uid}`; an admin can. Follow the file's existing helper style.

- [ ] **Step 6: Run the rules test if the emulator is available**

Run: `cd app/front-end && npm run test:rules`
Expected: passes. If the Firebase emulator or Java is not installed in this environment, note that in the commit body ("rules test not run: emulator unavailable") and rely on `tsc` plus review. Do not block the plan on it.

- [ ] **Step 7: Commit**

```bash
git add app/front-end/src/data/feeders.ts app/front-end/firestore.rules app/front-end/tests/rules.test.mjs
git commit -m "Add feeders/{uid} tier: data seam, request flow, firestore rules"
```

---

### Task 4: `App.tsx` wiring

**Files:**
- Modify: `app/front-end/src/App.tsx`

**Interfaces:**
- Consumes: `useAdmin`/`useUid`/`useUser` pattern (already in the file), `isFeeder` from `data/feeders.ts`, `subscribeAuth` from `data/auth.ts`, the new `canSeePrecise` params on `listCats`/`listTerritories` (Task 2), `<FeederRequests>` from `ui/FeederRequests.tsx` (Task 9 — if doing this task first, stub the import as described in Step 6).
- Produces: `canSeePrecise: boolean` passed as a prop to `<Territories>`, `<Plate>` (both desktop and the `<CatDeck>` pass-through), `<ReportSighting>`, and used to guard the sighting-report entry points.

- [ ] **Step 1: Add `useFeeder()`** next to `useAdmin()` (around `App.tsx:123-135`):

```ts
/* Approved-feeder status, tracked alongside admin. An admin is implicitly
   privileged too, so callers use `canSeePrecise` (admin || feeder), not
   this alone. Flips false->true after first paint the same way useAdmin
   does: onAuthStateChanged fires once Firebase has checked for a persisted
   session, then again on a fresh sign-in. */
function useFeeder(): boolean {
  const [feeder, setFeeder] = useState(false)
  useEffect(() => {
    return subscribeAuth((user) => {
      if (!user) {
        setFeeder(false)
        return
      }
      isFeeder(user.uid).then(setFeeder)
    })
  }, [])
  return feeder
}
```

Add `isFeeder` to the `data/feeders.ts` import (create the import line).

- [ ] **Step 2: In the `App()` body**, where `useAdmin()`/`useUid()` are called, add:

```ts
  const admin = useAdmin()
  const feeder = useFeeder()
  const canSeePrecise = admin || feeder
```

(Keep the existing `admin`/`uid` lines; only `feeder`/`canSeePrecise` are new.)

- [ ] **Step 3: Thread `canSeePrecise` into the repo calls.** Find every `listCats(` / `listTerritories(` / `getCat(` call in `App.tsx`. They currently look like `listCats(publicSightings)` / `listTerritories(publicSightings)`. Add the second/third argument:

```ts
const [cats, terr] = await Promise.all([
  listCats(publicSightings, canSeePrecise),
  listTerritories(publicSightings, canSeePrecise),
])
```

Add `canSeePrecise` to the dependency array of the effect that does the loading, so a sign-in / approval mid-session refetches with accurate geometry. (The file already has a `loadToken` refresh counter; `canSeePrecise` sits alongside it in the deps.)

- [ ] **Step 4: Pass `canSeePrecise` as a prop** to `<Territories ... />`, to both `<Plate ... />` mounts (the desktop one in `App.tsx` and the one inside `<CatDeck>` — pass it through `CatDeck`'s props the same way `uid` is passed through), and to `<ReportSighting ... />`.

- [ ] **Step 5: Gate the floating report entry.** Find where `<ReportSighting>` is mounted / where its trigger button lives. Wrap the trigger so it renders only when `canSeePrecise` is true. Where it was, render nothing extra (the plate carries the "get approved" copy, Task 10). If `ReportSighting` owns its own trigger internally, pass `canSeePrecise` and return `null` early there instead (Task 10 covers the component side).

- [ ] **Step 6: Mount `<FeederRequests>`** next to the existing admin-gated `<ReviewQueue>` (search `ReviewQueue` in `App.tsx`). Same conditional (`admin && ...`). If Task 9 is not done yet, create `app/front-end/src/ui/FeederRequests.tsx` with `export function FeederRequests() { return null }` as a stub and finish it in Task 9.

- [ ] **Step 7: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors. If `<Territories>`/`<Plate>`/`<ReportSighting>` complain about an unknown `canSeePrecise` prop, that prop is added in Tasks 5/7/10; add it to their `Props` type now as `canSeePrecise: boolean` to keep the build green (those tasks then use it).

- [ ] **Step 8: Commit**

```bash
git add app/front-end/src/App.tsx app/front-end/src/ui/FeederRequests.tsx app/front-end/src/ui/CatDeck.tsx
git commit -m "App: useFeeder, canSeePrecise threaded to repo and map/plate/report"
```

---

### Task 5: `Territories.tsx` gates the absolute-point effects

**Files:**
- Modify: `app/front-end/src/map/Territories.tsx`

**Interfaces:**
- Consumes: `canSeePrecise: boolean` prop from `App.tsx` (Task 4).
- Produces: nothing new; the fill/line/glow already draw whatever `territories` they are handed (decoy-placed upstream when `!canSeePrecise`).

- [ ] **Step 1: Add `canSeePrecise` to `Props`** and destructure it in the component signature.

- [ ] **Step 2: Guard the habitat-pings effect.** At the very top of that `useEffect` (the one that builds `ZONES` / `PING_A` / `PING_B`), after `if (!map || !isLoaded || !selectedId) return`, add:

```ts
    /* Unprivileged viewers see a frozen decoy (data/catsRepo.ts). The
       pings plot the centroid and real sighting points as absolute
       coordinates, so there is nothing truthful to draw over a decoy.
       Nothing to clean up: the effect returns before it adds a source. */
    if (!canSeePrecise) return
```

Add `canSeePrecise` to that effect's dependency array.

- [ ] **Step 3: Guard the pending-ghost effects.** There are two (mount/teardown of `GHOST_SOURCE`, and the `setData` effect). In the `setData` effect, force an empty collection when `!canSeePrecise`:

```ts
    const summary = selectedId && canSeePrecise ? pendingByCat(sightings).get(selectedId) : undefined
```

Add `canSeePrecise` to that effect's deps. (Leaving the layer mounted-but-empty is fine and matches how it already behaves for a cat with no pending sighting.)

- [ ] **Step 4: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/map/Territories.tsx
git commit -m "Territories: skip pings and pending ghost for unprivileged viewers"
```

---

### Task 6: Confirm `CatMarkers.tsx` needs no change

**Files:**
- Read only: `app/front-end/src/map/CatMarkers.tsx`

- [ ] **Step 1: Read `CatMarkers.tsx` fully.** Confirm it derives its marker/dot positions from the `territories` / centroid data passed down from `App.tsx` (decoy-placed upstream when `!canSeePrecise`), and holds no static import of `territories.geo.json` and no independent fetch of true geometry.

- [ ] **Step 2:** If confirmed clean, no code change. Record the finding in the Task 7 commit body or a one-line note. If it does hold independent geometry, add `canSeePrecise` handling mirroring Task 5 and commit separately:

```bash
git add app/front-end/src/map/CatMarkers.tsx
git commit -m "CatMarkers: use decoy-placed centroids for unprivileged viewers"
```

---

### Task 7: `Plate.tsx` lock affordance

**Files:**
- Modify: `app/front-end/src/plate/Plate.tsx`
- Modify: `app/front-end/src/shell.css` (lock-row styling, tokens only)

**Interfaces:**
- Consumes: `canSeePrecise: boolean` prop (added to `Plate`'s `Props` in Task 4 Step 7).
- Produces: nothing new.

- [ ] **Step 1: Read `Plate.tsx:700-760`** (the `.plate-range` block) and `Plate.tsx:1218-1264` (the `.plate-foot` coordinates button).

- [ ] **Step 2: Replace the Range block body when `!canSeePrecise`.** Keep the `.plate-range` container and the `Range` label; swap the shape glyph + range sentence + derived distance line for:

```tsx
{canSeePrecise ? (
  <>{/* existing glyph + cat.range + inside/outside line, unchanged */}</>
) : (
  <div className="plate-range-locked">
    <Lock size={12} aria-hidden />
    <span>Location hidden. Sign in and get approved as a feeder to see the accurate territory.</span>
  </div>
)}
```

Import `Lock` from `lucide-react` (the file already imports `Copy`, `Check`, `X` from it).

- [ ] **Step 3: Replace the coordinates copy button when `!canSeePrecise`.** In `.plate-foot`:

```tsx
{canSeePrecise ? (
  <>{/* existing <button className="plate-copy"> ... </button>, unchanged */}</>
) : (
  <p className="plate-coords-locked">
    <Lock size={12} aria-hidden /> Accurate location is feeder-only
  </p>
)}
```

- [ ] **Step 4: Style the two new elements** in `shell.css`, near the existing `.plate-range` / `.plate-foot` rules. Use only tokens:

```css
.plate-range-locked,
.plate-coords-locked {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-soft);
  font-size: var(--text-sm);
  line-height: 1.4;
}
.plate-coords-locked {
  margin: 0;
}
```

(Confirm the exact token names for the small text size and the 8px-scale gap by grepping `shell.css` for `--text-` and `--space-`; use whatever the file already uses for secondary plate text.)

- [ ] **Step 5: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/front-end/src/plate/Plate.tsx app/front-end/src/shell.css
git commit -m "Plate: lock the range and coordinates rows for unprivileged viewers"
```

---

### Task 8: `AccountMenu.tsx` "Apply as a feeder"

**Files:**
- Modify: `app/front-end/src/ui/AccountMenu.tsx`
- Modify: `app/front-end/src/shell.css` (or wherever `AccountMenu`'s styles live — grep for `account-menu`)

**Interfaces:**
- Consumes: `myFeederStatus`, `applyAsFeeder` from `data/feeders.ts`; the signed-in `User` (AccountMenu already has access to the auth user or can take it as a prop — read the file to see which).
- Produces: nothing external.

- [ ] **Step 1: Read `AccountMenu.tsx` fully** and note how it gets the current user and how it renders its rows / error text (`.account-menu-error` exists at line 124).

- [ ] **Step 2: Add feeder-status state.** On menu open (or on user change), call `myFeederStatus(user.uid)` and store `'none' | 'pending' | 'approved' | 'loading'`. While signed out, treat as `'signedout'`.

- [ ] **Step 3: Render the row by state:**
  - signed out: a row "Sign in to apply as a feeder" that runs the existing Google sign-in handler.
  - `none`: a button "Apply as a feeder" that reveals an inline `<textarea>` (placeholder "Why do you want accurate cat locations?") plus a Submit button. Submit calls `applyAsFeeder(user, reason)`; on `true` set state to `pending`; on `false` show `.account-menu-error` "Could not send that, try again."
  - `pending`: disabled text "Feeder application pending."
  - `approved`: render nothing (row hidden).
  - Admin: caller can pass a prop to hide it, or leave it (an admin seeing "pending/none" is harmless). Prefer hiding if AccountMenu already knows admin state.

- [ ] **Step 4: Style** the inline form (textarea + submit) with existing account-menu tokens. Keep it to one textarea and one button, no modal.

- [ ] **Step 5: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/front-end/src/ui/AccountMenu.tsx app/front-end/src/shell.css
git commit -m "AccountMenu: Apply as a feeder row with inline request form"
```

---

### Task 9: `ui/FeederRequests.tsx` admin list

**Files:**
- Create/replace: `app/front-end/src/ui/FeederRequests.tsx` (replaces the Task 4 stub)
- Modify: `app/front-end/src/shell.css` (grep for the `.review-queue` styles it mirrors; reuse classes where possible)

**Interfaces:**
- Consumes: `listFeederRequests`, `approveFeeder`, `declineFeeder`, `type FeederRequest` from `data/feeders.ts`.
- Produces: `export function FeederRequests(): JSX.Element` (default no props; if `App.tsx` passes a refresh token like it does to `ReviewQueue`, accept `{ loadToken?: number }` and add it to the load effect deps).

- [ ] **Step 1: Read `ui/ReviewQueue.tsx` fully** — this component is modelled on it (load list, per-row actions, empty state, error handling, loading state).

- [ ] **Step 2: Write the component:**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { approveFeeder, declineFeeder, listFeederRequests, type FeederRequest } from '@/data/feeders'

/* The admin's feeder-approval queue, phase: territory visibility tiers
   (spec 2026-09-01). Mounted behind App.tsx's admin gate next to
   ui/ReviewQueue.tsx and modelled on it. Approve writes feeders/{uid} and
   clears the request; Decline just clears it. Oldest first. */
export function FeederRequests({ loadToken = 0 }: { loadToken?: number }) {
  const [requests, setRequests] = useState<FeederRequest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    listFeederRequests().then(setRequests).catch(() => setError('Could not load feeder requests.'))
  }, [])

  useEffect(load, [load, loadToken])

  const act = async (uid: string, fn: (uid: string) => Promise<boolean>) => {
    setBusy(uid)
    setError('')
    const ok = await fn(uid)
    setBusy(null)
    if (ok) setRequests((r) => (r ? r.filter((x) => x.uid !== uid) : r))
    else setError('That did not go through, try again.')
  }

  if (requests === null) return <p className="review-queue-empty">Loading feeder requests...</p>
  if (requests.length === 0) return <p className="review-queue-empty">No feeder applications waiting.</p>

  return (
    <div className="feeder-requests">
      {error && <p className="admin-edit-error" role="alert">{error}</p>}
      <ul>
        {requests.map((r) => (
          <li key={r.uid} className="feeder-request">
            <div className="feeder-request-who">
              <strong>{r.name}</strong>
              <span>{r.email}</span>
            </div>
            <p className="feeder-request-reason">{r.reason}</p>
            <div className="feeder-request-actions">
              <button type="button" disabled={busy === r.uid} onClick={() => act(r.uid, approveFeeder)}>
                Approve
              </button>
              <button type="button" disabled={busy === r.uid} onClick={() => act(r.uid, declineFeeder)}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Adjust class names to match whatever `ReviewQueue.tsx` actually uses for its container/empty/error states so the styling is inherited.

- [ ] **Step 3: Add minimal styles** in `shell.css` for `.feeder-requests` / `.feeder-request` (reuse `.review-queue*` rules if they fit; only add what is genuinely new), tokens only.

- [ ] **Step 4: Confirm the `App.tsx` mount** from Task 4 Step 6 now renders the real component (remove the stub file's `return null` if it was a separate stub; here we replaced the file). If `App.tsx` passes a `loadToken`, it is wired; if not, the default `0` is fine.

- [ ] **Step 5: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/front-end/src/ui/FeederRequests.tsx app/front-end/src/shell.css
git commit -m "FeederRequests: admin approval list for feeder applications"
```

---

### Task 10: Gate sighting reporting behind `canSeePrecise`

**Files:**
- Modify: `app/front-end/src/ui/ReportSighting.tsx`
- Modify: `app/front-end/src/plate/Plate.tsx`

**Interfaces:**
- Consumes: `canSeePrecise: boolean` prop (threaded in Task 4).

- [ ] **Step 1: `ReportSighting.tsx`** — add `canSeePrecise` to `Props`. If the component renders its own floating trigger button, `return null` early when `!canSeePrecise` (or render only the trigger's absence). If `App.tsx` already conditionally mounts it (Task 4 Step 5), just add the prop to the type for consistency and add a defensive `if (!canSeePrecise) return null` at the top.

- [ ] **Step 2: `Plate.tsx`** — find the "I saw this one here" button (search `saw` / `I saw`). When `!canSeePrecise`, replace it with static text: "Get approved as a feeder to report sightings." (reuse `.plate-range-locked` styling from Task 7 or a sibling class).

- [ ] **Step 3: Verify the pending-review section.** If the plate shows a "Pending review" section with vote controls to non-admins, confirm it still behaves for a feeder (who now can see it) and is simply absent for `!canSeePrecise` (no pending data is fetched for them anyway once reporting is gated, but the section's own render guard should not throw). Read the relevant block; add a `canSeePrecise &&` guard to the section wrapper if needed.

- [ ] **Step 4: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/ui/ReportSighting.tsx app/front-end/src/plate/Plate.tsx
git commit -m "Gate sighting reporting to feeders and admins"
```

---

### Task 11: Full build and roadmap note

**Files:**
- Modify: `docs/superpowers/plans/2026-08-24-feature-roadmap.md`

- [ ] **Step 1: Full typecheck and build**

Run: `cd app/front-end && npx tsc -b && npm run build`
Expected: build succeeds, three entry points emitted, no TS errors.

- [ ] **Step 2: Run every check script that touches changed code**

Run: `cd app/front-end && npm run check:decoy && npm run check:sightings`
Expected: both pass.

- [ ] **Step 3: Add a roadmap entry** under the cross-cutting section of `2026-08-24-feature-roadmap.md`:

```markdown
- [x] **Territory visibility tiers** — done 2026-09-01, branch
      `feature/territory-visibility-security`. `canSeePrecise = admin ||
      approved feeder` (`feeders/{uid}`, mirrors `admins/{uid}`).
      Unprivileged viewers (signed out, or signed in and not approved) see
      each territory relocated to a stable fake BGC point via
      `data/decoy.ts` (real shape and size, fake position, frozen: no
      sighting shift, no pings, no ghost), coordinates blanked, a lock row
      in the plate. Approved feeders and admins see accurate geometry.
      In-app "Apply as a feeder" (`ui/AccountMenu.tsx`) plus an admin
      approval list (`ui/FeederRequests.tsx`). Sighting reporting is
      feeder-gated. Visual-only by decision: the real polygon still ships
      to every browser; the data-split upgrade path is recorded in the
      spec (§8) for when cats are real.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-24-feature-roadmap.md
git commit -m "Record territory visibility tiers in the feature roadmap"
```

---

## Self-Review

**Spec coverage:**

- §1 two tiers, `useFeeder`, no middle tier → Task 4.
- §2 `decoy.ts`, deterministic, safe rectangle, `decoy.check.ts`, `check:decoy` → Task 1.
- §3 `catsRepo` `canSeePrecise` on `listCats`/`getCat`/`listTerritories`, skip sighting translation, blank coordinates, keep range → Task 2.
- §4 `Territories` gates pings + ghost; `CatMarkers` confirmed; `Plate` lock affordance → Tasks 5, 6, 7.
- §5 `firestore.rules` `feeders/{uid}` + `feederRequests/{uid}`; `data/feeders.ts` full API → Task 3.
- §6 `AccountMenu` apply row + inline form; `FeederRequests` admin list mounted behind admin gate → Tasks 8, 9, 4.
- §7 sighting reporting gated to `canSeePrecise` (UI only, create rule unchanged) → Tasks 4, 10.
- §8 `ponytail:` honesty comments on the decoy path → Tasks 1, 2.
- §9 file list matches Tasks 1-10; roadmap note → Task 11.
- §10 out-of-scope items are not implemented (no data split, no middle tier, no `sightings` create-rule change, no rate limiting).

**Placeholder scan:** No TBD/TODO. Every code step has real content. The two "read the file then mirror it" steps (Tasks 6, 8, 9 referencing `CatMarkers`/`AccountMenu`/`ReviewQueue`) name the exact file and what to confirm or copy; the surrounding steps carry the concrete code.

**Type consistency:** `canSeePrecise: boolean` everywhere (repo params default `false`; props required). `FeederStatus` / `FeederRequest` defined once in Task 3, consumed in Tasks 4/8/9 with matching shapes. `decoyPoint`/`decoyFeature` signatures identical in Tasks 1 and 2. `isFeeder(uid: string): Promise<boolean>` consistent Task 3 → Task 4.

**Known soft spots for the executor:** the `@/` alias under node's bare `tsc` (Task 1 Step 5 gives the fix), and exact token names in `shell.css` (Tasks 7, 9 say to grep and match). Both are called out at the step.
