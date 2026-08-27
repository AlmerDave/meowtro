# Phase 9 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `catsRepo.ts`'s `localStorage`-backed mock with Firestore (data), Firebase Storage (photos) and Firebase Auth (Google sign-in), with no server the project has to write or host.

**Architecture:** The static front end talks to Firebase's client SDK directly. `data/catsRepo.ts` stays the one seam every UI component already goes through — most of its callers (`ReviewQueue.tsx`, `Rail.tsx`, `CatDeck.tsx`) need no changes at all, since every `catsRepo` function keeps its name and its `Promise`-returning shape. Two real exceptions to "only bodies change," both because signing in threads a real uid through what used to be anonymous/browser-local: `Plate.tsx` and `ReportSighting.tsx` gain a handful of call-site edits (passing `uid`, uploading a photo instead of keeping a data URI), and `map/Territories.tsx`/`map/CatMarkers.tsx` — which bypass `catsRepo.ts` entirely and read `data/sightings.ts` synchronously from inside MapLibre effects that cannot `await` — move to reading an already-fetched `sightings` array via a new prop instead. `data/sightings.ts` keeps its pure predicate/geometry functions (`isSurveyed`, `isOwnPending`, `sortForDisplay`, `applyVote`, `distanceM`, `translateToward`, `describeWhen`) and swaps only its storage primitives. Firestore Security Rules become the real enforcement of the review boundary, replacing the JS-only check a browser could previously just not call.

**Tech Stack:** `firebase` (client SDK: Auth, Firestore, Storage) as a dependency; `firebase-tools` and `@firebase/rules-unit-testing` as dev dependencies for the local emulator and rule tests; `firebase-admin` as a dev dependency for the one-time seed migration script. No new UI framework, no new state library — React state and the existing `catsRepo` seam are unchanged in shape.

**Spec:** `docs/superpowers/specs/2026-08-27-phase9-backend-design.md`

## Global Constraints

- Never add a `location` field to `Cat` — territories stay polygons (`docs/superpowers/specs/2026-08-27-phase9-backend-design.md`, CLAUDE.md, spec §9).
- No Cloud Functions in this phase — stay on Firebase's free Spark plan (design doc, "Platform").
- Google sign-in only, no email/password or magic link (design doc, "Auth").
- Browsing (map, territories, plates) stays fully public and unauthenticated; sign-in gates writes only (design doc, "Auth").
- No comments of the form "TODO"/"for later" — this codebase's comments explain a real *why*, and that convention carries into every new file this plan creates (root `CLAUDE.md`, app `CLAUDE.md`).
- Verification for non-trivial pure logic is a `*.check.ts` compiled with `tsc` and run under `node` with asserts — no test framework (app `CLAUDE.md`, "Commands").

---

## File structure this plan produces

```
app/front-end/
  firebase.json                       new — emulator + rules deploy config
  firestore.rules                     new
  firestore.indexes.json              new
  storage.rules                       new
  .env.local.example                  new — documents the six VITE_FIREBASE_* vars
  scripts/
    migrateSeed.ts                    new — one-time push of the 12 seed cats + their sighting history into Firestore
  src/
    firebase.ts                       new — initializeApp + typed auth/db/storage exports
    data/
      auth.ts                         new — signInWithGoogle, signOutUser, subscribeAuth, isAdmin, getCurrentUid
      photoUpload.ts                  new — uploads a Blob to Storage, returns its download URL
      territoryShape.ts               new — shapeRing/shapePreviewPoints/SHAPES/Shape/CatDraft/slugify, extracted from localCats.ts
      territoryShape.check.ts         new — the geometry assertions from localCats.check.ts, ported
      catsRepo.ts                     modified — every function body: localStorage -> Firestore
      sightings.ts                    modified — storage primitives -> Firestore; pure functions (incl. a simplified isOwnPending) unchanged in kind
      sightings.check.ts              modified — drop SEEDED/overlay/buildAdminSighting assertions, keep pendingByCat/applyVote
      review.check.ts                 modified — isOwnPending's new (sighting, uid) signature
      localCats.ts                    deleted (superseded by territoryShape.ts)
      localCats.check.ts              deleted (superseded by territoryShape.check.ts)
      overlay.ts                      deleted (no longer needed — see Task 9)
    ui/
      imageToDataUrl.ts                modified — adds compressImageToBlob, extracts shared resize math
      imageToDataUrl.check.ts          new — checks the extracted resize math
      RecordCat.tsx                    modified — photo pickers upload to Storage instead of keeping a data URI
      ReportSighting.tsx               modified — photo picker uploads to Storage; sign-in gate before commit
      About.tsx                        modified — reads Firestore via listAllSightings/getCurrentUid instead of synchronous localStorage
    plate/
      Plate.tsx                        modified — addPhoto uploads to Storage instead of keeping a data URI
    map/
      MapCanvas.tsx                    modified — forwards new `sightings`/`uid` props to Territories/CatMarkers
      Territories.tsx                  modified — reads the `sightings`/`uid` props instead of scanning localStorage synchronously
      CatMarkers.tsx                   modified — reads the `sightings` prop instead of scanning localStorage synchronously
    App.tsx                            modified — useAdmin reads real auth state instead of ?role=admin; fetches sightings alongside cats/territories
    landing/
      Landing.tsx                      modified — Sign in triggers a real Google popup
  package.json                        modified — new scripts: test:rules, seed:firebase; new deps
```

---

### Task 1: Firebase project wiring

**Files:**
- Create: `app/front-end/src/firebase.ts`
- Create: `app/front-end/.env.local.example`
- Modify: `app/front-end/package.json` (add `firebase` dependency)
- Modify: `app/front-end/.gitignore` (if `.env.local` is not already ignored)

**Interfaces:**
- Produces: `auth: Auth`, `db: Firestore`, `storage: FirebaseStorage` — every later task imports these three from `@/firebase`.

- [ ] **Step 1: Check whether `.env.local` is already gitignored**

Run: `grep -n "\.env" app/front-end/.gitignore` (or read the file if it's short)
If `.env.local` (or `.env*.local`) is not listed, add a line `.env.local` to `app/front-end/.gitignore`. Vite's own scaffold usually already ignores it — confirm rather than assume.

- [ ] **Step 2: Install the Firebase SDK**

Run (from `app/front-end/`): `npm install firebase`

- [ ] **Step 3: Write `.env.local.example`**

```
# Copy to .env.local (gitignored) and fill in from the Firebase console:
# Project settings -> General -> Your apps -> SDK setup and configuration.
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 4: Write `src/firebase.ts`**

```ts
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

/* One Firebase app instance, module-scope, same reason map/MapCanvas.tsx
   sets up MapLibre's worker pool once at module scope: every consumer
   needs the same instance, and re-initializing on every import would be
   wrong rather than merely wasteful.

   VITE_* rather than plain env names: Vite only exposes prefixed vars to
   client code (anything else is a server-only secret it deliberately
   strips), and an API key here is public by design — Firebase's real
   access control is Firestore/Storage Security Rules, not this key. */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    'Missing Firebase config. Copy .env.local.example to .env.local and fill it in from the Firebase console.'
  )
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
```

- [ ] **Step 5: Verify the build still typechecks**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors. (This step cannot be a `node`-run check — `import.meta.env` is a Vite/browser construct with no `node` equivalent, the same reason `ui/imageToDataUrl.ts` has no check script for its `FileReader`/`Image`/`canvas` calls. Real verification of this file is the manual gate at the end of Task 11, once `App.tsx` actually calls into it in a running `npm run dev`.)

- [ ] **Step 6: Commit**

```bash
git add app/front-end/src/firebase.ts app/front-end/.env.local.example app/front-end/package.json app/front-end/package-lock.json app/front-end/.gitignore
git commit -m "Add Firebase app wiring (Auth, Firestore, Storage)"
```

---

### Task 2: Firestore + Storage Security Rules, with emulator tests

**Files:**
- Create: `app/front-end/firebase.json`
- Create: `app/front-end/firestore.rules`
- Create: `app/front-end/firestore.indexes.json`
- Create: `app/front-end/storage.rules`
- Create: `app/front-end/tests/rules.test.mjs`
- Modify: `app/front-end/package.json` (add `firebase-tools`, `@firebase/rules-unit-testing` dev deps; add `test:rules` script)

**Interfaces:**
- Produces: the deployed rule shapes every later task's Firestore/Storage calls must satisfy — `cats/{id}` (public read, admin write), `sightings/{id}` (public read, signed-in create as self/pending, admin full update, author-or-admin delete while pending, any signed-in user may update only `votes`), `sightings/{id}/votes/{uid}` (signed-in read, only that uid writes), `admins/{uid}` (signed-in read, console-only write).

This task requires no live Firebase project — the emulator runs entirely locally against a fake project id. It does require a Java runtime installed (the Firestore/Storage emulators run on the JVM); if `java -version` fails, install a JDK first.

- [ ] **Step 1: Install dev dependencies**

Run (from `app/front-end/`): `npm install -D firebase-tools @firebase/rules-unit-testing`

- [ ] **Step 2: Write `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "auth": { "port": 9099 }
  }
}
```

- [ ] **Step 3: Write `firestore.indexes.json`** (empty for now — every query this plan writes is a single-collection equality/order-by, which Firestore serves without a composite index)

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 4: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }
    function isAdmin() {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    // Marker docs only, one per admin, keyed by their Google uid. Added by
    // hand in the Firebase console (design doc, "Data model") — there is no
    // client path that should ever write one.
    match /admins/{uid} {
      allow read: if isSignedIn();
      allow write: if false;
    }

    match /cats/{catId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /sightings/{sightingId} {
      allow read: if true;

      // A visitor's own report lands pending, self-attributed. An admin's
      // direct photo add (catsRepo.addAdminPhoto) lands surveyed outright,
      // same trust level as the cat record itself (sightings.ts's own note
      // on buildAdminSighting).
      allow create: if
        (isSignedIn()
          && request.resource.data.authorUid == request.auth.uid
          && request.resource.data.status == 'pending')
        || (isAdmin() && request.resource.data.status == 'surveyed');

      // Admin: verdicts, reorders, corrections — anything. Any signed-in
      // user, separately: may update ONLY the `votes` tally, which is what
      // the vote transaction's parent-doc write does (data/sightings.ts).
      //
      // This trusts the client's vote arithmetic rather than re-deriving it
      // from the votes/ subcollection — a real integrity gap (a malicious
      // client could still write an inflated count) that a Cloud Function
      // trigger would close. Left open deliberately: closing it needs
      // Cloud Functions, which this phase is scoped to avoid (design doc,
      // "Platform"). Upgrade path if it ever matters: a Function that
      // recomputes `votes` from the subcollection on every write to it.
      allow update: if isAdmin()
        || (isSignedIn()
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['votes']));

      // Withdraw (own, still pending) or an admin's housekeeping (any).
      allow delete: if isAdmin()
        || (isSignedIn()
            && resource.data.authorUid == request.auth.uid
            && resource.data.status == 'pending');

      match /votes/{uid} {
        allow read: if isSignedIn();
        allow write: if isSignedIn() && request.auth.uid == uid;
      }
    }
  }
}
```

- [ ] **Step 5: Write `storage.rules`**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

- [ ] **Step 6: Write `tests/rules.test.mjs`**

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'

/* Run under the emulator only: `npm run test:rules` wraps this in
   `firebase emulators:exec`, which is what makes localhost:8080/9199
   exist for initializeTestEnvironment to connect to. Running this file
   directly with node against nothing listening fails at setup, loudly,
   not with a false pass. */

const testEnv = await initializeTestEnvironment({
  projectId: 'meowtro-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
})

const ADMIN_UID = 'admin-1'
const VISITOR_UID = 'visitor-1'
const OTHER_UID = 'visitor-2'

// Seed one cat and one admin marker as the environment owner, bypassing
// rules entirely — this is fixture setup, not something under test.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await db.doc('cats/milo').set({ name: 'MILO' })
  await db.doc('admins/' + ADMIN_UID).set({})
  await db.doc('sightings/pending-1').set({
    catId: 'milo',
    status: 'pending',
    authorUid: VISITOR_UID,
    at: Date.now(),
    votes: { up: 0, down: 0 },
  })
})

const anon = testEnv.unauthenticatedContext().firestore()
const visitor = testEnv.authenticatedContext(VISITOR_UID).firestore()
const other = testEnv.authenticatedContext(OTHER_UID).firestore()
const admin = testEnv.authenticatedContext(ADMIN_UID).firestore()

// Anyone can read cats and sightings, signed in or not.
await assertSucceeds(anon.doc('cats/milo').get())
await assertSucceeds(anon.doc('sightings/pending-1').get())

// Only an admin can write a cat.
await assertFails(visitor.doc('cats/milo').set({ name: 'MILO 2' }))
await assertSucceeds(admin.doc('cats/milo').set({ name: 'MILO 2' }))

// A signed-in visitor can create their own pending sighting; not one
// attributed to somebody else, and not one that skips review.
await assertSucceeds(
  visitor.doc('sightings/self-1').set({
    catId: 'milo',
    status: 'pending',
    authorUid: VISITOR_UID,
    at: Date.now(),
  })
)
await assertFails(
  visitor.doc('sightings/spoofed-1').set({
    catId: 'milo',
    status: 'pending',
    authorUid: OTHER_UID,
    at: Date.now(),
  })
)
await assertFails(
  visitor.doc('sightings/skip-review-1').set({
    catId: 'milo',
    status: 'surveyed',
    authorUid: VISITOR_UID,
    at: Date.now(),
  })
)

// An admin may create a surveyed sighting directly (addAdminPhoto).
await assertSucceeds(
  admin.doc('sightings/admin-photo-1').set({
    catId: 'milo',
    status: 'surveyed',
    authorUid: ADMIN_UID,
    at: Date.now(),
  })
)

// The report's own author can withdraw it while pending; a stranger cannot.
await assertFails(other.doc('sightings/pending-1').delete())
await assertSucceeds(visitor.doc('sightings/pending-1').delete())

// Re-seed for the vote/verdict checks below, since the withdraw above
// consumed pending-1.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().doc('sightings/pending-2').set({
    catId: 'milo',
    status: 'pending',
    authorUid: VISITOR_UID,
    at: Date.now(),
    votes: { up: 0, down: 0 },
  })
})

// Any signed-in user may update the votes field alone; not any other field.
await assertSucceeds(
  other.doc('sightings/pending-2').update({ votes: { up: 1, down: 0 } })
)
await assertFails(
  other.doc('sightings/pending-2').update({ status: 'surveyed' })
)

// Only an admin may set a verdict.
await assertFails(other.doc('sightings/pending-2').update({ status: 'discarded' }))
await assertSucceeds(admin.doc('sightings/pending-2').update({ status: 'discarded' }))

// A vote sub-document is writable only by the uid it is keyed on.
await assertFails(other.doc('sightings/pending-2/votes/' + VISITOR_UID).set({ direction: 'up' }))
await assertSucceeds(visitor.doc('sightings/pending-2/votes/' + VISITOR_UID).set({ direction: 'up' }))

await testEnv.cleanup()
console.log('rules: ok')
```

- [ ] **Step 7: Add the `test:rules` script to `package.json`**

```json
"test:rules": "firebase emulators:exec --project meowtro-rules-test --only firestore,storage \"node tests/rules.test.mjs\""
```

- [ ] **Step 8: Run it**

Run: `cd app/front-end && npm run test:rules`
Expected: `rules: ok` printed, exit code 0. If the emulator fails to start, run `java -version` first — a missing JDK is the most common cause.

- [ ] **Step 9: Commit**

```bash
git add app/front-end/firebase.json app/front-end/firestore.rules app/front-end/firestore.indexes.json app/front-end/storage.rules app/front-end/tests/rules.test.mjs app/front-end/package.json app/front-end/package-lock.json
git commit -m "Add Firestore/Storage security rules with emulator tests"
```

---

### Task 3: Auth module

**Files:**
- Create: `app/front-end/src/data/auth.ts`

**Interfaces:**
- Consumes: `auth` and `db` from `@/firebase` (Task 1).
- Produces: `signInWithGoogle(): Promise<void>`, `signOutUser(): Promise<void>`, `subscribeAuth(cb: (user: User | null) => void): () => void`, `isAdmin(uid: string): Promise<boolean>` — Task 11 (`App.tsx`, `Landing.tsx`) is the consumer of all four.

- [ ] **Step 1: Write `src/data/auth.ts`**

```ts
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/firebase'

/* Google only (design doc, "Auth"): one button, no password to create or
   reset, and Firebase Auth handles the whole popup/token exchange. */
const provider = new GoogleAuthProvider()

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, provider)
}

export async function signOutUser(): Promise<void> {
  await signOut(auth)
}

/** Wraps Firebase's own onAuthStateChanged so callers never import
    `firebase/auth` directly — same reasoning catsRepo.ts already gives
    for being the one file that knows what storage looks like underneath
    it. Returns the unsubscribe function React effects expect back. */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}

/** Whether `uid` has an `admins/{uid}` marker doc (firestore.rules'
    `isAdmin()`, mirrored here for the client to decide what to render —
    the rules are what actually enforce it, this is only ever a read). */
export async function isAdmin(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'admins', uid))
  return snap.exists()
}

export type { User }
```

- [ ] **Step 2: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors. (No `*.check.ts` here, same reason as Task 1's `firebase.ts`: `signInWithPopup` needs a real browser popup and cannot run under `node`. The manual gate in Task 11 is this file's real test.)

- [ ] **Step 3: Commit**

```bash
git add app/front-end/src/data/auth.ts
git commit -m "Add the Firebase Auth wrapper (Google sign-in, admin check)"
```

---

### Task 4: Photo compression + Storage upload

**Files:**
- Modify: `app/front-end/src/ui/imageToDataUrl.ts`
- Create: `app/front-end/src/ui/imageToDataUrl.check.ts`
- Create: `app/front-end/src/data/photoUpload.ts`
- Modify: `app/front-end/package.json` (add `check:imagesize` script)

**Interfaces:**
- Produces: `compressImageToBlob(file: File, maxDim: number, quality: number): Promise<Blob>` (alongside the existing `compressImage`, both now sharing `computeScaledSize`), and `uploadPhoto(blob: Blob, folder: 'cats' | 'sightings'): Promise<string>` (returns a Storage download URL). Task 13 (`RecordCat.tsx`, `ReportSighting.tsx`, `Plate.tsx`) is the consumer.

- [ ] **Step 1: Extract the shared resize math and add `compressImageToBlob` in `src/ui/imageToDataUrl.ts`**

Replace the whole file with:

```ts
/* Turns an uploaded photo into a downscaled, re-encoded JPEG — as a data
   URI (compressImage, unchanged call sites: RecordCat's live preview) or
   as a Blob (compressImageToBlob, new: what data/photoUpload.ts actually
   uploads to Storage). Both share one resize calculation so "how big does
   this end up" can never drift between the two output shapes.

   ponytail: a fixed max-dimension downscale, not a real image pipeline —
   no format negotiation, no multiple sizes generated. Upgrade to a resize
   Cloud Function/extension if storage cost or quality becomes a real
   problem; out of scope while this phase avoids Cloud Functions
   entirely (design doc, "Platform").

   No check script for the browser-only pieces (FileReader, Image,
   canvas.toDataURL/toBlob have no node equivalent) — computeScaledSize is
   pure and does have one (imageToDataUrl.check.ts). Verified otherwise by
   tsc -b plus the manual gate where RecordCat.tsx first calls this. */

/** The longest edge and JPEG quality every uploaded photo is compressed to,
    matching the seeded photos' own size (data/cats.seed.ts's CATAAS
    helper). Shared by every uploader (ui/RecordCat.tsx, ui/ReportSighting.tsx,
    plate/Plate.tsx's admin sighting uploader) so a phone photo lands at the
    same size wherever it enters the survey. */
export const PHOTO_MAX_DIM = 640
export const PHOTO_QUALITY = 0.75

/** Pure: the only part of this file that can run under node. Never
    upscales a smaller image — `Math.min(1, ...)` is the whole rule. */
export function computeScaledSize(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image'))
    img.src = src
  })
}

async function drawScaled(file: File, maxDim: number): Promise<HTMLCanvasElement> {
  const raw = await readAsDataUrl(file)
  const img = await loadImage(raw)
  const { width, height } = computeScaledSize(img.width, img.height, maxDim)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not compress the image')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

/** Downscales `file` so its longest edge is at most `maxDim` pixels
    and re-encodes it as a JPEG data URI at `quality` (0-1). Rejects if
    the file cannot be read as an image at all — the caller is expected
    to catch this and show it as a form error. */
export async function compressImage(file: File, maxDim: number, quality: number): Promise<string> {
  const canvas = await drawScaled(file, maxDim)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Same downscale, encoded as a Blob instead of a data URI — what
    data/photoUpload.ts uploads to Storage. A Blob rather than converting
    an existing data URI back to one: canvas.toBlob is the direct route
    and avoids a base64-decode round trip for no reason. */
export function compressImageToBlob(file: File, maxDim: number, quality: number): Promise<Blob> {
  return drawScaled(file, maxDim).then(
    (canvas) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not compress the image'))),
          'image/jpeg',
          quality
        )
      })
  )
}
```

- [ ] **Step 2: Write `src/ui/imageToDataUrl.check.ts`**

```ts
import assert from 'node:assert/strict'
import { computeScaledSize } from './imageToDataUrl'

// Never upscales.
assert.deepEqual(computeScaledSize(200, 100, 640), { width: 200, height: 100 })

// Downscales the longest edge to maxDim, keeping aspect ratio.
assert.deepEqual(computeScaledSize(1280, 640, 640), { width: 640, height: 320 })
assert.deepEqual(computeScaledSize(640, 1280, 640), { width: 320, height: 640 })

// A square image scales both dimensions equally.
assert.deepEqual(computeScaledSize(2000, 2000, 500), { width: 500, height: 500 })

console.log('imageToDataUrl: ok')
```

- [ ] **Step 3: Add the check script to `package.json`**

```json
"check:imagesize": "tsc src/ui/imageToDataUrl.check.ts --outDir node_modules/.tmp/icheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck --rootDir src && node node_modules/.tmp/icheck/ui/imageToDataUrl.check.js"
```

- [ ] **Step 4: Run it**

Run: `cd app/front-end && npm run check:imagesize`
Expected: `imageToDataUrl: ok`

- [ ] **Step 5: Write `src/data/photoUpload.ts`**

```ts
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { storage } from '@/firebase'

/* One function, because that is everything a caller needs from Storage:
   hand it compressed bytes, get back a URL to put on a Cat or a Sighting.
   Nothing downstream (catsRepo.ts, sightings.ts) needs to know Storage
   exists at all — a photo is a URL string wherever it lands, same
   contract data/sightings.ts's own `photo` field note already promised. */

/** Uploads `blob` under `<folder>/<random id>.jpg` and returns its public
    download URL. The id is random rather than derived from the cat/
    sighting it belongs to: at upload time (RecordCat's step 0, before a
    cat exists yet) there is often no id to derive it from. */
export async function uploadPhoto(blob: Blob, folder: 'cats' | 'sightings'): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const path = `${folder}/${id}.jpg`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' })
  return getDownloadURL(storageRef)
}
```

- [ ] **Step 6: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/front-end/src/ui/imageToDataUrl.ts app/front-end/src/ui/imageToDataUrl.check.ts app/front-end/src/data/photoUpload.ts app/front-end/package.json
git commit -m "Add Storage photo upload, extract shared resize math"
```

---

### Task 5: Extract territory geometry out of `localCats.ts`

**Files:**
- Create: `app/front-end/src/data/territoryShape.ts`
- Create: `app/front-end/src/data/territoryShape.check.ts`
- Delete: `app/front-end/src/data/localCats.check.ts`
- Modify: `app/front-end/src/ui/RecordCat.tsx` (one import line)
- Modify: `app/front-end/package.json` (rename `check:localcats` to `check:territoryshape`)

Note: `localCats.ts` itself is left **completely untouched** by this task — every export it already has, geometry included, stays exactly as it is. This task only *adds* `territoryShape.ts` as a new file with copies of the geometry functions, and repoints the one caller that needs them from the new module (`RecordCat.tsx`, Step 5 below). `catsRepo.ts` keeps importing `shapeFeature`/`readStored`/`writeStored`/`slugify`/`CatDraft` from `./localCats` unchanged until Task 7 rewrites that file wholesale — so for a short window, `shapeRing`/`shapePreviewPoints`/`SHAPES`/`slugify` genuinely exist in both files. That duplication is deliberate and temporary: Task 9's precondition check (grep for any remaining `localCats` import) is what confirms it is safe to delete the original once Tasks 7 and this task's Step 5 have both moved their one caller each off it.

**Interfaces:**
- Produces: `shapeRing`, `shapePreviewPoints`, `SHAPES`, `type Shape`, `type CatDraft`, `slugify` — Task 7 (`catsRepo.ts`) and Task 13 (`RecordCat.tsx`) both import from here instead of `localCats.ts`.

- [ ] **Step 1: Write `src/data/territoryShape.ts`**

Copy `shapeRing`, `shapePreviewPoints`, `SHAPES`, `SHAPE_IDS`, `REAL_SHAPES`, `RING_STEPS`, `EARTH_RADIUS_M`, `M_PER_DEG`, `type Shape`, `slugify`, and `type CatDraft` verbatim out of `src/data/localCats.ts` (lines 29-55 for `CatDraft`, 128-324 for everything else — see that file's current content). Update the file's own header comment to describe its narrower scope:

```ts
import type { Cat } from './cats.seed'
import type { Feature, Polygon } from 'geojson'

/* Territory geometry: pure math, no storage. Split out of localCats.ts
   when that file's storage half moved to Firestore (Phase 9) — this half
   has no reason to move anywhere, since drawing a shape was never
   localStorage-specific to begin with. Everything below is unchanged from
   its original localCats.ts form. */

export type CatDraft = {
  name: string
  description: string
  note: string
  photo: string
  line: string
  colour: Cat['colour']
  shape: Shape
  extraPhotos: string[]
  center: [number, number]
  radiusM: number
  /** The signed-in admin recording this cat (Phase 9). Every extra photo
      becomes its own admin sighting (catsRepo.addCat), which needs an
      author the same way any other sighting does. */
  authorUid: string
}

export type Shape = 'round' | 'elongated' | 'notched' | 'blocky' | 'ragged'

export const SHAPES: { id: Shape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'elongated', label: 'Elongated' },
  { id: 'notched', label: 'Notched' },
  { id: 'blocky', label: 'Blocky' },
  { id: 'ragged', label: 'Ragged' },
]

const EARTH_RADIUS_M = 6371008.8
const M_PER_DEG = (Math.PI * EARTH_RADIUS_M) / 180
const RING_STEPS = 48

const REAL_SHAPES: Record<Exclude<Shape, 'round'>, number[]> = {
  elongated: [
    0.907, 0.952, 1.001, 1.044, 1.061, 1.071, 1.072, 1.057, 1.048, 1.042, 1.04, 1.013, 0.972, 0.95,
    0.956, 0.986, 1.004, 1.018, 1.026, 0.991, 0.951, 0.914, 0.971, 1.025, 1.047, 1.055, 1.079, 1.128,
    1.053, 0.998, 0.975, 1.025, 1.039, 1.009, 0.956, 0.911, 0.878, 0.934, 0.996, 1.053, 1.018, 0.989,
    0.984, 0.979, 0.973, 0.965, 0.955, 0.932,
  ],
  notched: [
    1.019, 1.105, 1.124, 1.084, 0.995, 0.953, 0.948, 1.007, 1.002, 0.958, 0.889, 0.901, 0.968, 0.995,
    0.97, 0.894, 0.91, 0.962, 1.055, 1.068, 1.08, 1.098, 1.136, 1.137, 1.095, 1.06, 1.004, 0.93, 0.9,
    0.893, 0.907, 0.98, 1.049, 1.109, 1.023, 0.975, 0.967, 0.949, 0.926, 0.897, 0.947, 0.999, 1.04,
    1.042, 1.033, 1.015, 0.982, 0.981,
  ],
  blocky: [
    1.028, 1.04, 1.048, 1.035, 0.946, 0.903, 0.931, 0.955, 0.978, 1, 1.015, 0.999, 0.946, 0.971,
    0.983, 0.963, 0.945, 0.967, 1.046, 1.019, 0.998, 0.991, 1.052, 1.038, 0.969, 0.908, 0.949, 1.029,
    1.09, 1.068, 1.013, 0.955, 0.93, 0.93, 0.986, 1.03, 1.057, 0.974, 0.944, 0.966, 1.073, 1.124,
    1.083, 1.004, 0.965, 1.013, 1.064, 1.078,
  ],
  ragged: [
    1.058, 0.999, 0.96, 0.946, 1.013, 1.066, 1.102, 1.034, 0.995, 0.981, 0.998, 0.985, 0.942, 1.01,
    1.051, 1.049, 0.995, 0.942, 0.899, 0.87, 0.895, 0.998, 1.101, 1.116, 1.033, 0.982, 0.964, 0.975,
    1.029, 1.039, 1.024, 1.002, 0.993, 0.988, 0.959, 0.998, 1.081, 1.04, 0.995, 0.945, 0.932, 0.946,
    0.994, 1.068, 1.076, 0.984, 0.962, 0.985,
  ],
}

export function shapeRing(shape: Shape, center: [number, number], radiusM: number): [number, number][] {
  const [lng, lat] = center
  const dLat = radiusM / M_PER_DEG
  const dLng = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  const round = (n: number) => Math.round(n * 1e6) / 1e6

  const ring: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    const scale = shape === 'round' ? 1 : REAL_SHAPES[shape][i]
    ring.push([
      round(lng + dLng * Math.cos(angle) * scale),
      round(lat + dLat * Math.sin(angle) * scale),
    ])
  }
  ring.push(ring[0])
  return ring
}

export function shapePreviewPoints(shape: Shape): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    const scale = shape === 'round' ? 1 : REAL_SHAPES[shape][i]
    points.push([Math.cos(angle) * scale, Math.sin(angle) * scale])
  }
  return points
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `cat-${Date.now().toString(36)}`
}
```

(`Feature`/`Polygon` import and `shapeFeature` are **not** ported — that function built a `Feature<Polygon>` for the old `listTerritories()`'s per-render recompute. Task 7's Firestore version stores the resolved ring directly on the cat doc and builds the `Feature` inline there instead; see Task 7 Step 3.)

- [ ] **Step 2: Write `src/data/territoryShape.check.ts`**

Port the geometry assertions from `src/data/localCats.check.ts` (its `round` radius check, ring-closure check, non-circle spread check, determinism check — everything except the `isStored`-related assertions at the bottom, which no longer apply):

```ts
import assert from 'node:assert/strict'
import { distanceM } from './sightings'
import { shapeRing, type Shape } from './territoryShape'

const CENTER: [number, number] = [121.05, 14.55]
const RADIUS = 90

const round = shapeRing('round', CENTER, RADIUS)
for (const point of round) {
  const d = distanceM(CENTER, point)
  assert.ok(Math.abs(d - RADIUS) < 0.2, `round shape point drifted ${d}m from a ${RADIUS}m radius`)
}

for (const shape of ['round', 'elongated', 'notched', 'blocky', 'ragged'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  assert.deepEqual(ring[0], ring[ring.length - 1], `${shape} ring does not close`)
  assert.equal(ring.length, 49, `${shape} ring should have 48 steps plus the closing point`)
}

for (const shape of ['elongated', 'notched', 'blocky', 'ragged'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  const distances = ring.map((point) => distanceM(CENTER, point))
  const spread = Math.max(...distances) - Math.min(...distances)
  assert.ok(spread > RADIUS * 0.15, `${shape} is too close to a plain circle (spread ${spread}m)`)
  assert.ok(Math.min(...distances) > 0, `${shape} produced a point on top of its own centre`)
}

assert.deepEqual(
  shapeRing('notched', CENTER, RADIUS),
  shapeRing('notched', CENTER, RADIUS),
  'shapeRing is not deterministic'
)

console.log('territoryShape: ok')
```

- [ ] **Step 3: Delete `src/data/localCats.check.ts`**

- [ ] **Step 4: Update `package.json`'s check script**

Replace:
```json
"check:localcats": "tsc src/data/localCats.check.ts --outDir node_modules/.tmp/lcheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck --resolveJsonModule && node node_modules/.tmp/lcheck/data/localCats.check.js",
```
with:
```json
"check:territoryshape": "tsc src/data/territoryShape.check.ts --outDir node_modules/.tmp/tscheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck --resolveJsonModule && node node_modules/.tmp/tscheck/data/territoryShape.check.js",
```

- [ ] **Step 5: Update `src/ui/RecordCat.tsx`'s import**

Change line 20 from:
```ts
import { SHAPES, shapePreviewPoints, shapeRing, type Shape } from '@/data/localCats'
```
to:
```ts
import { SHAPES, shapePreviewPoints, shapeRing, type Shape } from '@/data/territoryShape'
```

- [ ] **Step 6: Run the new check and typecheck**

Run: `cd app/front-end && npm run check:territoryshape && npx tsc -b`
Expected: `territoryShape: ok`, then no typecheck errors.

- [ ] **Step 7: Commit**

```bash
git add app/front-end/src/data/territoryShape.ts app/front-end/src/data/territoryShape.check.ts app/front-end/src/data/localCats.check.ts app/front-end/src/ui/RecordCat.tsx app/front-end/package.json
git commit -m "Extract territory geometry out of localCats.ts into territoryShape.ts"
```

---

### Task 6: `sightings.ts` — Firestore storage primitives

**Files:**
- Modify: `app/front-end/src/data/sightings.ts`
- Modify: `app/front-end/src/data/sightings.check.ts`

**Interfaces:**
- Consumes: `db` from `@/firebase` (Task 1), `applyVote` (unchanged, already in this file).
- Produces (all `async` now, signatures below are what Task 8's `catsRepo.ts` rewrite calls):
  - `listAllSightings(): Promise<Sighting[]>`
  - `addSighting(catId: string, point: [number, number], at: number, authorUid: string, photo?: string): Promise<Sighting | null>`
  - `addAdminSighting(catId: string, point: [number, number], at: number, photo: string, order: number, authorUid: string): Promise<Sighting | null>`
  - `removeSighting(id: string): Promise<boolean>`
  - `deleteSighting(id: string): Promise<boolean>`
  - `reorderSighting(catId: string, id: string, direction: 'up' | 'down'): Promise<boolean>`
  - `reviewSighting(id: string, verdict: 'surveyed' | 'discarded'): Promise<boolean>`
  - `voteSighting(id: string, uid: string, direction: 'up' | 'down'): Promise<boolean>`
  - `myVoteFor(sightingId: string, uid: string): Promise<'up' | 'down' | undefined>`
  - Unchanged, still pure: `isSurveyed`, `sortForDisplay`, `applyVote`, `distanceM`, `ringRadiusM`, `translateToward`, `describeWhen`, `pendingByCat` (now always takes an explicit list — its default-arg convenience, `= allSightings()`, is removed along with `allSightings`), `latestByCat` (same removed default).
  - Changed but still pure: `isOwnPending`, simplified from `(sighting, own: Sighting[])` to `(sighting, uid: string | null)` — "mine" is now an account fact (`sighting.authorUid === uid`), not a scan over this browser's own localStorage list. Still exported: `map/Territories.tsx` calls it directly and synchronously (see Task 12), which is exactly why this predicate lives in `sightings.ts` and not in `catsRepo.ts` — unchanged reasoning, only the ownership test underneath it changed.
  - Removed (no longer meaningful with nothing left to read synchronously from localStorage): `readSightings`, the whole seeded/overlay block (`SEEDED`, `CENTRES`, `OVERLAY_KEY`), `buildAdminSighting`'s pure/impure split (collapses into one `addAdminSighting`).

- [ ] **Step 1: Replace the storage half of `src/data/sightings.ts`**

Keep the file's top matter (`Sighting` type, `SightingStatus`, `isSighting` — actually `isSighting`/`isState`-style validation is no longer needed either, since Firestore documents aren't a string a user can hand-edit the way `localStorage` was; a malformed document can only get there through this file's own writes, which are already typed). Keep `isSurveyed`, `sortForDisplay`, `applyVote`, `distanceM`, `ringRadiusM`, `translateToward`, `describeWhen`, `PendingSummary`, `latestByCat` unchanged. Replace everything else:

```ts
import type { Feature, Polygon } from 'geojson'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { ringCentroid } from '../map/centroid'

/* Sightings: "I saw this cat here" — see the file's own top-of-file note
   (unchanged) for why this is a sighting rather than an edit.

   Phase 9: the storage half moves from localStorage to Firestore's
   `sightings` collection. Every sighting now carries `authorUid`, which is
   what "mine" (withdraw, and the plate's own pending-lock) means from here
   on — no more "this browser's own", since everyone signs in to report
   (design doc, "Auth"). The pure predicate/geometry functions below this
   point are untouched: only what reads and writes them changed. */

export type SightingStatus = 'pending' | 'surveyed' | 'discarded'

export type Sighting = {
  id: string
  catId: string
  point: [number, number]
  status: SightingStatus
  at: number
  photo?: string
  order?: number
  authorUid: string
  /** This viewer's own vote on a pending sighting, joined in per-request
      from the sightings/{id}/votes/{myUid} subdocument (see myVoteFor) —
      no longer stored on the sighting itself, since "mine" now spans
      every viewer, not one browser (Sighting.votes's old note explains
      why a shared field can't hold a personal fact). */
  myVote?: 'up' | 'down'
  votes?: { up: number; down: number }
}

const COLLECTION = 'sightings'

function fromDoc(id: string, data: Record<string, unknown>): Sighting {
  return {
    id,
    catId: data.catId as string,
    point: data.point as [number, number],
    status: data.status as SightingStatus,
    at: data.at as number,
    photo: data.photo as string | undefined,
    order: data.order as number | undefined,
    authorUid: data.authorUid as string,
    votes: data.votes as { up: number; down: number } | undefined,
  }
}

/** Every sighting the survey has ever recorded. Callers filter it down
    (published, pending, one cat's log) the same way every filter in this
    app already worked before phase 9 — only the source changed. */
export async function listAllSightings(): Promise<Sighting[]> {
  const snap = await getDocs(collection(db, COLLECTION))
  return snap.docs.map((d) => fromDoc(d.id, d.data()))
}

/* --- The review policy (unchanged) -------------------------------------
   Published: what everybody is allowed to see. */
export function isSurveyed(sighting: Sighting): boolean {
  return sighting.status === 'surveyed'
}

/** A visitor's report. Lands `pending`. */
export async function addSighting(
  catId: string,
  point: [number, number],
  at: number,
  authorUid: string,
  photo?: string
): Promise<Sighting | null> {
  try {
    const ref = doc(collection(db, COLLECTION))
    const data = { catId, point, status: 'pending' as const, at, authorUid, ...(photo ? { photo } : {}) }
    await setDoc(ref, data)
    return fromDoc(ref.id, data)
  } catch {
    return null
  }
}

/** An admin's own sighting, `surveyed` outright — same trust level as the
    cat record itself (see the equivalent note this replaced in the old
    buildAdminSighting). `order` lets several bootstrap photos stack in
    upload sequence, ascending, lower shows first. */
export async function addAdminSighting(
  catId: string,
  point: [number, number],
  at: number,
  photo: string,
  order: number,
  authorUid: string
): Promise<Sighting | null> {
  try {
    const ref = doc(collection(db, COLLECTION))
    const data = { catId, point, status: 'surveyed' as const, at, photo, order, authorUid }
    await setDoc(ref, data)
    return fromDoc(ref.id, data)
  } catch {
    return null
  }
}

/** Undo/withdraw: deletes outright, same reasoning as before phase 9 —
    nothing was published and no decision was made. Security rules are the
    real guard on "only your own, only while pending"; this still checks
    first so a caller gets `false` rather than a thrown permission error. */
export async function removeSighting(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION, id))
    return true
  } catch {
    return false
  }
}

/** An admin's housekeeping on the log itself: any record, any status,
    gone for good. Distinct from removeSighting above only by who is
    allowed to call it — firestore.rules enforces that distinction, this
    function is the same delete either way. */
export async function deleteSighting(id: string): Promise<boolean> {
  return removeSighting(id)
}

async function setOrder(id: string, order: number): Promise<boolean> {
  try {
    await updateDoc(doc(db, COLLECTION, id), { order })
    return true
  } catch {
    return false
  }
}

/** Swaps one sighting with whichever neighbour is currently next to it in
    `sortForDisplay`'s order, up or down — unchanged logic, now reading
    Firestore for the cat's log instead of localStorage. */
export async function reorderSighting(
  catId: string,
  id: string,
  direction: 'up' | 'down'
): Promise<boolean> {
  const snap = await getDocs(query(collection(db, COLLECTION), where('catId', '==', catId)))
  const list = sortForDisplay(snap.docs.map((d) => fromDoc(d.id, d.data())))
  const from = list.findIndex((sighting) => sighting.id === id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= list.length) return false
  const a = list[from]
  const b = list[to]
  const [okA, okB] = await Promise.all([setOrder(a.id, b.order ?? to), setOrder(b.id, a.order ?? from)])
  return okA && okB
}

/** Display order for a cat's log (unchanged). */
export function sortForDisplay(list: Sighting[]): Sighting[] {
  return [...list].sort((a, b) => {
    if (a.order !== undefined || b.order !== undefined) {
      return (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY)
    }
    return b.at - a.at
  })
}

/** An admin's verdict. */
export async function reviewSighting(id: string, verdict: 'surveyed' | 'discarded'): Promise<boolean> {
  try {
    await updateDoc(doc(db, COLLECTION, id), { status: verdict })
    return true
  } catch {
    return false
  }
}

/** The pure half of voteSighting below (unchanged from before phase 9):
    a toggle, not an add. Kept exported and pure so it stays checkable
    under node without Firestore. */
export function applyVote(
  sighting: Pick<Sighting, 'myVote' | 'votes'>,
  direction: 'up' | 'down'
): Pick<Sighting, 'myVote' | 'votes'> {
  const votes = { up: sighting.votes?.up ?? 0, down: sighting.votes?.down ?? 0 }
  if (sighting.myVote === direction) {
    votes[direction] = Math.max(0, votes[direction] - 1)
    return { votes, myVote: undefined }
  }
  if (sighting.myVote) votes[sighting.myVote] = Math.max(0, votes[sighting.myVote] - 1)
  votes[direction] += 1
  return { votes, myVote: direction }
}

/** A visitor's thumbs up/down on a pending sighting, one per uid.
    `sightings/{id}/votes/{uid}` is the durable "have I voted" fact (one
    doc, one writer, enforced by firestore.rules); `votes.up`/`votes.down`
    on the parent is the shared tally, updated in the same transaction so
    the two can never disagree. Locked to pending, same as before: a
    decided sighting has nothing left to corroborate. */
export async function voteSighting(id: string, uid: string, direction: 'up' | 'down'): Promise<boolean> {
  const sightingRef = doc(db, COLLECTION, id)
  const voteRef = doc(db, COLLECTION, id, 'votes', uid)
  try {
    await runTransaction(db, async (tx) => {
      const [sightingSnap, voteSnap] = await Promise.all([tx.get(sightingRef), tx.get(voteRef)])
      if (!sightingSnap.exists() || sightingSnap.data().status !== 'pending') {
        throw new Error('not-votable')
      }
      const prev = voteSnap.exists() ? (voteSnap.data().direction as 'up' | 'down') : undefined
      const { votes, myVote } = applyVote(
        { myVote: prev, votes: sightingSnap.data().votes },
        direction
      )
      if (myVote) tx.set(voteRef, { direction: myVote })
      else tx.delete(voteRef)
      tx.update(sightingRef, { votes })
    })
    return true
  } catch {
    return false
  }
}

/** This viewer's own vote on one sighting, read back for display (Plate.tsx
    reads `oldestPending.myVote` directly — see catsRepo.ts's
    listPendingForCat, which joins this in per sighting). */
export async function myVoteFor(sightingId: string, uid: string): Promise<'up' | 'down' | undefined> {
  const snap = await getDoc(doc(db, COLLECTION, sightingId, 'votes', uid))
  return snap.exists() ? (snap.data().direction as 'up' | 'down') : undefined
}

/** This viewer's own unreviewed submission — the one exception to
    isSurveyed below, safe for the same reason it always was: the data is
    already theirs, so showing it back tells them nothing they did not
    submit. `uid` rather than an `own: Sighting[]` scan, now that "mine"
    is an account fact instead of a browser fact (Sighting.authorUid).
    Exported and pure so both an async caller (catsRepo.listSightings)
    and a synchronous one (map/Territories.tsx, inside a MapLibre effect
    that cannot await) can apply the exact same rule to a list they
    already have in hand — see that file's own note on why this cannot
    live in catsRepo.ts alone. */
export function isOwnPending(sighting: Sighting, uid: string | null): boolean {
  return sighting.status === 'pending' && sighting.authorUid === uid
}

/** The newest sighting per cat (unchanged). */
export function latestByCat(list: Sighting[]): Map<string, Sighting> {
  const byCat = new Map<string, Sighting>()
  for (const sighting of list) {
    const current = byCat.get(sighting.catId)
    if (!current || sighting.at > current.at) byCat.set(sighting.catId, sighting)
  }
  return byCat
}

export type PendingSummary = { oldest: Sighting; count: number }

/** One cat's open review: the oldest still-pending sighting plus how many
    are waiting (unchanged). */
export function pendingByCat(list: Sighting[]): Map<string, PendingSummary> {
  const byCat = new Map<string, PendingSummary>()
  for (const sighting of list) {
    if (sighting.status !== 'pending') continue
    const current = byCat.get(sighting.catId)
    if (!current || sighting.at < current.oldest.at) {
      byCat.set(sighting.catId, { oldest: sighting, count: (current?.count ?? 0) + 1 })
    } else {
      byCat.set(sighting.catId, { oldest: current.oldest, count: current.count + 1 })
    }
  }
  return byCat
}

/* --- Geometry (unchanged) ------------------------------------------- */

const EARTH_RADIUS_M = 6371008.8
const M_PER_DEG = (Math.PI * EARTH_RADIUS_M) / 180

export function distanceM(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const dx = (b[0] - a[0]) * M_PER_DEG * Math.cos(meanLat)
  const dy = (b[1] - a[1]) * M_PER_DEG
  return Math.hypot(dx, dy)
}

export function ringRadiusM(ring: [number, number][], center: [number, number]): number {
  return ring.reduce((furthest, point) => Math.max(furthest, distanceM(center, point)), 0)
}

export function translateToward(feature: Feature<Polygon>, to: [number, number]): Feature<Polygon> {
  const ring = feature.geometry.coordinates[0] as [number, number][]
  const [cx, cy] = ringCentroid(ring)
  const dx = to[0] - cx
  const dy = to[1] - cy
  const round = (n: number) => Math.round(n * 1e6) / 1e6

  return {
    ...feature,
    geometry: {
      type: 'Polygon',
      coordinates: feature.geometry.coordinates.map((r) =>
        (r as [number, number][]).map(([x, y]) => [round(x + dx), round(y + dy)])
      ),
    },
  }
}

const TIME = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const DATE = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

export function describeWhen(at: number, now = Date.now()): string {
  const then = new Date(at)
  const today = new Date(now)
  const sameDay = then.toDateString() === today.toDateString()
  if (sameDay) return `Today, ${TIME.format(then)}`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return `Yesterday, ${TIME.format(then)}`

  return DATE.format(then)
}
```

- [ ] **Step 2: Replace `src/data/sightings.check.ts`**

The seed/territory-translation check (today's lines 39-74, "the seeded sightings sit on their own centroid so `translateToward` is a no-op on load") and the `buildAdminSighting` check (today's lines 155-176) both check things that no longer exist as pure, `node`-runnable code: seeds moved to `scripts/migrateSeed.ts` (which writes to a live/emulated Firestore, out of this file's reach), and `buildAdminSighting`'s pure half was absorbed into the now-inherently-async `addAdminSighting` (Task 6) — there is no pure remainder left to check. `pendingByCat` and `applyVote` are unchanged and their checks port over, with one fix: `pendingByCat`'s `at()` test helper must now include `authorUid`, since `Sighting` requires it.

Replace the whole file with:

```ts
import assert from 'node:assert/strict'
import { applyVote, pendingByCat, type Sighting } from './sightings'

/* Run: npm run check:sightings (no test runner in this project — see
   package.json). Phase 9 narrowed this file's scope: everything it
   checked that touched localStorage or the seeded history moved either
   to territoryShape.check.ts (the geometry) or out of node's reach
   entirely (scripts/migrateSeed.ts writes to a real/emulated Firestore,
   and Task 2's rules.test.mjs is what actually exercises Firestore
   writes under a check). What is left here is genuinely pure: no
   localStorage, no network, same as before. */

// --- pendingByCat --------------------------------------------------------
// The map's ghost (map/Territories.tsx) and pending badge (map/
// CatMarkers.tsx) both anchor to whichever sighting this function calls
// "oldest", and the plate's own count next to "Pending review" is this
// function's `count`. Get either one wrong and the map and the plate can
// point at different reports for the same cat.

const at = (id: string, catId: string, status: Sighting['status'], atMs: number): Sighting => ({
  id,
  catId,
  point: [121.05, 14.55],
  at: atMs,
  status,
  authorUid: 'test-uid',
})

const p1 = at('p1', 'milo', 'pending', 300)
const p2 = at('p2', 'milo', 'pending', 100) // oldest of the two on milo
const p3 = at('p3', 'milo', 'pending', 200)
const done = at('d1', 'milo', 'surveyed', 50)
const other = at('p4', 'biscuit', 'pending', 10)

const summary = pendingByCat([p1, p2, p3, done, other])

assert.equal(summary.get('milo')?.oldest.id, 'p2', 'the oldest pending sighting did not win the anchor')
assert.equal(summary.get('milo')?.count, 3, 'pendingByCat miscounted a cat with three open reports')
assert.equal(summary.get('biscuit')?.count, 1, 'a different cat’s own pending report was not counted')
assert.equal(summary.has('nobody'), false, 'a cat with nothing pending should not appear at all')

assert.equal(pendingByCat([done]).size, 0, 'a surveyed sighting was counted as pending')

console.log('pendingByCat: ok')

// --- applyVote -------------------------------------------------------------
// The pure half of voteSighting, checked directly because voteSighting
// itself needs a live/emulated Firestore transaction (Task 2 covers the
// rules; this stays a plain node check of the arithmetic alone).

const fresh = applyVote({}, 'up')
assert.deepEqual(fresh, { votes: { up: 1, down: 0 }, myVote: 'up' }, 'a first vote did not register')

const toggledOff = applyVote(fresh, 'up')
assert.deepEqual(
  toggledOff,
  { votes: { up: 0, down: 0 }, myVote: undefined },
  'pressing the same thumb twice should withdraw the vote, not double it'
)

const switched = applyVote(fresh, 'down')
assert.deepEqual(
  switched,
  { votes: { up: 0, down: 1 }, myVote: 'down' },
  'switching thumbs did not move the vote off the first one'
)

const corrupt = applyVote({ votes: { up: 0, down: 0 }, myVote: 'up' }, 'up')
assert.equal(corrupt.votes?.up, 0, 'withdrawing a vote from an already-zeroed tally went negative')

console.log('applyVote: ok')

console.log('sightings: ok')
```

- [ ] **Step 3: Run the sightings check in isolation, expect (and confirm) project-wide typecheck errors elsewhere**

Run: `cd app/front-end && npm run check:sightings`
Expected: `sightings: ok` — this script compiles only `sightings.check.ts` and its imports, so it is unaffected by anything else in the project being mid-migration.

Run: `npx tsc -b`
Expected: errors in `catsRepo.ts` (still on its pre-Task-7 content, importing `allSightings`/`readSightings`/the old `isOwnPending` shape this task just removed or changed) and in `map/Territories.tsx`, `map/CatMarkers.tsx`, `ui/About.tsx`, `data/review.check.ts` (same reason — see Task 12's header note). Confirm the errors are all import/signature mismatches in exactly those five files, not something inside `sightings.ts` itself — this task is not done until `sightings.ts` compiles standalone with zero errors of its own.

- [ ] **Step 4: Commit**

```bash
git add app/front-end/src/data/sightings.ts app/front-end/src/data/sightings.check.ts
git commit -m "Move sightings.ts storage from localStorage to Firestore"
```

---

### Task 7: `catsRepo.ts` — cats collection

**Files:**
- Modify: `app/front-end/src/data/catsRepo.ts`

**Interfaces:**
- Consumes: `db` from `@/firebase` (Task 1); `shapeRing`, `type CatDraft`, `type Shape`, `slugify` from `@/data/territoryShape` (Task 5).
- Produces (signatures unchanged from today, so `App.tsx`, `Landing.tsx`, `RecordCat.tsx`, `Plate.tsx`, `ReviewQueue.tsx`, `Rail.tsx`, `CatDeck.tsx` need no changes for these): `listCats(): Promise<Cat[]>`, `getCat(id): Promise<Cat | null>`, `listTerritories(): Promise<FeatureCollection<Polygon>>`, `countRecorded(): Promise<number>` (was sync — see note below), `addCat(draft): Promise<Cat | null>`, `clearRecorded(): Promise<boolean>` (was sync), `updateCat(id, patch): Promise<boolean>`, `deleteCat(id): Promise<boolean>`.

This task only touches the cat-facing half of `catsRepo.ts` (the functions listed above). The sighting-facing half (`listSightings`, `listPending`, etc.) is Task 8.

Note: `countRecorded` and `clearRecorded` become `async` — they were the two functions in this file that were never awaited by their callers (`RecordCat.tsx`'s `setRecorded(countRecorded())` and its `onClick={() => { clearRecorded(); ... }}`). Task 13 updates those two call sites to `await` them.

- [ ] **Step 1: Replace imports at the top of `src/data/catsRepo.ts`**

```ts
import type { FeatureCollection, Polygon } from 'geojson'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '@/firebase'
import type { Cat } from './cats.seed'
import { shapeRing, slugify, type CatDraft, type Shape } from './territoryShape'
import {
  addAdminSighting,
  deleteSighting as removeAnySighting,
  describeWhen,
  isOwnPending,
  isSurveyed,
  latestByCat,
  listAllSightings,
  myVoteFor,
  removeSighting,
  reorderSighting as reorder,
  reviewSighting as review,
  sortForDisplay,
  translateToward,
  voteSighting as vote,
  type Sighting,
} from './sightings'
```

- [ ] **Step 2: Replace the cat-facing functions**

Replace `listCats`, `getCat`, `countRecorded`, `nextLineNumber`, `formatCoordinates`, `addCat`, `clearRecorded`, `CatPatch`, `CLEARABLE`, `cleanPatch`, `updateCat`, `deleteCat`, and the module-level `CAT_OVERLAY` constant (all deleted — no overlay in the Firestore model) with:

```ts
const COLLECTION = 'cats'

/** A Firestore cats/{id} document: everything on Cat except `id` (the doc
    id already is it) and `lastSeen` (derived — see below), plus the
    resolved territory ring. Storing the ring pre-computed rather than
    center/radiusM/shape is what lets a seeded cat (an arbitrary hand-drawn
    polygon from territories.geo.json, not expressible as a warped circle)
    and an admin-recorded cat (built by shapeRing) live in the same shape:
    listTerritories reads `territory` off every doc identically, with no
    branch on where the cat came from. */
type CatDoc = Omit<Cat, 'id' | 'lastSeen'> & {
  lastSeen?: string
  territory: [number, number][]
}

function catFromDoc(id: string, data: CatDoc): Omit<Cat, 'lastSeen'> & { lastSeen?: string } {
  const { territory: _territory, ...rest } = data
  return { id, ...rest }
}

async function surveyedSightings(): Promise<Sighting[]> {
  return (await listAllSightings()).filter(isSurveyed)
}

export async function listCats(): Promise<Cat[]> {
  const [snap, sightings] = await Promise.all([getDocs(collection(db, COLLECTION)), surveyedSightings()])
  /* Surveyed only — see the equivalent note this replaced in the pre-
     Firestore version: an unreviewed report must never print "Last seen:
     Today" on the public record. */
  const seen = latestByCat(sightings)
  return snap.docs.map((docSnap) => {
    const cat = catFromDoc(docSnap.id, docSnap.data() as CatDoc)
    const sighting = seen.get(cat.id)
    /* `cat.lastSeen` is only ever present when an admin explicitly set it
       (updateCat below) — listCats never writes it. That absence-by-
       default is what lets the derived value win when there is no
       override and the admin's correction win when there is one, the
       same precedence the old overlay-applied-after-derivation gave. */
    return { ...cat, lastSeen: cat.lastSeen ?? (sighting ? describeWhen(sighting.at) : undefined) }
  })
}

export async function getCat(id: string): Promise<Cat | null> {
  return (await listCats()).find((cat) => cat.id === id) ?? null
}

export async function countRecorded(): Promise<number> {
  const snap = await getDocs(collection(db, COLLECTION))
  return snap.size
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

function formatCoordinates([lng, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${
    lng >= 0 ? 'E' : 'W'
  }`
}

/** One higher than every survey-line number already on record (unchanged
    logic; reads the live `cats` collection instead of `[...CATS, ...stored]`). */
function nextLineNumber(cats: { line: string }[]): number {
  const max = cats.reduce((n, cat) => {
    const match = /^LINE (\d+)/.exec(cat.line)
    return match ? Math.max(n, Number(match[1])) : n
  }, 0)
  return max + 1
}

export async function addCat(draft: CatDraft): Promise<Cat | null> {
  const name = draft.name.trim()
  if (!name) return null

  const snap = await getDocs(collection(db, COLLECTION))
  const existing = snap.docs.map((d) => ({ id: d.id, ...(d.data() as CatDoc) }))
  const taken = new Set(existing.map((cat) => cat.id))

  const base = slugify(name)
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const catData: CatDoc = {
    name: name.toUpperCase(),
    plate: `PLATE ${String(existing.length + 1).padStart(2, '0')}`,
    line: `LINE ${String(nextLineNumber(existing)).padStart(2, '0')} · ${draft.line.trim() || 'FIELD ENTRY'}`,
    colour: draft.colour,
    description: draft.description.trim(),
    firstRecorded: MONTH.format(new Date()),
    range: `About ${Math.round(draft.radiusM * 2)} m across, centred on the recorded point`,
    disposition: 'Not yet observed',
    note: draft.note.trim() || undefined,
    coordinates: formatCoordinates(draft.center),
    photo: draft.photo.trim(),
    territory: shapeRing(draft.shape, draft.center, draft.radiusM),
  }

  try {
    await setDoc(doc(db, COLLECTION, id), catData)
  } catch {
    return null
  }

  /* Every extra photo becomes its own surveyed sighting, same as before —
     `draft.extraPhotos` already carries Storage URLs by the time this
     runs (ui/RecordCat.tsx's pickExtraPhotos uploads them at pick time,
     see Task 13), so this is just attaching them, not compressing them. */
  const now = Date.now()
  await Promise.all(
    draft.extraPhotos.map((photo, index) => addAdminSighting(id, draft.center, now, photo, index, draft.authorUid))
  )

  // `territory` is Firestore-only — a Cat has never carried its own ring
  // (it is re-derived from listTerritories at read time), so it is
  // stripped here rather than spread into the returned Cat, which would
  // otherwise fail the excess-property check on this function's Promise<Cat | null> return type.
  const { territory: _territory, ...catFields } = catData
  return { id, ...catFields }
}

export async function clearRecorded(): Promise<boolean> {
  const snap = await getDocs(collection(db, COLLECTION))
  try {
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
    return true
  } catch {
    return false
  }
}

export type CatPatch = Partial<
  Pick<Cat, 'name' | 'description' | 'note' | 'photo' | 'line' | 'colour' | 'disposition' | 'firstRecorded' | 'lastSeen'>
>

const CLEARABLE = new Set<keyof CatPatch>(['note', 'lastSeen'])

function cleanPatch(patch: CatPatch): Record<string, string | ReturnType<typeof deleteField>> | null {
  const clean: Record<string, string | ReturnType<typeof deleteField>> = {}
  for (const [key, raw] of Object.entries(patch)) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value) {
      clean[key] = value
      continue
    }
    if (!CLEARABLE.has(key as keyof CatPatch)) return null
    clean[key] = deleteField()
  }
  return clean
}

export async function updateCat(id: string, patch: CatPatch): Promise<boolean> {
  const clean = cleanPatch(patch)
  if (!clean) return false
  try {
    await updateDoc(doc(db, COLLECTION, id), clean)
    return true
  } catch {
    return false
  }
}

export async function deleteCat(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION, id))
    return true
  } catch {
    return false
  }
}
```

(`CatDraft` gains an `authorUid` field in Task 13, threaded from the signed-in admin recording the cat — see that task's `RecordCat.tsx` change. Note that above, `addCat` uses `draft.authorUid` when attaching extra photos.)

- [ ] **Step 3: Replace `listTerritories`**

```ts
export async function listTerritories(): Promise<FeatureCollection<Polygon>> {
  const [snap, sightings] = await Promise.all([getDocs(collection(db, COLLECTION)), surveyedSightings()])
  const seen = latestByCat(sightings)
  return {
    type: 'FeatureCollection',
    features: snap.docs.map((docSnap) => {
      const data = docSnap.data() as CatDoc
      const feature: FeatureCollection<Polygon>['features'][number] = {
        type: 'Feature',
        properties: { id: docSnap.id, name: data.name },
        geometry: { type: 'Polygon', coordinates: [data.territory] },
      }
      const sighting = seen.get(docSnap.id)
      return sighting ? translateToward(feature, sighting.point) : feature
    }),
  }
}
```

- [ ] **Step 4: Leave the sighting-facing functions as placeholders for Task 8**

The functions `listSightings`, `listPending`, `listReviewed`, `reviewSighting`, `withdrawSighting`, `deleteSighting`, `reorderSighting`, `listPendingForCat`, `voteSighting`, `addAdminPhoto` still reference the old, now-deleted `allSightings`/`isOwnPending` from `sightings.ts`. This will not typecheck until Task 8. That is expected — Task 8 is the very next task and finishes the same file. Do not attempt to make this task typecheck in isolation; run `git status` to confirm only the intended cat-facing functions changed, then proceed directly to Task 8 before committing either.

---

### Task 8: `catsRepo.ts` — sighting-facing functions

**Files:**
- Modify: `app/front-end/src/data/catsRepo.ts` (continues directly from Task 7 — commit together)

**Interfaces:**
- Produces (signatures unchanged from today): `listSightings(catId): Promise<Sighting[]>`, `listPending(): Promise<Sighting[]>`, `listReviewed(): Promise<Sighting[]>`, `reviewSighting(id, verdict): Promise<boolean>`, `withdrawSighting(id, uid): Promise<boolean>` (gains a `uid` parameter — see Task 13's `Plate.tsx` call site), `deleteSighting(id): Promise<boolean>`, `reorderSighting(catId, id, direction): Promise<boolean>`, `listPendingForCat(catId, uid): Promise<Sighting[]>` (gains `uid`, to join in `myVote`), `voteSighting(id, uid, direction): Promise<boolean>` (gains `uid`), `addAdminPhoto(catId, point, photo, authorUid): Promise<boolean>` (gains `authorUid`).

- [ ] **Step 1: Replace the sighting-facing functions in `src/data/catsRepo.ts`**

```ts
export async function listSightings(catId: string, uid: string | null): Promise<Sighting[]> {
  const list = (await listAllSightings())
    .filter((sighting) => sighting.catId === catId)
    .filter((sighting) => isSurveyed(sighting) || isOwnPending(sighting, uid))
  return sortForDisplay(list)
}

export async function listPending(): Promise<Sighting[]> {
  return (await listAllSightings())
    .filter((sighting) => sighting.status === 'pending')
    .sort((a, b) => a.at - b.at)
}

export async function listReviewed(): Promise<Sighting[]> {
  return (await listAllSightings())
    .filter((sighting) => sighting.status !== 'pending')
    .sort((a, b) => b.at - a.at)
}

export async function reviewSighting(id: string, verdict: 'surveyed' | 'discarded'): Promise<boolean> {
  return review(id, verdict)
}

/** A visitor taking back their own unreviewed report. `uid` is checked
    here as well as by firestore.rules — belt and suspenders, same as the
    pre-Firestore version checked its own storage before trusting the
    caller. */
export async function withdrawSighting(id: string, uid: string): Promise<boolean> {
  const all = await listAllSightings()
  const mine = all.find((sighting) => sighting.id === id)
  if (!mine || mine.status !== 'pending' || mine.authorUid !== uid) return false
  return removeSighting(id)
}

export async function deleteSighting(id: string): Promise<boolean> {
  return removeAnySighting(id)
}

export async function reorderSighting(catId: string, id: string, direction: 'up' | 'down'): Promise<boolean> {
  return reorder(catId, id, direction)
}

export async function listPendingForCat(catId: string, uid: string | null): Promise<Sighting[]> {
  const pending = (await listAllSightings())
    .filter((sighting) => sighting.catId === catId && sighting.status === 'pending')
    .sort((a, b) => a.at - b.at)
  if (!uid) return pending
  /* Join in this viewer's own vote per sighting. A handful of extra reads
     at most — a cat rarely has more than one or two open reports at once
     (catsRepo.addSighting locks the report button once one exists) — so
     one getDoc per pending row is the right size of solution here rather
     than a batched query for a list this short. */
  return Promise.all(
    pending.map(async (sighting) => ({ ...sighting, myVote: await myVoteFor(sighting.id, uid) }))
  )
}

export async function voteSighting(id: string, uid: string, direction: 'up' | 'down'): Promise<boolean> {
  return vote(id, uid, direction)
}

export async function addAdminPhoto(
  catId: string,
  point: [number, number],
  photo: string,
  authorUid: string
): Promise<boolean> {
  return !!(await addAdminSighting(catId, point, Date.now(), photo, 0, authorUid))
}

export type { Cat, CatDraft, Sighting }
```

(`addSighting` itself — a visitor's report — is not re-exported from `catsRepo.ts` today either; `ui/ReportSighting.tsx` imports it directly from `@/data/sightings`. Task 13 updates that one call site to pass `authorUid`.)

- [ ] **Step 2: Typecheck the whole file**

Run: `cd app/front-end && npx tsc -b`
Expected: errors only in files this plan has not yet touched: `App.tsx`, `Landing.tsx`, `RecordCat.tsx`, `ReportSighting.tsx`, `Plate.tsx` (call sites now passing the wrong number of arguments to `withdrawSighting`/`voteSighting`/`listPendingForCat`/`addAdminPhoto`/`countRecorded`/`clearRecorded`, fixed by Tasks 11 and 13) and `map/Territories.tsx`, `map/CatMarkers.tsx`, `ui/About.tsx`, `data/review.check.ts` (all four import functions Task 6 removed — `allSightings`, `readSightings`, or the old two-array `isOwnPending` signature — fixed by Task 12). Confirm the error list is confined to those nine files — if `catsRepo.ts` or `sightings.ts` themselves show an error, fix it before moving on.

- [ ] **Step 3: Commit Tasks 7 and 8 together**

```bash
git add app/front-end/src/data/catsRepo.ts
git commit -m "Move catsRepo.ts from localStorage/overlay to Firestore"
```

---

### Task 9: Delete `localCats.ts` and `overlay.ts`

**Files:**
- Delete: `app/front-end/src/data/localCats.ts`
- Delete: `app/front-end/src/data/overlay.ts`

**Interfaces:** none — this task only removes now-dead code. Nothing after Task 8 imports from either file.

- [ ] **Step 1: Confirm nothing still imports them**

Run: `grep -rn "from '@/data/localCats'\|from './localCats'\|from '@/data/overlay'\|from './overlay'" app/front-end/src`
Expected: no output. If anything shows up, it is a call site this plan missed in an earlier task — go fix that task's file before deleting.

- [ ] **Step 2: Delete both files**

```bash
rm app/front-end/src/data/localCats.ts app/front-end/src/data/overlay.ts
```

- [ ] **Step 3: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: the same error set as Task 8 Step 2 (unchanged by this deletion — those errors are all in files Tasks 11-12 haven't touched yet).

- [ ] **Step 4: Commit**

```bash
git add -u app/front-end/src/data/localCats.ts app/front-end/src/data/overlay.ts
git commit -m "Delete localCats.ts and overlay.ts, superseded by Firestore"
```

---

### Task 10: One-time seed migration script

**Files:**
- Create: `app/front-end/scripts/migrateSeed.ts`
- Modify: `app/front-end/package.json` (add `firebase-admin` dev dep, `seed:firebase` script)

**Interfaces:** none consumed from earlier tasks' exports (deliberately — this script uses `firebase-admin`, a server-side SDK, and writes directly to Firestore/Storage rather than going through `catsRepo.ts`, the same way a real one-off migration would). It reads `CATS` from `src/data/cats.seed.ts` and `territories.geo.json`, both already in the repo.

- [ ] **Step 1: Install `firebase-admin`**

Run (from `app/front-end/`): `npm install -D firebase-admin`

- [ ] **Step 2: Write `scripts/migrateSeed.ts`**

```ts
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { CATS } from '../src/data/cats.seed'

/* One-time push of the twelve seed cats and their sighting history into a
   real Firestore project. Run once, by hand, after Task 2's rules are
   deployed: `npm run seed:firebase`.

   Needs a service account key: Firebase console -> Project settings ->
   Service accounts -> Generate new private key. Save it outside the repo
   (it is a real credential) and point GOOGLE_APPLICATION_CREDENTIALS at
   it:

     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run seed:firebase

   firebase-admin is a devDependency, not a dependency: it never ships to
   the browser bundle, only runs here under node. */

const territories = JSON.parse(
  readFileSync(new URL('../src/data/territories.geo.json', import.meta.url), 'utf8')
) as { features: { properties: { id: string }; geometry: { coordinates: [number, number][][] } }[] }

const DAY = 24 * 60 * 60 * 1000
const CAT_PHOTO = (id: string, w: number, h: number) => `https://cataas.com/cat/${id}?width=${w}&height=${h}`

/* Same seeded observation history the old data/sightings.ts SEEDS array
   held, carried over here since that array's only remaining purpose is
   this one-time write — sightings.ts itself has no seed data any more
   after Task 6. */
const SEED_SIGHTINGS: { catId: string; daysAgo: number; photo?: string }[] = [
  { catId: 'milo', daysAgo: 0.3, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 640, 480) },
  { catId: 'milo', daysAgo: 2, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 600, 450) },
  { catId: 'milo', daysAgo: 9, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 560, 420) },
  { catId: 'milo', daysAgo: 26, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 520, 390) },
  { catId: 'biscuit', daysAgo: 1.5, photo: CAT_PHOTO('05Xd4JtN14983pns', 640, 480) },
  { catId: 'biscuit', daysAgo: 6 },
  { catId: 'biscuit', daysAgo: 20, photo: CAT_PHOTO('05Xd4JtN14983pns', 560, 420) },
  { catId: 'tala', daysAgo: 0.8, photo: CAT_PHOTO('09wFxpacQzvf9jfM', 640, 480) },
  { catId: 'tala', daysAgo: 4, photo: CAT_PHOTO('09wFxpacQzvf9jfM', 600, 450) },
  { catId: 'tala', daysAgo: 15, photo: CAT_PHOTO('09wFxpacQzvf9jfM', 520, 390) },
  { catId: 'pandan', daysAgo: 1.1, photo: CAT_PHOTO('0B2g7aTANObiqPJJ', 640, 480) },
  { catId: 'pandan', daysAgo: 12, photo: CAT_PHOTO('0B2g7aTANObiqPJJ', 560, 420) },
  { catId: 'ube', daysAgo: 0.6, photo: CAT_PHOTO('0BTTVEVWXNyOgXYd', 640, 480) },
  { catId: 'ube', daysAgo: 7, photo: CAT_PHOTO('0BTTVEVWXNyOgXYd', 600, 450) },
  { catId: 'ube', daysAgo: 33, photo: CAT_PHOTO('0BTTVEVWXNyOgXYd', 520, 390) },
  { catId: 'kidlat', daysAgo: 2.4, photo: CAT_PHOTO('0C2bQ39x8kuhx31p', 640, 480) },
  { catId: 'bagyo', daysAgo: 3.2, photo: CAT_PHOTO('0DVs2d6bIVIt3ehk', 640, 480) },
  { catId: 'bagyo', daysAgo: 18, photo: CAT_PHOTO('0DVs2d6bIVIt3ehk', 560, 420) },
  { catId: 'alon', daysAgo: 0.9, photo: CAT_PHOTO('0EsIYDG0at0TPpPD', 640, 480) },
  { catId: 'alon', daysAgo: 11, photo: CAT_PHOTO('0EsIYDG0at0TPpPD', 600, 450) },
  { catId: 'ligaya', daysAgo: 1.8, photo: CAT_PHOTO('0F0IKAPOdWiE755P', 640, 480) },
  { catId: 'ligaya', daysAgo: 5, photo: CAT_PHOTO('0F0IKAPOdWiE755P', 560, 420) },
  { catId: 'ligaya', daysAgo: 29, photo: CAT_PHOTO('0F0IKAPOdWiE755P', 520, 390) },
  { catId: 'buko', daysAgo: 4.5, photo: CAT_PHOTO('0GC9MRUAqxhBzPyA', 640, 480) },
  { catId: 'buko', daysAgo: 16 },
  { catId: 'maya', daysAgo: 2.7, photo: CAT_PHOTO('0M0Lo3dsYft79xNd', 640, 480) },
  { catId: 'maya', daysAgo: 22, photo: CAT_PHOTO('0M0Lo3dsYft79xNd', 600, 450) },
  { catId: 'nilad', daysAgo: 6.3, photo: CAT_PHOTO('0mstmOIucwiN80jb', 640, 480) },
  { catId: 'nilad', daysAgo: 14, photo: CAT_PHOTO('0mstmOIucwiN80jb', 560, 420) },
  { catId: 'nilad', daysAgo: 41, photo: CAT_PHOTO('0mstmOIucwiN80jb', 520, 390) },
]

async function main() {
  const app = initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!, 'utf8'))) })
  const db = getFirestore(app)

  for (const cat of CATS) {
    const feature = territories.features.find((f) => f.properties.id === cat.id)
    if (!feature) {
      console.warn(`Skipping ${cat.id}: no territory in territories.geo.json`)
      continue
    }
    const { id, lastSeen: _lastSeen, ...rest } = cat
    await db.doc(`cats/${id}`).set({ ...rest, territory: feature.geometry.coordinates[0] })
    console.log(`cats/${id} written`)
  }

  const now = Date.now()
  for (const seed of SEED_SIGHTINGS) {
    const feature = territories.features.find((f) => f.properties.id === seed.catId)
    if (!feature) continue
    const ring = feature.geometry.coordinates[0] as [number, number][]
    const cx = ring.slice(0, -1).reduce((s, p) => s + p[0], 0) / (ring.length - 1)
    const cy = ring.slice(0, -1).reduce((s, p) => s + p[1], 0) / (ring.length - 1)
    await db.collection('sightings').add({
      catId: seed.catId,
      point: [cx, cy],
      status: 'surveyed',
      at: now - seed.daysAgo * DAY,
      authorUid: 'seed',
      ...(seed.photo ? { photo: seed.photo } : {}),
    })
  }
  console.log(`${SEED_SIGHTINGS.length} seed sightings written`)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
```

- [ ] **Step 3: Add the `seed:firebase` script to `package.json`**

```json
"seed:firebase": "tsc scripts/migrateSeed.ts --outDir node_modules/.tmp/seed --module commonjs --target es2022 --esModuleInterop --skipLibCheck --resolveJsonModule --rootDir . && node node_modules/.tmp/seed/scripts/migrateSeed.js"
```

- [ ] **Step 4: Run it once, against your real Firebase project**

Run: `cd app/front-end && GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/key.json npm run seed:firebase`
Expected: `cats/<id> written` twelve times, then `29 seed sightings written`. Verify in the Firebase console (Firestore Data tab) that `cats` has 12 documents and `sightings` has 29.

This step needs a real Firebase project to exist first (create one at console.firebase.google.com, enable Firestore + Storage + Google sign-in for Authentication, then fill in `.env.local` from Task 1 and generate the service account key above) — the first point in this whole plan where a live project is actually required, rather than the local emulator.

- [ ] **Step 5: Commit**

```bash
git add app/front-end/scripts/migrateSeed.ts app/front-end/package.json app/front-end/package-lock.json
git commit -m "Add the one-time Firestore seed migration script"
```

---

### Task 11: Auth UI — `App.tsx` and `Landing.tsx`

**Files:**
- Modify: `app/front-end/src/App.tsx`
- Modify: `app/front-end/src/landing/Landing.tsx`

**Interfaces:**
- Consumes: `subscribeAuth`, `signInWithGoogle`, `isAdmin`, `type User` from `@/data/auth` (Task 3).

- [ ] **Step 1: Replace `App.tsx`'s `useAdmin` (lines 100-120) and its two admin-related notes**

```ts
/* The admin gate, phase 9. Real Firebase Auth now: signed in with Google
   AND listed in the `admins` collection (firestore.rules' isAdmin(),
   data/auth.ts's isAdmin(uid) mirrors it for the client). Unlike the old
   ?role=admin, this genuinely cannot be typed into the address bar — the
   Firestore rule is what actually enforces it either way, this hook only
   decides what the UI shows.

   No longer constant after mount, unlike the old useAdmin: sign-in
   resolves asynchronously (onAuthStateChanged fires once Firebase has
   checked for a persisted session, then again if the user signs in this
   visit), so `admin` can flip from false to true after first paint. The
   effect below that mirrors it onto `document.body.dataset.admin` already
   depends on `[admin]` and re-runs correctly either way — nothing else
   needed changing for that. */
function useAdmin(): boolean {
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    return subscribeAuth((user) => {
      if (!user) {
        setAdmin(false)
        return
      }
      isAdmin(user.uid).then(setAdmin)
    })
  }, [])
  return admin
}
```

Add the import: `import { isAdmin, subscribeAuth } from '@/data/auth'`.

- [ ] **Step 2: Give `App.tsx` the signed-in uid, for `listSightings`/`listPendingForCat`/`withdrawSighting`/`voteSighting`/`addAdminPhoto`**

Add a second small hook right below `useAdmin`, and call it in `App()`:

```ts
function useUid(): string | null {
  const [uid, setUid] = useState<string | null>(null)
  useEffect(() => subscribeAuth((user) => setUid(user?.uid ?? null)), [])
  return uid
}
```

In `App()`, alongside `const admin = useAdmin()`, add `const uid = useUid()`. Thread `uid` down as a new prop everywhere `admin` is already threaded to `Rail`/`CatDeck`/`Plate`/`ReviewQueue`/`MapCanvas` (the exact prop list is whatever those components already accept `admin` on — Task 13 is where `Plate.tsx`'s call sites actually consume it; this step is only about `App.tsx` having the value and passing it down as `uid={uid}` next to each existing `admin={admin}`).

- [ ] **Step 3: Replace `Landing.tsx`'s sign-in anchor (lines 213-228)**

```tsx
{/* The seam. Phase 9: a real Google popup instead of a query-string
    stand-in. Explore's own curtain timing (see `explore` above) is not
    reused here — signing in is not a page transition, there is nothing
    to reveal underneath it — so this navigates directly once the popup
    resolves. */}
<button
  type="button"
  className="landing-signin"
  onClick={async () => {
    await signInWithGoogle()
    window.location.href = APP
  }}
>
  Sign in
  <span className="landing-signin-arrow" aria-hidden="true">
    <ArrowUpRight size={14} />
  </span>
</button>
```

Add the import: `import { signInWithGoogle } from '@/data/auth'`. This changes the element from `<a>` to `<button>` — check `landing.css` for a `.landing-signin` selector that assumes an anchor (e.g. `a.landing-signin`); if the rule is anchor-specific, broaden its selector to match a button too, since the visual design is unchanged, only the element.

- [ ] **Step 4: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: `App.tsx` and `Landing.tsx` no longer show errors. `RecordCat.tsx`, `ReportSighting.tsx`, `Plate.tsx` still do — Task 13.

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/App.tsx app/front-end/src/landing/Landing.tsx
git commit -m "Wire real Google sign-in into App.tsx and Landing.tsx"
```

---

### Task 12: Thread live sightings into the map (`Territories.tsx`, `CatMarkers.tsx`, `About.tsx`, `review.check.ts`)

**Why this task exists:** `map/Territories.tsx` and `map/CatMarkers.tsx` do not go through `catsRepo.ts` at all — they import `data/sightings.ts` directly and call `allSightings()`/`readSightings()`/`pendingByCat()` **synchronously, inside MapLibre effects that cannot `await`** (`Territories.tsx`'s own comment: "this runs inside a MapLibre effect that cannot await"). Task 6 deletes the synchronous, `localStorage`-backed versions of those functions, which breaks both files outright. `ui/About.tsx` calls the same functions too, but already inside an already-async `useEffect().then()`, so its fix is smaller. `data/review.check.ts` tests `isOwnPending`'s old two-array signature directly and needs updating to the signature Task 6 actually shipped (kept, not deleted — see Task 6's revised Interfaces list).

The fix follows the pattern `cats`/`territories` already use: `App.tsx` fetches sightings once (alongside cats/territories, in the same `Promise.all`, refetched on the same trigger), and hands the already-fetched array down as a plain prop — nothing downstream needs to fetch or await anything.

**Files:**
- Modify: `app/front-end/src/App.tsx`
- Modify: `app/front-end/src/map/MapCanvas.tsx`
- Modify: `app/front-end/src/map/Territories.tsx`
- Modify: `app/front-end/src/map/CatMarkers.tsx`
- Modify: `app/front-end/src/ui/About.tsx`
- Modify: `app/front-end/src/data/auth.ts` (adds one helper)
- Modify: `app/front-end/src/data/review.check.ts`

**Interfaces:**
- Consumes: `listAllSightings` from `@/data/sightings` (Task 6), `isOwnPending`/`pendingByCat`/`isSurveyed` from `@/data/sightings` (Task 6, unchanged/kept).
- Produces: `getCurrentUid(): Promise<string | null>` in `@/data/auth` — a one-shot read, distinct from `subscribeAuth`'s ongoing subscription, for the one place (`About.tsx`) that only needs a snapshot at open time.

- [ ] **Step 1: Add `getCurrentUid` to `src/data/auth.ts`**

```ts
/** One-shot read of the signed-in uid, unlike subscribeAuth's ongoing
    subscription — for callers that only need a snapshot at the moment
    they ask (ui/About.tsx's open-time readout), not live updates for as
    long as they're mounted. */
export function getCurrentUid(): Promise<string | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      resolve(user?.uid ?? null)
    })
  })
}
```

- [ ] **Step 2: `App.tsx` — fetch sightings alongside cats and territories**

Add the import: `import { listAllSightings, type Sighting } from '@/data/sightings'`.

Add state next to `cats`/`territories` (near line 212-219): `const [sightings, setSightings] = useState<Sighting[]>([])`.

Extend the load effect (lines 286-296) from `Promise.all([listCats(), listTerritories()])` to:
```ts
Promise.all([listCats(), listTerritories(), listAllSightings()]).then(
  ([loadedCats, loadedTerritories, loadedSightings]) => {
    if (!live) return
    setCats(loadedCats)
    setTerritories(loadedTerritories)
    setSightings(loadedSightings)
  }
)
```
Everything that already triggers this effect via `loadToken` (approving/discarding a sighting, adding a cat, reporting a sighting) now refreshes `sightings` for free — no new trigger wiring needed, since every one of those actions already calls `onRecorded`/`onChanged`.

Pass it to `MapCanvas`: add `sightings={sightings}` next to the existing `territories={territories}` prop on the `<MapCanvas>` element (line ~406).

- [ ] **Step 3: `MapCanvas.tsx` — forward `sightings` and `uid` to `Territories`/`CatMarkers`**

Add `sightings: Sighting[]` and `uid: string | null` to `MapCanvas`'s `Props` type (alongside `territories`, line ~122), and `import type { Sighting } from '@/data/sightings'`. Destructure both in the component's props. On the `<Territories .../>` element (~line 419), add `sightings={sightings}` and `uid={uid}`. On the `<CatMarkers .../>` element (~line 427), add `sightings={sightings}` only — it has no ownership-dependent logic.

`Landing.tsx` renders `<MapCanvas>` too, with `cats={NO_CATS}`/`territories={NO_TERRITORIES}` (no real data — the landing map is chrome only). Add a matching `const NO_SIGHTINGS: Sighting[] = []` next to those two constants and pass `sightings={NO_SIGHTINGS} uid={null}`.

`App.tsx` needs a `uid` value to pass here too — this is the same `uid` Task 11 Step 2 already added via `useUid()`; add `uid={uid}` on `App.tsx`'s own `<MapCanvas>` element alongside the `sightings={sightings}` prop from Step 2 above (both land on the same element).

- [ ] **Step 4: `Territories.tsx` — read the prop instead of scanning localStorage**

Replace the import block (lines 6-15):
```ts
import { distanceM, isOwnPending, isSurveyed, pendingByCat, ringRadiusM, translateToward, type Sighting } from '@/data/sightings'
```

Add `sightings: Sighting[]` and `uid: string | null` to the `Props` type (line 179-187) and destructure both where the component reads its other props (line 189+).

Replace lines 514-519:
```ts
/* Published observations, plus this viewer's own unreviewed one — see
   Sighting.authorUid's note (data/sightings.ts) on why this is safe: it
   is a claim about an animal's exact position, precisely what review
   exists to hold back until somebody has looked at it (spec §9).

   Synchronous, off the `sightings` prop App.tsx already fetched — same
   reason this predicate lives in data/sightings.ts and not catsRepo.ts:
   this runs inside a MapLibre effect that cannot await. */
const elsewhere = sightings
  .filter((sighting) => sighting.catId === selectedId)
  .filter((sighting) => isSurveyed(sighting) || isOwnPending(sighting, uid))
  .map((sighting) => sighting.point)
  .filter((point) => distanceM(centre, point) > reach * 0.6)
```

Replace line 692: `const summary = selectedId ? pendingByCat().get(selectedId) : undefined` with `const summary = selectedId ? pendingByCat(sightings).get(selectedId) : undefined`.

- [ ] **Step 5: `CatMarkers.tsx` — same swap, no ownership needed**

Add `sightings: Sighting[]` to the `Props` type and `import type { Sighting } from '@/data/sightings'`. Destructure `sightings` alongside the component's other props (near line 230-232).

Replace line 252: `const pending = admin ? pendingByCat() : null` with `const pending = admin ? pendingByCat(sightings) : null`. Update the comment above it (lines 244-251) — it is no longer a "localStorage scan"; the read is now over an already-fetched array, cheaper than before, still correctly re-run whenever `sightings` changes (the same `cats`/`territories`-change signal the comment already described, now with one more array feeding the same re-render).

- [ ] **Step 6: `About.tsx` — finish the async chain instead of degrading it**

Replace the import (line 5-6):
```ts
import { countRecorded, listCats } from '@/data/catsRepo'
import { isSurveyed, listAllSightings } from '@/data/sightings'
import { getCurrentUid } from '@/data/auth'
```

Replace the load effect (lines 96-118's `useEffect`):
```ts
useEffect(() => {
  let live = true
  Promise.all([listCats(), listAllSightings(), countRecorded(), getCurrentUid()]).then(
    ([cats, sightings, recorded, uid]) => {
      if (!live) return
      const mine = sightings.filter((sighting) => sighting.authorUid === uid)
      setSurvey({
        cats: cats.length,
        observations: sightings.filter(isSurveyed).length,
        yours: recorded + mine.length,
        waiting: mine.filter((sighting) => sighting.status === 'pending').length,
      })
    }
  )
  return () => {
    live = false
  }
}, [])
```

- [ ] **Step 7: `review.check.ts` — update to `isOwnPending`'s new signature**

Replace the whole file:

```ts
import assert from 'node:assert/strict'
import { isOwnPending, isSurveyed, type Sighting } from './sightings'

/* The one runnable check behind review, phase 8 (updated phase 9:
   isOwnPending's signature changed from "is this sighting in this array
   of my own reports" to "does this sighting's authorUid match mine" —
   same predicate, an account fact instead of a browser fact underneath
   it. Run: npm run check:review. */

const at = (id: string, status: Sighting['status'], authorUid = 'me'): Sighting => ({
  id,
  catId: 'milo',
  point: [121.05, 14.55],
  at: 0,
  status,
  authorUid,
})

const surveyed = at('a', 'surveyed')
const pending = at('b', 'pending')
const discarded = at('c', 'discarded')

assert.equal(isSurveyed(surveyed), true, 'surveyed is published')
assert.equal(isSurveyed(pending), false, 'pending is NOT published')
assert.equal(isSurveyed(discarded), false, 'discarded is NOT published')

// Mine, and unreviewed: the plate shows it back to me with a withdraw.
assert.equal(isOwnPending(pending, 'me'), true, 'my own pending is visible to me')

// The clause that matters most. Somebody ELSE's pending sighting is not
// mine to see, no matter which surface is asking.
assert.equal(isOwnPending(pending, 'someone-else'), false, 'a pending sighting I do not own stays hidden')
assert.equal(isOwnPending(pending, null), false, 'a signed-out viewer owns nothing')

// Ownership does not resurrect a decided record.
assert.equal(isOwnPending(at('d', 'discarded', 'me'), 'me'), false, 'my discarded report is not pending')
assert.equal(isOwnPending(at('e', 'surveyed', 'me'), 'me'), false, 'my approved report is not pending')

// The two together, which is how every caller actually uses them (catsRepo.
// listSightings, map/Territories.tsx's "elsewhere" zones) — asserted as one
// thing so a change to either predicate that breaks the pair fails here.
const visible = (sighting: Sighting, uid: string | null) => isSurveyed(sighting) || isOwnPending(sighting, uid)

const log = [surveyed, pending, discarded, at('f', 'pending', 'someone-else')]
assert.deepEqual(
  log.filter((sighting) => visible(sighting, 'me')).map((s) => s.id),
  ['a', 'b'],
  'a visitor sees published records plus their own unreviewed one, and nothing else'
)
assert.deepEqual(
  log.filter((sighting) => visible(sighting, null)).map((s) => s.id),
  ['a'],
  'a signed-out visitor sees only what is published'
)

console.log('review: ok')
```

- [ ] **Step 8: Typecheck and run both checks**

Run: `cd app/front-end && npx tsc -b && npm run check:review`
Expected: no typecheck errors in any of the six modified files; `review: ok`.

- [ ] **Step 9: Commit**

```bash
git add app/front-end/src/App.tsx app/front-end/src/map/MapCanvas.tsx app/front-end/src/map/Territories.tsx app/front-end/src/map/CatMarkers.tsx app/front-end/src/ui/About.tsx app/front-end/src/data/auth.ts app/front-end/src/data/review.check.ts app/front-end/src/landing/Landing.tsx
git commit -m "Thread live sightings into the map instead of scanning localStorage"
```

---

### Task 13: Photo upload + sign-in gate in `RecordCat.tsx`, `ReportSighting.tsx`, `Plate.tsx`

**Files:**
- Modify: `app/front-end/src/ui/RecordCat.tsx`
- Modify: `app/front-end/src/ui/ReportSighting.tsx`
- Modify: `app/front-end/src/plate/Plate.tsx`

**Interfaces:**
- Consumes: `compressImageToBlob` from `@/ui/imageToDataUrl` (Task 4), `uploadPhoto` from `@/data/photoUpload` (Task 4), `subscribeAuth`/`signInWithGoogle` from `@/data/auth` (Task 3).

- [ ] **Step 1: `RecordCat.tsx` — upload instead of keeping a data URI**

Replace the import (line 22): `import { compressImage, PHOTO_MAX_DIM, PHOTO_QUALITY } from './imageToDataUrl'` with:
```ts
import { compressImageToBlob, PHOTO_MAX_DIM, PHOTO_QUALITY } from './imageToDataUrl'
import { uploadPhoto } from '@/data/photoUpload'
```

Replace `pickMainPhoto` and `pickExtraPhotos` (lines 306-331):

```ts
const pickMainPhoto = async (file: File | undefined) => {
  if (!file) return
  setError(null)
  try {
    const blob = await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
    const url = await uploadPhoto(blob, 'cats')
    setForm((f) => ({ ...f, photo: url }))
  } catch {
    setError('Could not upload that photo. Check your connection and try again.')
  }
}

const pickExtraPhotos = async (files: FileList | null) => {
  if (!files || files.length === 0) return
  setError(null)
  const room = MAX_EXTRA_PHOTOS - extraPhotos.length
  const picked = Array.from(files).slice(0, room)
  try {
    const urls = await Promise.all(
      picked.map(async (file) => uploadPhoto(await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY), 'cats'))
    )
    setExtraPhotos((prev) => [...prev, ...urls.map((src, i) => ({ id: `${Date.now()}-${i}`, src }))])
  } catch {
    setError('Could not upload one of those photos. Try again.')
  }
}
```

(The `<img className="record-thumb" src={form.photo} />` preview at line 455, and the gallery preview at line 471, now show the uploaded photo only once the upload finishes rather than instantly from a local data URI — a real, visible wait on a slow connection. Add a `photoUploading` boolean, set around each `await uploadPhoto(...)` call, and disable the Next/Add cat buttons while true, the same way `busy` already disables the submit button during `addCat`. This is the one place this task adds new state rather than only swapping a function call — needed because the previous instant-preview UX no longer holds once upload is a real network round trip.)

Change `submit`'s call to `countRecorded`-adjacent code and `addCat`'s `authorUid`: at the top of `submit` (around line 337), the `draft` object needs an `authorUid`. Add it from the signed-in admin:
```ts
import { subscribeAuth } from '@/data/auth'
```
and at the top of `RecordCat`, alongside its other `useState`s:
```ts
const [uid, setUid] = useState<string | null>(null)
useEffect(() => subscribeAuth((user) => setUid(user?.uid ?? null)), [])
```
then in `submit`, pass `authorUid: uid ?? ''` into the object handed to `addCat` (RecordCat is only ever mounted for a signed-in admin, per `App.tsx`'s gate, so `uid` is non-null in practice by the time this form is reachable; `CatDraft.authorUid` was already added in Task 5).

Update the two `countRecorded()`/`clearRecorded()` call sites (lines 391 and 801) to `await` them: `setRecorded(await countRecorded())` and `await clearRecorded()` inside their respective (already-async-capable, since they're inside `onClick`/event handlers — wrap in an async IIFE or mark the handler `async`) callbacks.

- [ ] **Step 2: `ReportSighting.tsx` — upload the sighting photo, gate reporting behind sign-in**

Replace the import (line 15): `import { compressImage, PHOTO_MAX_DIM, PHOTO_QUALITY } from './imageToDataUrl'` with:
```ts
import { compressImageToBlob, PHOTO_MAX_DIM, PHOTO_QUALITY } from './imageToDataUrl'
import { uploadPhoto } from '@/data/photoUpload'
import { signInWithGoogle, subscribeAuth } from '@/data/auth'
```

Replace `pickPhoto` (lines 476-484):
```ts
const pickPhoto = async (file: File | undefined) => {
  if (!file) return
  setPhotoError(null)
  try {
    const blob = await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
    setPhoto(await uploadPhoto(blob, 'sightings'))
  } catch {
    setPhotoError('Could not upload that photo. Check your connection and try again.')
  }
}
```

Add a `uid` subscription at the top of `ReportSighting`, same shape as `RecordCat`'s:
```ts
const [uid, setUid] = useState<string | null>(null)
useEffect(() => subscribeAuth((user) => setUid(user?.uid ?? null)), [])
```

In `commit` (lines 466-474), pass `uid` through to `addSighting` and require it:
```ts
const commit = async () => {
  if (!cat || !point || !uid) return
  const minutes = WHEN.find((w) => w.key === when)?.minutesAgo ?? 0
  const sighting = await addSighting(cat.id, point, Date.now() - minutes * 60_000, uid, photo || undefined)
  if (!sighting) return
  setUndoId(sighting.id)
  setStep('done')
  onReported()
}
```
`addSighting` is now `async` (Task 6) — `commit` must become `async` too, and its one call site (the "Report sighting" button's `onClick={commit}` at line 902) becomes `onClick={() => void commit()}`.

At the `confirm` step (around line 854, right before the "Report sighting" button), add a sign-in prompt shown only when `!uid`:
```tsx
{!uid && (
  <button type="button" className="sight-go" onClick={() => void signInWithGoogle()}>
    Sign in with Google to report
  </button>
)}
```
and change the existing "Report sighting" button to render only `{uid && (...)}`, so an unsigned-in visitor sees the sign-in prompt in the same slot the report button occupies once they are.

- [ ] **Step 3: `Plate.tsx` — upload the admin's added photo**

Replace the import (line 39): `import { compressImage, PHOTO_MAX_DIM, PHOTO_QUALITY } from '@/ui/imageToDataUrl'` with:
```ts
import { compressImageToBlob, PHOTO_MAX_DIM, PHOTO_QUALITY } from '@/ui/imageToDataUrl'
import { uploadPhoto } from '@/data/photoUpload'
import { subscribeAuth } from '@/data/auth'
```

Add a `uid` subscription near `Plate`'s other state (it already receives `admin: boolean` as a prop — add `uid` the same way `App.tsx` now passes it, per Task 11 Step 2, as a new `uid: string | null` prop rather than subscribing again inside `Plate` itself, since `App.tsx` already holds the canonical value).

Replace `addPhoto` (lines 444-462):
```ts
const addPhoto = async (file: File | undefined) => {
  if (!file || !catRing || !uid) return
  setAddPhotoError(null)
  setAddingPhoto(true)
  try {
    const blob = await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
    const url = await uploadPhoto(blob, 'sightings')
    const ok = await addAdminPhoto(cat.id, ringCentroid(catRing), url, uid)
    if (ok) {
      loadSightings()
      onChanged?.()
    } else {
      setAddPhotoError('Could not save. Check your connection and try again.')
    }
  } catch {
    setAddPhotoError('Could not upload that photo. Try a different file.')
  } finally {
    setAddingPhoto(false)
  }
}
```

Update the three other now-multi-arg call sites already in this file to pass `uid`/thread it through, matching Task 8's new signatures: `withdrawSighting(sighting.id)` at line 897 becomes `withdrawSighting(sighting.id, uid ?? '')`; `voteSighting(id, direction)` at line 469 becomes `voteSighting(id, uid ?? '', direction)`; and wherever `loadSightings` calls `listSightings(cat.id)`/`listPendingForCat(cat.id)` (line 238) becomes `listSightings(cat.id, uid)`/`listPendingForCat(cat.id, uid)`.

- [ ] **Step 4: Typecheck**

Run: `cd app/front-end && npx tsc -b`
Expected: no errors anywhere in the project.

- [ ] **Step 5: Manual gate — run the real app against your Firebase project**

Run: `cd app/front-end && npm run dev`, open `http://localhost:5173`.
Walk through: Explore -> the map loads the 12 migrated cats and their territories -> click "Sign in" on the landing, complete the Google popup -> the admin banner appears -> open "Add a new cat", upload a photo, confirm it appears as a real `https://firebasestorage.googleapis.com/...` URL once the upload finishes -> submit, confirm the new cat appears on the map -> sign out (or open a private window), report a sighting as a different Google account, confirm it requires sign-in and lands `pending` -> sign back in as the admin, approve it from the review queue, confirm the territory moves.

This is the one gate this plan cannot automate — per `app/front-end/CLAUDE.md`, do not self-launch a browser for this; ask the user for a screenshot or a description of what they saw at each step above.

- [ ] **Step 6: Commit**

```bash
git add app/front-end/src/ui/RecordCat.tsx app/front-end/src/ui/ReportSighting.tsx app/front-end/src/plate/Plate.tsx app/front-end/src/data/territoryShape.ts app/front-end/src/App.tsx
git commit -m "Wire photo upload and sign-in gating into the report/record/plate flows"
```

---

### Task 14: Update the build plan and feature roadmap

**Files:**
- Modify: `docs/superpowers/plans/2026-08-16-meowtro-build-plan.md`
- Modify: `docs/superpowers/plans/2026-08-24-feature-roadmap.md`

- [ ] **Step 1: Update the build plan's `RESUME HERE` block**

Add a new entry above the current top one, dated the day this lands, summarizing: Phase 9 shipped — Firestore/Auth/Storage replace `localStorage` behind `catsRepo.ts`; `?role=admin` is gone, replaced by real Google sign-in gated on an `admins` Firestore doc; `localCats.ts`/`overlay.ts` are deleted; territory geometry lives in `territoryShape.ts`. Note what has **not** yet been visually reviewed (the sign-in flow, the upload-in-progress states added in Task 13).

- [ ] **Step 2: Check off Phase 9's items in the feature roadmap**

In `docs/superpowers/plans/2026-08-24-feature-roadmap.md`'s "Phase 9 — The backend" section, mark `Real API behind catsRepo`, `Sighting photo uploads`, and `Cross-device survey` as done (the fourth item, `Migrate localStorage`, is also covered — `localCats.ts`/`sightings.ts`'s storage are both gone). Link to this plan and the design spec.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-16-meowtro-build-plan.md docs/superpowers/plans/2026-08-24-feature-roadmap.md
git commit -m "Update build plan and roadmap: Phase 9 shipped"
```

---

## Plan self-review notes

- **Spec coverage:** Platform choice (Task 1), data model (Tasks 6-7, 10), photos (Tasks 4, 13), auth (Tasks 3, 11), "what does not change" (verified explicitly at Task 8 Step 2, which confines the typecheck-error surface to exactly the files Tasks 11-13 go on to fix). Deferred items (share cards, rate limiting, non-Google auth) are correctly untouched by every task.
- **The `myVote`/votes design** is new work beyond what the spec wrote down (the spec said "same fields... plus authorUid" and did not resolve that `myVote` can no longer live on the shared sighting doc once voting is multi-user) — resolved here with a `sightings/{id}/votes/{uid}` subcollection plus a transaction, reusing the existing pure `applyVote` unchanged.
- **The territory-storage design** is likewise new beyond the spec: storing a pre-resolved `territory` ring on every cat doc (rather than `center`/`radiusM`/`shape`) is what lets seeded cats (arbitrary hand-drawn polygons) and admin-recorded cats (warped circles) share one document shape with no branch — simpler than today's two-path `CATS.some(...) ? overlay : storage` logic in `catsRepo.ts`.
- **Task 12 (sightings threading) was added during self-review**, not present in the first draft: `map/Territories.tsx` and `map/CatMarkers.tsx` read `data/sightings.ts` directly and synchronously from inside MapLibre effects, entirely outside the `catsRepo.ts` seam the rest of this plan leans on. Caught by grepping every call site of the functions Task 6 removes (`allSightings`, `readSightings`, the old `isOwnPending`) before trusting the "only catsRepo.ts changes" assumption — the same grep also surfaced `ui/About.tsx` (an easy fix, already inside an async effect) and `data/review.check.ts` (a signature update). `isOwnPending` itself was nearly deleted outright in the first draft; kept, with a simpler signature, once it was clear `Territories.tsx` needs the exact same predicate `catsRepo.ts` does.
