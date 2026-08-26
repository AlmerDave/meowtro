# Admin "Add a new cat" Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin's "add a cat" panel (`ui/RecordCat.tsx`) into a four-step wizard: guided, tap-choice identity questions instead of free-text description; upload-based photos (compressed client-side, plus an optional gallery seeded as sightings) instead of a photo URL; and four territory shape templates instead of circle-only.

**Architecture:** Pure/checkable logic (shape geometry, description composition, note-phrase persistence, admin-sighting creation) lives in small `data/*.ts` modules with a `*.check.ts` alongside, following this repo's existing pattern (`sightings.check.ts`, `palette.check.ts` — no test runner exists, `npm run check:*` compiles a file with `tsc` and runs it under `node`). DOM-dependent work (image compression via `<canvas>`, the wizard UI itself) has no check script — this repo has none for anything DOM-shaped either — and is verified with `npx tsc -b` plus a manual visual-gate walkthrough, exactly as `app/front-end/CLAUDE.md` already prescribes.

**Tech Stack:** React 19 + TypeScript, Vite, MapLibre GL, `motion/react`. No test runner, no lint script — `npx tsc -b` is the only automated gate.

**Spec:** [`docs/superpowers/specs/2026-08-26-admin-add-cat-redesign-design.md`](../specs/2026-08-26-admin-add-cat-redesign-design.md)

## Global Constraints

- Never add a `location`/lat-lng field to `Cat`. Territories are polygons only (spec §9, restated in root `CLAUDE.md` and the front-end `CLAUDE.md`).
- No freehand polygon drawing — shape choice is limited to four fixed templates.
- The panel's entry point does not move: it stays in the map's `admin-controls` HUD, mounted only behind `?role=admin`.
- No new "manage all cats" admin table or list view.
- `Cat`'s own type does not change. `photo` stays a plain `string` (now holding a data URI instead of a URL).
- Everything still persists to `localStorage` only — no backend exists in this app. Photo compression is required, not optional polish: an uncompressed upload can exceed the entire 5-10MB quota on its own.
- Do not introduce a test runner, linter, or new npm dependency. Follow the existing `*.check.ts` + `npm run check:*` pattern for new pure logic (see `package.json`'s `check:sightings`/`check:palette` scripts for the exact `tsc ... && node ...` invocation shape).
- Do not self-launch a browser. Any step that says "visually verify" is a manual step for a human to close, not something to automate here.
- Match the codebase's existing comment density — comments here explain *why*, often at length (see any file under `app/front-end/src/data/`).

---

## File Structure

**New files:**
- `app/front-end/src/data/describeCat.ts` — the five description questions' option lists and the pure function that composes an admin's answers into one `description` string.
- `app/front-end/src/data/describeCat.check.ts` — check script for the composer.
- `app/front-end/src/data/noteChips.ts` — built-in field-note starter phrases, plus a `localStorage`-backed list of an admin's own saved phrases.
- `app/front-end/src/data/noteChips.check.ts` — check script for the merge/dedupe logic.
- `app/front-end/src/data/localCats.check.ts` — check script for the new shape geometry.
- `app/front-end/src/ui/imageToDataUrl.ts` — `File` → compressed data-URI, via `FileReader` + an off-screen `<canvas>`.

**Modified files:**
- `app/front-end/src/data/localCats.ts` — `Shape` type, `shapeRing` (replaces `circleRing`), `CatDraft`/`StoredCat` gain `shape`, `isStored` validates it, `shapeFeature` (replaces `circleFeature`).
- `app/front-end/src/data/sightings.ts` — `buildAdminSighting` (pure) + `addAdminSighting` (persists), for bootstrap gallery photos.
- `app/front-end/src/data/catsRepo.ts` — `addCat` threads `shape` through and creates bootstrap sightings for any extra photos.
- `app/front-end/src/ui/RecordCat.tsx` — full rewrite into the four-step wizard.
- `app/front-end/src/shell.css` — new rules for the wizard chrome, shape/pill pickers, and photo thumbnails, alongside the existing `.record-*` rules.
- `app/front-end/package.json` — two new `check:*` scripts.

**Not touched:** `app/front-end/src/data/cats.seed.ts` (`Cat` type is unchanged), `app/front-end/src/plate/Plate.tsx` (the photo pile already renders any surveyed sighting with a photo — see spec §3).

---

## Task 1: Territory shape templates

**Files:**
- Modify: `app/front-end/src/data/localCats.ts`
- Create: `app/front-end/src/data/localCats.check.ts`
- Modify: `app/front-end/package.json`

**Interfaces:**
- Produces: `Shape = 'round' | 'elongated' | 'notched' | 'blocky'`, `SHAPES: { id: Shape; label: string }[]`, `shapeRing(shape: Shape, center: [number, number], radiusM: number): [number, number][]`, `shapeFeature(stored: StoredCat): Feature<Polygon>`, `CatDraft` and `StoredCat` both carrying `shape: Shape`, `isStored(value: unknown): value is StoredCat` validating it.

- [ ] **Step 1: Write the failing check script**

Create `app/front-end/src/data/localCats.check.ts`:

```typescript
import assert from 'node:assert/strict'
import { distanceM } from './sightings'
import { isStored, shapeRing, type Shape, type StoredCat } from './localCats'

/* Run: npm run check:localcats (no test runner in this project — see
   sightings.check.ts for why a check script compiles itself and runs
   under node instead). */

const CENTER: [number, number] = [121.05, 14.55]
const RADIUS = 90

// 'round' is today's plain circle and must stay one: every point sits
// within a hair of RADIUS metres from the centre, same tolerance the old
// circleRing gave (points are rounded to six decimals, ~10cm).
const round = shapeRing('round', CENTER, RADIUS)
for (const point of round) {
  const d = distanceM(CENTER, point)
  assert.ok(Math.abs(d - RADIUS) < 0.2, `round shape point drifted ${d}m from a ${RADIUS}m radius`)
}

// A ring is a closed GeoJSON polygon boundary: first point repeats last.
for (const shape of ['round', 'elongated', 'notched', 'blocky'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  assert.deepEqual(ring[0], ring[ring.length - 1], `${shape} ring does not close`)
  assert.equal(ring.length, 49, `${shape} ring should have 48 steps plus the closing point`)
}

// The three new templates must not be circles: at least one point has to
// sit meaningfully nearer or farther than RADIUS, or the shape picker
// would just be three names for the same silhouette.
for (const shape of ['elongated', 'notched', 'blocky'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  const distances = ring.map((point) => distanceM(CENTER, point))
  const spread = Math.max(...distances) - Math.min(...distances)
  assert.ok(spread > RADIUS * 0.15, `${shape} is too close to a plain circle (spread ${spread}m)`)
  assert.ok(Math.min(...distances) > 0, `${shape} produced a point on top of its own centre`)
}

// Deterministic: the same shape drawn twice must look identical, or two
// admins picking "Notched" at the same radius would see different
// territories for no visible reason.
assert.deepEqual(
  shapeRing('notched', CENTER, RADIUS),
  shapeRing('notched', CENTER, RADIUS),
  'shapeRing is not deterministic'
)

// isStored must accept a real shape and reject a bogus one, the same
// defensive read every other localStorage-backed list in this app does.
const base: StoredCat = {
  cat: {
    id: 'x',
    name: 'X',
    plate: 'PLATE 01',
    line: 'LINE 00',
    colour: '--cat-rust',
    description: 'd',
    firstRecorded: 'Jan 2026',
    range: 'r',
    disposition: 'Not yet observed',
    coordinates: 'c',
    photo: 'data:image/jpeg;base64,x',
  },
  center: CENTER,
  radiusM: RADIUS,
  shape: 'blocky',
}
assert.equal(isStored(base), true, 'a valid StoredCat with a real shape was rejected')
assert.equal(
  isStored({ ...base, shape: 'triangle' }),
  false,
  'isStored accepted a shape that is not one of the four templates'
)
assert.equal(isStored({ ...base, shape: undefined }), false, 'isStored accepted a missing shape')

console.log('localCats: ok')
```

- [ ] **Step 2: Add the npm script and confirm the check fails**

In `app/front-end/package.json`, add alongside the other `check:*` scripts:

```json
    "check:localcats": "tsc src/data/localCats.check.ts --outDir node_modules/.tmp/lcheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck --resolveJsonModule && node node_modules/.tmp/lcheck/data/localCats.check.js",
```

Run: `npm run check:localcats` (from `app/front-end/`)
Expected: FAIL — `shapeRing`, `Shape` and the `shape` field don't exist yet, so this won't even compile.

- [ ] **Step 3: Implement the shape templates**

In `app/front-end/src/data/localCats.ts`, replace the `circleRing` function and its surrounding comment with:

```typescript
/** The four territories an admin can pick, alongside the colour. `round`
    is exactly what this app has always drawn — a plain circle, zero
    deformation — so a shape picker never quietly changes an existing
    look. The other three are still `Polygon` rings built off the same
    loop, only warped: nothing here is a "real" circle or rectangle
    primitive any more than the seeded territories are, which are also
    just irregular point-rings (territories.geo.json). */
export type Shape = 'round' | 'elongated' | 'notched' | 'blocky'

export const SHAPES: { id: Shape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'elongated', label: 'Elongated' },
  { id: 'notched', label: 'Notched' },
  { id: 'blocky', label: 'Blocky' },
]

/* Each entry returns a multiplier on radiusM for a given angle (radians).
   Fixed constants, no randomness: the same shape at the same radius must
   always draw the same outline (localCats.check.ts asserts this), and
   "the same shape looks the same twice" is what makes a picker legible.

   The formulas are deliberately plain trigonometry, same reasoning
   circleRing always gave for not reaching for turf.js: a small, fixed,
   checkable function beats a library for four shapes. */
const NOTCH_ANGLE = Math.PI / 4
const NOTCH_WIDTH = 0.5
const DEFORM: Record<Shape, (angle: number) => number> = {
  round: () => 1,
  // Two lobes opposite each other: stretched along one axis, pinched
  // across the other — reads as "runs along a street" rather than a
  // lopsided blob.
  elongated: (angle) => 1 + 0.35 * Math.cos(2 * angle),
  // A single inward pinch on one side (a Gaussian dip centred on a fixed
  // angle), for an L-shaped block or a corner lot.
  notched: (angle) => 1 - 0.34 * Math.exp(-((angle - NOTCH_ANGLE) ** 2) / (2 * NOTCH_WIDTH ** 2)),
  // Four gentle lobes: not literally square (a real square ring would
  // need far more than 48 points to look sharp-cornered rather than
  // faceted), but reads as squared-off next to Round and Elongated.
  blocky: (angle) => 1 + 0.18 * Math.cos(4 * angle),
}

/** Territory geometry for any of the four shapes, sharing the exact loop,
    rounding and closing rule circleRing always used — see its own note on
    matching the sphere MapLibre itself measures with. */
export function shapeRing(shape: Shape, center: [number, number], radiusM: number): [number, number][] {
  const [lng, lat] = center
  const dLat = radiusM / M_PER_DEG
  const dLng = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  const round = (n: number) => Math.round(n * 1e6) / 1e6
  const deform = DEFORM[shape]

  const ring: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    const scale = deform(angle)
    ring.push([
      round(lng + dLng * Math.cos(angle) * scale),
      round(lat + dLat * Math.sin(angle) * scale),
    ])
  }
  ring.push(ring[0])
  return ring
}
```

Update `CatDraft` and `StoredCat`:

```typescript
export type CatDraft = {
  name: string
  description: string
  note: string
  photo: string
  line: string
  colour: Cat['colour']
  shape: Shape
  /** Extra photos for the plate's photo pile, already compressed to a
      data URI each (see ui/imageToDataUrl.ts). Never stored on the cat
      itself — catsRepo.addCat turns each one into its own surveyed
      Sighting, so this array only ever exists for the length of one
      submit. */
  extraPhotos: string[]
  center: [number, number]
  radiusM: number
}

export type StoredCat = {
  cat: Cat
  center: [number, number]
  radiusM: number
  shape: Shape
}
```

Update `isStored`:

```typescript
const SHAPE_IDS = new Set<Shape>(['round', 'elongated', 'notched', 'blocky'])

function isStored(value: unknown): value is StoredCat {
  if (!value || typeof value !== 'object') return false
  const { cat, center, radiusM, shape } = value as Partial<StoredCat>
  return (
    !!cat &&
    typeof cat.id === 'string' &&
    typeof cat.name === 'string' &&
    typeof cat.photo === 'string' &&
    Array.isArray(center) &&
    center.length === 2 &&
    center.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof radiusM === 'number' &&
    Number.isFinite(radiusM) &&
    radiusM > 0 &&
    typeof shape === 'string' &&
    SHAPE_IDS.has(shape as Shape)
  )
}
```

Rename `circleFeature` to `shapeFeature` and use `shapeRing`:

```typescript
export function shapeFeature(stored: StoredCat): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { id: stored.cat.id, name: stored.cat.name },
    geometry: { type: 'Polygon', coordinates: [shapeRing(stored.shape, stored.center, stored.radiusM)] },
  }
}
```

- [ ] **Step 4: Run the check script and confirm it passes**

Run: `npm run check:localcats`
Expected: `localCats: ok`

- [ ] **Step 5: Fix the two callers that still import the old names**

`app/front-end/src/data/catsRepo.ts` imports `circleFeature` — change the import and its one use in `listTerritories` to `shapeFeature`. `app/front-end/src/ui/RecordCat.tsx` imports `circleRing` for its live preview — leave this call site as `circleRing(center, radiusM)` for now (it becomes `shapeRing` in Task 6, alongside the rest of that file's rewrite); for this step, just run `npx tsc -b` and confirm the only remaining error is that exact `circleRing` call in `RecordCat.tsx` (everything else in the codebase should now compile clean against the renamed/extended types).

Run: `npx tsc -b`
Expected: the sole error is `Cannot find name 'circleRing'` (or similar) in `RecordCat.tsx` — confirms Task 1's rename reached every other caller correctly.

- [ ] **Step 6: Commit**

```bash
git add app/front-end/src/data/localCats.ts app/front-end/src/data/localCats.check.ts app/front-end/src/data/catsRepo.ts app/front-end/package.json
git commit -m "$(cat <<'EOF'
Add four territory shape templates alongside the existing circle

shapeRing generalizes circleRing with a per-shape deformation formula;
CatDraft/StoredCat now carry which one was picked. RecordCat.tsx still
calls the old name and is fixed in a later task that rewrites it.
EOF
)"
```

---

## Task 2: Guided description questions

**Files:**
- Create: `app/front-end/src/data/describeCat.ts`
- Create: `app/front-end/src/data/describeCat.check.ts`
- Modify: `app/front-end/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `UNKNOWN`, `FUR_COLOURS`, `PATTERNS`, `MARKS`, `SEXES`, `AGES: { id: string; label: string; hint?: string }[]`, `type CoatAnswers`, `EMPTY_ANSWERS`, `composeDescription(answers: CoatAnswers): string`.

- [ ] **Step 1: Write the failing check script**

Create `app/front-end/src/data/describeCat.check.ts`:

```typescript
import assert from 'node:assert/strict'
import { composeDescription, EMPTY_ANSWERS, UNKNOWN, type CoatAnswers } from './describeCat'

/* Run: npm run check:describecat */

const full: CoatAnswers = {
  furColour: 'Grey',
  pattern: 'Tabby',
  marks: ['White socks'],
  sex: 'Male',
  age: 'Young adult',
}
assert.equal(
  composeDescription(full),
  'Grey tabby · white socks · male, est. young adult',
  'a fully-answered set did not compose to the expected seed-style sentence'
)

const noMarks: CoatAnswers = { ...full, marks: [] }
assert.equal(
  composeDescription(noMarks),
  'Grey tabby · male, est. young adult',
  'an empty marks list should drop that clause entirely, not print an empty one'
)

const noneMark: CoatAnswers = { ...full, marks: ['None'] }
assert.equal(
  composeDescription(noneMark),
  'Grey tabby · male, est. young adult',
  '"None" is a real answer to the marks question but must not appear as text'
)

const multiMarks: CoatAnswers = { ...full, marks: ['White socks', 'Bobtail'] }
assert.equal(
  composeDescription(multiMarks),
  'Grey tabby · white socks, bobtail · male, est. young adult',
  'multiple marks did not join with a comma'
)

const sexUnknown: CoatAnswers = { ...full, sex: UNKNOWN }
assert.equal(
  composeDescription(sexUnknown),
  'Grey tabby · white socks, est. young adult',
  'an unknown sex should drop out of the tail clause, not print "Don\'t know"'
)

const colourUnknown: CoatAnswers = { ...full, furColour: UNKNOWN }
assert.equal(
  composeDescription(colourUnknown),
  'Tabby · white socks · male, est. young adult',
  'an unknown fur colour should leave just the pattern, capitalised as the sentence start'
)

assert.equal(
  composeDescription(EMPTY_ANSWERS),
  '',
  'no answers at all must compose to an empty string, not "· ·" or similar'
)

const allUnknown: CoatAnswers = { furColour: UNKNOWN, pattern: UNKNOWN, marks: [UNKNOWN], sex: UNKNOWN, age: UNKNOWN }
assert.equal(composeDescription(allUnknown), '', 'every answer being "Don\'t know" must compose to nothing')

console.log('describeCat: ok')
```

- [ ] **Step 2: Add the npm script and confirm the check fails**

```json
    "check:describecat": "tsc src/data/describeCat.check.ts --outDir node_modules/.tmp/dcheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck && node node_modules/.tmp/dcheck/data/describeCat.check.js",
```

Run: `npm run check:describecat`
Expected: FAIL — `describeCat.ts` doesn't exist.

- [ ] **Step 3: Implement `describeCat.ts`**

```typescript
/* The five tap-choice questions behind Step 2 of ui/RecordCat.tsx, and the
   pure function that turns an admin's answers into one `description`
   string — the same style the seeded cats already use ("Grey tabby ·
   white socks · male, est. 2 yrs"), without ever asking anyone to
   hand-compose a sentence.

   Kept in its own file, separate from ui/RecordCat.tsx, for the same
   reason data/localCats.ts's geometry is separate from the panel that
   calls it: this is checkable under node (describeCat.check.ts) and the
   component that renders it is not. */

export const UNKNOWN = "Don't know"

export const FUR_COLOURS = ['Black', 'Grey', 'Orange/Ginger', 'White', 'Brown', 'Calico/Mixed', UNKNOWN] as const
export const PATTERNS = ['Solid', 'Tabby', 'Tuxedo', 'Tricolor', 'Tortoiseshell', 'Colorpoint', UNKNOWN] as const
export const MARKS = [
  'White socks',
  'White chest',
  'Bobtail',
  'Notched ear',
  'Long-haired',
  'Short-haired',
  'None',
  UNKNOWN,
] as const
export const SEXES = ['Male', 'Female', UNKNOWN] as const

/** Age brackets. Short values are what gets stored and composed
    ("est. young adult"); `hint` is the year range shown under the button
    in the picker, never part of the composed sentence. */
export const AGES: { id: string; hint: string }[] = [
  { id: 'Kitten', hint: 'under 1 yr' },
  { id: 'Young adult', hint: '1-3 yrs' },
  { id: 'Adult', hint: '3-7 yrs' },
  { id: 'Senior', hint: '7+ yrs' },
  { id: UNKNOWN, hint: '' },
]

export type CoatAnswers = {
  furColour: string
  pattern: string
  /** Multi-select; may include a custom free-text entry typed through the
      "+ Custom" chip, which is why this is `string[]` rather than a union
      of MARKS. */
  marks: string[]
  sex: string
  age: string
}

export const EMPTY_ANSWERS: CoatAnswers = { furColour: '', pattern: '', marks: [], sex: '', age: '' }

const known = (value: string) => value !== '' && value !== UNKNOWN

/** Composes the five answers into one sentence, skipping any clause with
    nothing answerable in it — an admin who only knows the colour still
    gets a real (short) description rather than a required field with
    nothing to put in it. */
export function composeDescription(answers: CoatAnswers): string {
  const { furColour, pattern, marks, sex, age } = answers

  const head = [known(furColour) ? furColour : '', known(pattern) ? pattern.toLowerCase() : '']
    .filter(Boolean)
    .join(' ')

  const marksClause = marks.filter((mark) => known(mark) && mark !== 'None').join(', ').toLowerCase()

  const tail = [known(sex) ? sex.toLowerCase() : '', known(age) ? `est. ${age.toLowerCase()}` : '']
    .filter(Boolean)
    .join(', ')

  return [head, marksClause, tail].filter(Boolean).join(' · ')
}
```

- [ ] **Step 4: Run the check script and confirm it passes**

Run: `npm run check:describecat`
Expected: `describeCat: ok`

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/data/describeCat.ts app/front-end/src/data/describeCat.check.ts app/front-end/package.json
git commit -m "$(cat <<'EOF'
Add the guided description questions and their pure composer

Five tap-choice questions (fur colour, pattern, marks, sex, age)
compose into the same style of sentence the seeded cats already use,
skipping any clause the admin didn't have an answer for.
EOF
)"
```

---

## Task 3: Field-note quick phrases, built-in and personal

**Files:**
- Create: `app/front-end/src/data/noteChips.ts`
- Create: `app/front-end/src/data/noteChips.check.ts`
- Modify: `app/front-end/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BUILTIN_NOTE_CHIPS: string[]`, `mergeChip(list: string[], phrase: string): string[]`, `readChips(): string[]`, `addChip(phrase: string): string[] | null`.

- [ ] **Step 1: Write the failing check script**

Create `app/front-end/src/data/noteChips.check.ts`:

```typescript
import assert from 'node:assert/strict'
import { BUILTIN_NOTE_CHIPS, mergeChip } from './noteChips'

/* Run: npm run check:notechips. readChips/addChip touch window.localStorage
   and degrade to a no-op under node with no window — same intended
   degradation data/sightings.ts's own check script relies on — so only
   the pure mergeChip is checked directly here. */

assert.deepEqual(mergeChip([], 'Follows the mail carrier'), ['Follows the mail carrier'])

assert.deepEqual(
  mergeChip(['Follows the mail carrier'], 'Follows the mail carrier'),
  ['Follows the mail carrier'],
  'an exact duplicate should not be added twice'
)

assert.deepEqual(
  mergeChip(['Follows the mail carrier'], 'follows the mail carrier'),
  ['Follows the mail carrier'],
  'a duplicate that only differs in case should still be rejected'
)

assert.deepEqual(mergeChip(['a'], '  b  '), ['a', 'b'], 'a phrase should be trimmed before storing')

assert.deepEqual(mergeChip(['a'], ''), ['a'], 'an empty phrase must not be added')
assert.deepEqual(mergeChip(['a'], '   '), ['a'], 'a whitespace-only phrase must not be added')

for (const builtin of BUILTIN_NOTE_CHIPS) {
  assert.deepEqual(
    mergeChip([], builtin),
    [],
    `"${builtin}" duplicates a built-in chip and should not become a personal one too`
  )
}

const long = Array.from({ length: 25 }, (_, i) => `phrase ${i}`)
assert.equal(mergeChip(long, 'newest').length, 20, 'the personal list should be capped, not grow without bound')
assert.ok(mergeChip(long, 'newest').includes('newest'), 'the newest phrase should survive the cap')
assert.ok(!mergeChip(long, 'newest').includes('phrase 0'), 'the cap should drop the oldest entries, not the newest')

console.log('noteChips: ok')
```

- [ ] **Step 2: Add the npm script and confirm the check fails**

```json
    "check:notechips": "tsc src/data/noteChips.check.ts --outDir node_modules/.tmp/ncheck --module commonjs --target es2022 --esModuleInterop --skipLibCheck && node node_modules/.tmp/ncheck/data/noteChips.check.js",
```

Run: `npm run check:notechips`
Expected: FAIL — `noteChips.ts` doesn't exist.

- [ ] **Step 3: Implement `noteChips.ts`**

```typescript
/* Field-note quick phrases for Step 3 of ui/RecordCat.tsx: tap one and it
   inserts into the note text box (still freely editable after — this is a
   head start, not a replacement for typing; see the design spec's own
   pushback on why the note stays free text).

   Two lists. BUILTIN_NOTE_CHIPS never changes at runtime. The personal
   list is this browser's own, saved the same way data/localCats.ts and
   data/sightings.ts already persist their own local lists: read, validate,
   write, degrade to empty on anything wrong rather than throwing. */

export const BUILTIN_NOTE_CHIPS: string[] = [
  'Friendly with people',
  'Shy, keeps distance',
  'Vocal, meows a lot',
  'Food-motivated',
  'Territorial with other cats',
  'Follows joggers / people',
  'Sleeps in the same spot',
  'Grooms itself often',
]

const KEY = 'meowtro.noteChips.v1'

/** A personal list capped well short of anything that would make the chip
    row itself the long-form problem this whole redesign exists to fix. */
const MAX_CHIPS = 20

/** The pure half: given the current personal list and a freshly typed
    phrase, returns the list it should become. Trims, drops anything empty,
    rejects a case-insensitive duplicate of either list (a built-in phrase
    typed out by hand should tap the existing chip, not grow a second one
    beside it), and caps the length by dropping the oldest entries — newest
    phrases are the ones an admin is most likely to reach for again. */
export function mergeChip(list: string[], phrase: string): string[] {
  const trimmed = phrase.trim()
  if (!trimmed) return list
  const seen = new Set([...BUILTIN_NOTE_CHIPS, ...list].map((entry) => entry.toLowerCase()))
  if (seen.has(trimmed.toLowerCase())) return list
  const next = [...list, trimmed]
  return next.length > MAX_CHIPS ? next.slice(next.length - MAX_CHIPS) : next
}

function isChipList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** This browser's saved phrases. Same defensive read every other
    localStorage-backed list in this app uses: a hand-edited or truncated
    value degrades to "no personal phrases" rather than throwing. */
export function readChips(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return isChipList(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Saves a new phrase and returns the resulting list, or null if the write
    failed (quota, private mode) — same shape data/localCats.ts's
    writeStored gives its caller, so the panel can say saving failed
    instead of pretending it worked. */
export function addChip(phrase: string): string[] | null {
  const next = mergeChip(readChips(), phrase)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the check script and confirm it passes**

Run: `npm run check:notechips`
Expected: `noteChips: ok`

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/data/noteChips.ts app/front-end/src/data/noteChips.check.ts app/front-end/package.json
git commit -m "$(cat <<'EOF'
Add field-note quick phrases: built-in chips plus a saved personal set

mergeChip is the checkable pure half (trim, dedupe against both lists,
cap at 20); readChips/addChip persist it to this browser the same way
localCats.ts and sightings.ts already persist their own local lists.
EOF
)"
```

---

## Task 4: Admin-authored sightings for the extra-photo gallery

**Files:**
- Modify: `app/front-end/src/data/sightings.ts`
- Modify: `app/front-end/src/data/sightings.check.ts`
- Modify: `app/front-end/src/data/catsRepo.ts`

**Interfaces:**
- Consumes: `Shape`, `CatDraft` (now carrying `shape` and `extraPhotos`) from Task 1.
- Produces: `buildAdminSighting(catId: string, point: [number, number], at: number, photo: string, order: number): Sighting`, `addAdminSighting(...): Sighting | null` (same params), both from `sightings.ts`. `catsRepo.addCat` now creates one surveyed sighting per extra photo.

- [ ] **Step 1: Extend the failing check script**

Add to the bottom of `app/front-end/src/data/sightings.check.ts` (before the final `console.log('sightings: ok')`):

```typescript
// --- buildAdminSighting, this redesign -----------------------------------
// The pure half of addAdminSighting, checked directly for the same reason
// applyVote is above: addAdminSighting itself degrades to a no-op under
// node (no window.localStorage to write to).

const built = buildAdminSighting('milo', [121.05, 14.55], 1000, 'data:image/jpeg;base64,xyz', 2)
assert.equal(built.catId, 'milo')
assert.deepEqual(built.point, [121.05, 14.55])
assert.equal(built.at, 1000)
assert.equal(built.photo, 'data:image/jpeg;base64,xyz')
assert.equal(built.order, 2)
assert.equal(
  built.status,
  'surveyed',
  'an admin-authored sighting must land surveyed — it is already at the trust level a new cat record itself skips review at, and it has to show in the photo pile immediately'
)
assert.ok(built.id.length > 0, 'buildAdminSighting produced an empty id')

const builtAgain = buildAdminSighting('milo', [121.05, 14.55], 1000, 'data:image/jpeg;base64,xyz', 2)
assert.notEqual(built.id, builtAgain.id, 'two calls with identical inputs collided on id')

console.log('buildAdminSighting: ok')
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm run check:sightings`
Expected: FAIL — `buildAdminSighting` is not exported yet.

- [ ] **Step 3: Implement `buildAdminSighting`/`addAdminSighting` in `sightings.ts`**

Add directly below the existing `addSighting`:

```typescript
/** An admin's own sighting, created alongside a new cat record rather than
    submitted for review. The pure half: builds the record without
    touching storage, so it is checkable under node the same way applyVote
    is (see that function's own note).

    `status: 'surveyed'` directly, unlike addSighting's `pending` above —
    an admin attaching a photo while creating the cat record is already at
    the same trust level as the cat record itself, which never goes
    through review at all (ui/RecordCat.tsx's own note on why only
    sightings need it). `order` lets several bootstrap photos stack in the
    sequence they were uploaded, using the field reorderSighting already
    built for manual stack sequencing. */
export function buildAdminSighting(
  catId: string,
  point: [number, number],
  at: number,
  photo: string,
  order: number
): Sighting {
  return {
    id: `${catId}-${at}-${order}-${Math.random().toString(36).slice(2, 7)}`,
    catId,
    point,
    at,
    status: 'surveyed',
    photo,
    order,
  }
}

/** Persists buildAdminSighting's record. Returns null on write failure
    (quota, private mode), same contract every other writer in this file
    already gives its caller. */
export function addAdminSighting(
  catId: string,
  point: [number, number],
  at: number,
  photo: string,
  order: number
): Sighting | null {
  const sighting = buildAdminSighting(catId, point, at, photo, order)
  return write([...readSightings(), sighting]) ? sighting : null
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm run check:sightings`
Expected: `buildAdminSighting: ok` then `sightings: ok`

- [ ] **Step 5: Wire `catsRepo.addCat` to create a sighting per extra photo**

In `app/front-end/src/data/catsRepo.ts`, add `addAdminSighting` to the existing `sightings` import block, and update `addCat`:

```typescript
import {
  addAdminSighting,
  allSightings,
  // ...existing imports unchanged
```

```typescript
export async function addCat(draft: CatDraft): Promise<Cat | null> {
  const name = draft.name.trim()
  if (!name) return null

  const stored = readStored()
  const taken = new Set([...CATS, ...stored.map((entry) => entry.cat)].map((cat) => cat.id))

  const base = slugify(name)
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const cat: Cat = {
    id,
    name: name.toUpperCase(),
    plate: `PLATE ${String(CATS.length + stored.length + 1).padStart(2, '0')}`,
    line: draft.line.trim() || 'LINE 00 · FIELD ENTRY',
    colour: draft.colour,
    description: draft.description.trim(),
    firstRecorded: MONTH.format(new Date()),
    range: `About ${Math.round(draft.radiusM * 2)} m across, centred on the recorded point`,
    disposition: 'Not yet observed',
    note: draft.note.trim() || undefined,
    coordinates: formatCoordinates(draft.center),
    photo: draft.photo.trim(),
  }

  if (!writeStored([...stored, { cat, center: draft.center, radiusM: draft.radiusM, shape: draft.shape }])) {
    return null
  }

  /* Every extra photo becomes its own surveyed sighting, pointed at the
     same territory centre — the only coordinate this flow has. This is
     what feeds the plate's existing photo pile (plate/Plate.tsx's
     CardStack); no display code changes for it. A photo that fails to
     save here is silently dropped rather than failing the whole submit:
     the cat itself is already safely stored by this point, and losing one
     gallery photo to a quota edge is a smaller problem than losing the
     cat record over it. */
  const now = Date.now()
  draft.extraPhotos.forEach((photo, index) => {
    addAdminSighting(cat.id, draft.center, now, photo, index)
  })

  return cat
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no errors from `catsRepo.ts` or `sightings.ts`. (`RecordCat.tsx` still has its pending `circleRing` error from Task 1 until Task 6.)

- [ ] **Step 7: Commit**

```bash
git add app/front-end/src/data/sightings.ts app/front-end/src/data/sightings.check.ts app/front-end/src/data/catsRepo.ts
git commit -m "$(cat <<'EOF'
Let addCat seed the photo pile from extra upload photos

buildAdminSighting/addAdminSighting create already-surveyed sightings
(an admin's own photo is already trusted, unlike a visitor's pending
report) so they show up in the plate's existing photo stack with no
new display code.
EOF
)"
```

---

## Task 5: Client-side photo compression

**Files:**
- Create: `app/front-end/src/ui/imageToDataUrl.ts`

**Interfaces:**
- Produces: `compressImage(file: File, maxDim: number, quality: number): Promise<string>`.

No check script: `Image`/`HTMLCanvasElement` are browser APIs with no node equivalent, the same reason nothing under `app/front-end/src/map/` has one either. Verified by `npx tsc -b` here and by the manual gate in Task 6, where it's first actually called from the UI.

- [ ] **Step 1: Implement `imageToDataUrl.ts`**

```typescript
/* Turns an uploaded photo into a compressed data-URI string, small enough
   that a handful of them still fit in the 5-10MB localStorage quota this
   whole app is built around (root CLAUDE.md: no backend). Without this
   step a single modern phone photo (often several MB) could use up most
   of that quota on its own — this is load-bearing, not a nicety, per the
   design spec's §3.

   No check script: FileReader, Image and canvas have no node equivalent,
   the same reason nothing under src/map/ has one either. Verified by
   tsc -b plus the manual gate where ui/RecordCat.tsx first calls this. */

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

/** Downscales `file` so its longest edge is at most `maxDim` pixels
    (never upscales a smaller image) and re-encodes it as JPEG at
    `quality` (0-1). Rejects if the file cannot be read as an image at
    all — the caller is expected to catch this and show it as a form
    error, the same way ui/RecordCat.tsx already surfaces a storage
    failure. */
export async function compressImage(file: File, maxDim: number, quality: number): Promise<string> {
  const raw = await readAsDataUrl(file)
  const img = await loadImage(raw)

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not compress the image')
  ctx.drawImage(img, 0, 0, width, height)

  return canvas.toDataURL('image/jpeg', quality)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add app/front-end/src/ui/imageToDataUrl.ts
git commit -m "$(cat <<'EOF'
Add client-side photo compression for the upload flow

Downscales to a bounded longest edge and re-encodes as JPEG before a
photo ever reaches localStorage, since there is no server to hand
that job to.
EOF
)"
```

---

## Task 6: Wizard shell + Step 1 (Photo)

**Files:**
- Modify: `app/front-end/src/ui/RecordCat.tsx`
- Modify: `app/front-end/src/shell.css`

**Interfaces:**
- Consumes: `Shape`, `SHAPES`, `shapeRing` (Task 1); `CoatAnswers`, `EMPTY_ANSWERS`, `composeDescription` (Task 2, wired in Task 7); `compressImage` (Task 5); `addCat` now expecting `shape`/`extraPhotos` on its draft (Task 1/4).
- Produces: the wizard's step state (`step`, `setStep`), a `WizardNav` pattern later steps reuse, `form.photo`/`form.extraPhotos` wired to real uploads.

This task restructures the whole panel into the four-step shell and fully implements Step 1; Steps 2-4 are stubbed as pass-through so the file compiles and is manually testable end-to-end, then Task 7/8 fill them in.

- [ ] **Step 1: Rewrite `RecordCat.tsx`**

Replace the whole file:

```tsx
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { MapPin, Plus, X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { addCat, clearRecorded, countRecorded } from '@/data/catsRepo'
import { CAT_COLOURS, type Colour } from '@/data/cats.seed'
import { SHAPES, shapeRing, type Shape } from '@/data/localCats'
import { compressImage } from './imageToDataUrl'
import { spring, springSoft } from '@/motion/springs'

/* Add a new cat: the panel that adds one to the survey.

   ## Parked, on purpose, and not dead

   This is the ADMIN's tool and it is currently not mounted anywhere. See
   MapCanvas, where its render was replaced by ui/ReportSighting.tsx.

   Adding a cat is a reviewed action: an open "add a cat" on a public map is
   unreviewed data about real animals. Until there are accounts and somebody
   to do the reviewing, a visitor's only contribution is a sighting. Mount
   this again behind the role check and nothing else about it has to change.

   Do not delete it on the grounds that nothing imports it. That is the
   state it is meant to be in.

   ## Four steps, not one long form

   Rev 2026-08-26: guided description questions, an upload gallery and a
   shape picker together made the original single-page form long enough
   that "too long" stopped being a nitpick. Each step keeps its own local
   validation; the one check with no input behind it (a territory must be
   placed) still lives on final submit, same as it always did.

   ## The territory is drawn, not typed

   You click the map to say roughly where the cat lives and drag a radius
   around it; what gets stored is one of four warped-circle polygons (see
   data/localCats.ts's shapeRing). This is not a nicety: spec §9 forbids
   this app from holding an exact location for a real animal, and a form
   with a "location" box in it is exactly how that rule gets broken by
   accident.

   ## Why it lives inside <MapCanvas>

   It is a fixed HUD panel, like MapControls, and like MapControls it needs
   the map instance: to take a click, to draw the preview and to stop
   Territories selecting a cat with the click that places a point. useMap()
   only resolves inside the provider, so this renders there rather than
   beside the rail, where it visually appears to belong. */

const PREVIEW = 'record-preview'
const PREVIEW_FILL = 'record-preview-fill'
const PREVIEW_LINE = 'record-preview-line'

/** Radius bounds in metres. The floor is about a building's footprint and
    the ceiling about two city blocks, which brackets every seeded territory.
    Anything tighter starts to claim a precision this app will not state. */
const MIN_RADIUS = 30
const MAX_RADIUS = 250

/** The longest edge and JPEG quality every uploaded photo is compressed
    to, matching the seeded photos' own size (data/cats.seed.ts's CATAAS
    helper). Not a knob a user sees — see ui/imageToDataUrl.ts's own note
    on why this is load-bearing rather than tunable polish. */
const PHOTO_MAX_DIM = 640
const PHOTO_QUALITY = 0.75
const MAX_EXTRA_PHOTOS = 6

const COLOURS = CAT_COLOURS

const STEPS = ['Photo', 'Identity', 'Character & look', 'Place & review'] as const

type ExtraPhoto = { id: string; src: string }

const EMPTY_FORM = {
  name: '',
  description: '',
  note: '',
  photo: '',
  line: '',
  colour: CAT_COLOURS[0].token as Colour,
  shape: 'round' as Shape,
}

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function RecordCat({ onRecorded }: { onRecorded: () => void }) {
  const { map, isLoaded, placing, setPlacing } = useMap()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY_FORM)
  const [extraPhotos, setExtraPhotos] = useState<ExtraPhoto[]>([])
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [radiusM, setRadiusM] = useState(90)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recorded, setRecorded] = useState(0)

  const reset = () => {
    setStep(0)
    setForm(EMPTY_FORM)
    setExtraPhotos([])
    setCenter(null)
    setRadiusM(90)
    setError(null)
    setPlacing(false)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placing) setPlacing(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, placing, setPlacing])

  useEffect(() => {
    if (!map || !placing) return
    document.body.dataset.placing = 'true'
    const onClick = (e: MapMouseEvent) => {
      e.preventDefault()
      setCenter([e.lngLat.lng, e.lngLat.lat])
      setPlacing(false)
      setError(null)
    }
    map.once('click', onClick)
    return () => {
      delete document.body.dataset.placing
      map.off('click', onClick)
    }
  }, [map, placing, setPlacing])

  useEffect(() => {
    if (!map || !isLoaded || !open) return
    if (!map.getSource(PREVIEW)) {
      map.addSource(PREVIEW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: PREVIEW_FILL,
        type: 'fill',
        source: PREVIEW,
        paint: { 'fill-color': token('--rust'), 'fill-opacity': 0.28 },
      })
      map.addLayer({
        id: PREVIEW_LINE,
        type: 'line',
        source: PREVIEW,
        paint: {
          'line-color': token('--rust'),
          'line-width': 1.5,
          'line-dasharray': [2, 2],
        },
      })
    }
    return () => {
      for (const id of [PREVIEW_LINE, PREVIEW_FILL]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(PREVIEW)) map.removeSource(PREVIEW)
    }
  }, [map, isLoaded, open])

  useEffect(() => {
    if (!map || !open) return
    const source = map.getSource(PREVIEW) as GeoJSONSource | undefined
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features: center
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [shapeRing(form.shape, center, radiusM)] },
            },
          ]
        : [],
    })
    if (map.getLayer(PREVIEW_FILL)) {
      map.setPaintProperty(PREVIEW_FILL, 'fill-color', token(form.colour))
      map.setPaintProperty(PREVIEW_LINE, 'line-color', token(form.colour))
    }
  }, [map, open, center, radiusM, form.shape, form.colour])

  const pickMainPhoto = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const compressed = await compressImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
      setForm((f) => ({ ...f, photo: compressed }))
    } catch {
      setError('Could not read that photo. Try a different file.')
    }
  }

  const pickExtraPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    const room = MAX_EXTRA_PHOTOS - extraPhotos.length
    const picked = Array.from(files).slice(0, room)
    try {
      const compressed = await Promise.all(picked.map((file) => compressImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY)))
      setExtraPhotos((prev) => [
        ...prev,
        ...compressed.map((src, i) => ({ id: `${Date.now()}-${i}`, src })),
      ])
    } catch {
      setError('Could not read one of those photos. Try again.')
    }
  }

  const removeExtraPhoto = (id: string) => {
    setExtraPhotos((prev) => prev.filter((photo) => photo.id !== id))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!center) {
      setError('Place the territory on the map first.')
      return
    }
    setBusy(true)
    const cat = await addCat({
      ...form,
      center,
      radiusM,
      extraPhotos: extraPhotos.map((photo) => photo.src),
    })
    setBusy(false)
    if (!cat) {
      setError('Could not save. This browser may have storage turned off.')
      return
    }
    onRecorded()
    close()
  }

  const canAdvance = step === 0 ? !!form.photo : true
  const isLastStep = step === STEPS.length - 1

  return (
    <>
      <motion.button
        type="button"
        className="record-open"
        aria-label="Add a new cat"
        data-open={String(open)}
        onClick={() => {
          if (open) return close()
          setRecorded(countRecorded())
          setOpen(true)
        }}
        whileTap={{ scale: 0.94 }}
        transition={spring}
      >
        <Plus size={15} />
        <span>Add a new cat</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.form
            className="record"
            onSubmit={submit}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={springSoft}
            aria-label="Add a new cat"
          >
            <div className="record-head">
              <h2>New cat — {STEPS[step]}</h2>
              <button type="button" className="record-close" aria-label="Cancel" onClick={close}>
                <X size={15} />
              </button>
            </div>

            <div className="record-progress" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
              {STEPS.map((label, i) => (
                <span key={label} data-on={String(i === step)} aria-label={label} />
              ))}
            </div>

            <div className="record-body">
              {step === 0 && (
                <>
                  <label className="record-field">
                    <span className="record-label">Photo</span>
                    <div className="record-photo-row">
                      {form.photo && <img className="record-thumb" src={form.photo} alt="" />}
                      <input
                        className="record-file"
                        type="file"
                        accept="image/*"
                        required={!form.photo}
                        onChange={(e) => pickMainPhoto(e.target.files?.[0])}
                      />
                    </div>
                  </label>

                  <div className="record-field">
                    <span className="record-label">More photos (optional)</span>
                    <div className="record-gallery">
                      {extraPhotos.map((photo) => (
                        <div key={photo.id} className="record-gallery-item">
                          <img src={photo.src} alt="" />
                          <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => removeExtraPhoto(photo.id)}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                      {extraPhotos.length < MAX_EXTRA_PHOTOS && (
                        <label className="record-gallery-add">
                          <Plus size={16} />
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => pickExtraPhotos(e.target.files)}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </>
              )}

              {step === 1 && <p className="record-note">Step 2 lands in the next task.</p>}
              {step === 2 && <p className="record-note">Step 3 lands in the next task.</p>}
              {step === 3 && (
                <>
                  <div className="record-field">
                    <span className="record-label">Territory</span>
                    <button
                      type="button"
                      className="record-place"
                      data-on={String(placing)}
                      onClick={() => setPlacing(!placing)}
                    >
                      <MapPin size={13} />
                      {placing
                        ? 'Click the map…'
                        : center
                          ? `${center[1].toFixed(4)}, ${center[0].toFixed(4)}`
                          : 'Place on the map'}
                    </button>
                    <label className="record-radius">
                      <span>Rough size</span>
                      <input
                        type="range"
                        min={MIN_RADIUS}
                        max={MAX_RADIUS}
                        step={10}
                        value={radiusM}
                        onChange={(e) => setRadiusM(Number(e.target.value))}
                        disabled={!center}
                      />
                      <span className="record-radius-value">{radiusM * 2} m</span>
                    </label>
                  </div>
                </>
              )}

              {error && (
                <p className="record-error" role="alert" aria-live="polite">
                  {error}
                </p>
              )}
            </div>

            <div className="record-foot">
              {step > 0 ? (
                <button type="button" className="record-back" onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              ) : (
                <span className="record-note">
                  Saved in this browser only.
                  {recorded > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="record-clear"
                        onClick={() => {
                          clearRecorded()
                          setRecorded(0)
                          onRecorded()
                        }}
                      >
                        Clear {recorded} recorded
                      </button>
                    </>
                  )}
                </span>
              )}
              {isLastStep ? (
                <button type="submit" className="record-save" disabled={busy}>
                  {busy ? 'Saving…' : 'Add cat'}
                </button>
              ) : (
                <button
                  type="button"
                  className="record-save"
                  disabled={!canAdvance}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next
                </button>
              )}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  )
}
```

- [ ] **Step 2: Add the wizard/photo CSS**

Add to `app/front-end/src/shell.css`, directly after the existing `.record-head h2` rule block:

```css
.record-progress {
  display: flex;
  gap: var(--s-1);
  padding: 0 var(--s-4) var(--s-2);
}
.record-progress span {
  flex: 1;
  height: 3px;
  border-radius: 999px;
  background: var(--rule);
}
.record-progress span[data-on='true'] {
  background: var(--accent);
}

.record-back {
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: none;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-soft);
  cursor: pointer;
}
.record-save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.record-photo-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}
.record-thumb {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: calc(var(--radius) * 0.4);
  object-fit: cover;
  border: 1px solid var(--rule);
}
.record-file {
  flex: 1;
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  color: var(--ink-soft);
}

.record-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.record-gallery-item {
  position: relative;
  width: 3rem;
  height: 3rem;
}
.record-gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: calc(var(--radius) * 0.4);
  border: 1px solid var(--rule);
}
.record-gallery-item button {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 1rem;
  height: 1rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 0;
  background: var(--rust);
  color: var(--paper);
  cursor: pointer;
  padding: 0;
}
.record-gallery-add {
  width: 3rem;
  height: 3rem;
  display: grid;
  place-items: center;
  border: 1px dashed var(--rule-strong);
  border-radius: calc(var(--radius) * 0.4);
  color: var(--ink-soft);
  cursor: pointer;
}
.record-gallery-add input {
  display: none;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Manual visual gate**

This is a UI change with no automated test — same as every other `RecordCat.tsx` change in this project's history. Run `npm run dev` (or use the one already running — do not start a second one), open `/app.html?role=admin`, click "Add a new cat", and confirm by eye:
- The button reads "Add a new cat", not "Record a cat".
- Four progress dots show, the first one lit.
- Step 1 shows a required main-photo file input; picking a file shows a thumbnail.
- "More photos" accepts multiple files and shows removable thumbnails, up to 6.
- "Next" is disabled until a main photo is picked; clicking it advances to Step 2's placeholder text.
- Stepping forward to Step 4 shows the territory place/radius controls working exactly as before (click map, drag slider, dashed preview follows).
- Submitting on Step 4 without a placed point still shows "Place the territory on the map first."

Take this to the human running the session for a screenshot-based review before continuing — this project's own CLAUDE.md says visual gates close on a screenshot, not on an agent driving the browser itself.

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/ui/RecordCat.tsx app/front-end/src/shell.css
git commit -m "$(cat <<'EOF'
Rebuild RecordCat as a four-step wizard, ship Step 1 (Photo)

Renames "Record a cat" to "Add a new cat", adds the progress dots and
Back/Next shell, and replaces the photo-link input with a required
upload plus an optional multi-photo gallery, both compressed
client-side before they ever reach localStorage. Steps 2-3 are
placeholders, filled in by the next task.
EOF
)"
```

---

## Task 7: Step 2 (Identity) and Step 3 (Character & look)

**Files:**
- Modify: `app/front-end/src/ui/RecordCat.tsx`
- Modify: `app/front-end/src/shell.css`

**Interfaces:**
- Consumes: `UNKNOWN`, `FUR_COLOURS`, `PATTERNS`, `MARKS`, `SEXES`, `AGES`, `CoatAnswers`, `EMPTY_ANSWERS`, `composeDescription` (Task 2); `BUILTIN_NOTE_CHIPS`, `readChips`, `addChip` (Task 3); `SHAPES` (Task 1, already imported in Task 6).
- Produces: `form.description` and `form.note` now populated by these steps instead of typed directly; `answers` state.

- [ ] **Step 1: Add imports and state**

In `RecordCat.tsx`, add to the imports:

```typescript
import {
  AGES,
  composeDescription,
  EMPTY_ANSWERS,
  FUR_COLOURS,
  MARKS,
  PATTERNS,
  SEXES,
  UNKNOWN,
  type CoatAnswers,
} from '@/data/describeCat'
import { addChip, BUILTIN_NOTE_CHIPS, readChips } from '@/data/noteChips'
```

Add state alongside the existing `form`/`extraPhotos` state:

```typescript
const [answers, setAnswers] = useState<CoatAnswers>(EMPTY_ANSWERS)
const [customMark, setCustomMark] = useState('')
const [showCustomMark, setShowCustomMark] = useState(false)
const [myChips, setMyChips] = useState<string[]>([])
const [customChip, setCustomChip] = useState('')
const [showCustomChip, setShowCustomChip] = useState(false)
```

Load the personal chip list when the panel opens (extends the existing open-handler in the trigger button):

```typescript
onClick={() => {
  if (open) return close()
  setRecorded(countRecorded())
  setMyChips(readChips())
  setOpen(true)
}}
```

Keep `description` composed from `answers` on every change, and reset `answers`/mark-input state in `reset()`:

```typescript
useEffect(() => {
  setForm((f) => ({ ...f, description: composeDescription(answers) }))
}, [answers])
```

```typescript
const reset = () => {
  setStep(0)
  setForm(EMPTY_FORM)
  setExtraPhotos([])
  setAnswers(EMPTY_ANSWERS)
  setCustomMark('')
  setShowCustomMark(false)
  setCustomChip('')
  setShowCustomChip(false)
  setCenter(null)
  setRadiusM(90)
  setError(null)
  setPlacing(false)
}
```

- [ ] **Step 2: Fix the advance-gate now that Name has moved off Step 1**

Task 6's `canAdvance` only checked the photo, because Name didn't exist as
a rendered input anywhere yet — the original form's `required` on that
input only ever fires for a field that's actually mounted at submit time,
and once Name moves to Step 2, staying on Step 0's photo-only check would
let an admin tab straight past it. Replace `canAdvance` with:

```typescript
const canAdvance = step === 0 ? !!form.photo : step === 1 ? !!form.name.trim() : true
```

- [ ] **Step 3: Implement Step 2 (Identity)**

Replace `{step === 1 && <p className="record-note">Step 2 lands in the next task.</p>}` with:

```tsx
{step === 1 && (
  <>
    <label className="record-field">
      <span className="record-label">Name</span>
      <input
        className="record-input"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Mingming"
        maxLength={40}
        required
        autoFocus
      />
    </label>

    <SingleChoice
      label="Fur colour"
      options={FUR_COLOURS}
      value={answers.furColour}
      onChange={(furColour) => setAnswers((a) => ({ ...a, furColour }))}
    />
    <SingleChoice
      label="Pattern"
      options={PATTERNS}
      value={answers.pattern}
      onChange={(pattern) => setAnswers((a) => ({ ...a, pattern }))}
    />

    <fieldset className="record-field record-colours">
      <legend className="record-label">Distinguishing marks</legend>
      {MARKS.map((mark) => (
        <button
          key={mark}
          type="button"
          className="record-pill"
          data-on={String(answers.marks.includes(mark))}
          onClick={() =>
            setAnswers((a) => ({
              ...a,
              marks: a.marks.includes(mark) ? a.marks.filter((m) => m !== mark) : [...a.marks, mark],
            }))
          }
        >
          {mark}
        </button>
      ))}
      {answers.marks
        .filter((mark) => !(MARKS as readonly string[]).includes(mark))
        .map((mark) => (
          <button
            key={mark}
            type="button"
            className="record-pill"
            data-on="true"
            onClick={() => setAnswers((a) => ({ ...a, marks: a.marks.filter((m) => m !== mark) }))}
          >
            {mark}
          </button>
        ))}
      <button type="button" className="record-pill record-pill-add" onClick={() => setShowCustomMark(true)}>
        + Custom
      </button>
    </fieldset>
    {showCustomMark && (
      <div className="record-inline-add">
        <input
          className="record-input"
          value={customMark}
          onChange={(e) => setCustomMark(e.target.value)}
          placeholder='e.g. "kinked tail"'
          maxLength={30}
        />
        <button
          type="button"
          className="record-save"
          onClick={() => {
            const value = customMark.trim()
            if (value) setAnswers((a) => ({ ...a, marks: [...a.marks, value] }))
            setCustomMark('')
            setShowCustomMark(false)
          }}
        >
          Add
        </button>
      </div>
    )}

    <SingleChoice label="Sex" options={SEXES} value={answers.sex} onChange={(sex) => setAnswers((a) => ({ ...a, sex }))} />

    <fieldset className="record-field record-colours">
      <legend className="record-label">Age</legend>
      {AGES.map(({ id, hint }) => (
        <button
          key={id}
          type="button"
          className="record-pill"
          data-on={String(answers.age === id)}
          onClick={() => setAnswers((a) => ({ ...a, age: id }))}
        >
          {id}
          {hint && <small>{hint}</small>}
        </button>
      ))}
    </fieldset>

    <p className="record-preview">
      Description: <strong>{form.description || '—'}</strong>
    </p>
  </>
)}
```

Add the small reusable `SingleChoice` component in the same file, above `export function RecordCat`:

```tsx
function SingleChoice({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="record-field record-colours">
      <legend className="record-label">{label}</legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="record-pill"
          data-on={String(value === option)}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </fieldset>
  )
}
```

- [ ] **Step 4: Implement Step 3 (Character & look)**

Replace `{step === 2 && <p className="record-note">Step 3 lands in the next task.</p>}` with:

```tsx
{step === 2 && (
  <>
    <label className="record-field">
      <span className="record-label">Field note</span>
      <textarea
        className="record-input"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
        placeholder="One thing you noticed that is not a measurement."
        maxLength={220}
        rows={2}
      />
    </label>

    <div className="record-field record-colours">
      {BUILTIN_NOTE_CHIPS.map((phrase) => (
        <button
          key={phrase}
          type="button"
          className="record-pill"
          onClick={() => setForm((f) => ({ ...f, note: f.note ? `${f.note} ${phrase}.` : `${phrase}.` }))}
        >
          {phrase}
        </button>
      ))}
      {myChips.map((phrase) => (
        <button
          key={phrase}
          type="button"
          className="record-pill record-pill-mine"
          onClick={() => setForm((f) => ({ ...f, note: f.note ? `${f.note} ${phrase}.` : `${phrase}.` }))}
        >
          {phrase}
        </button>
      ))}
      <button type="button" className="record-pill record-pill-add" onClick={() => setShowCustomChip(true)}>
        + Add your own
      </button>
    </div>
    {showCustomChip && (
      <div className="record-inline-add">
        <input
          className="record-input"
          value={customChip}
          onChange={(e) => setCustomChip(e.target.value)}
          placeholder="A phrase you use often…"
          maxLength={60}
        />
        <button
          type="button"
          className="record-save"
          onClick={() => {
            const saved = addChip(customChip)
            if (saved) setMyChips(saved)
            setCustomChip('')
            setShowCustomChip(false)
          }}
        >
          Save
        </button>
      </div>
    )}

    <fieldset className="record-field record-colours">
      <legend className="record-label">Territory colour</legend>
      {COLOURS.map(({ token: name, label }) => (
        <button
          key={name}
          type="button"
          className="record-swatch"
          style={{ '--swatch': `var(${name})` } as React.CSSProperties}
          data-on={String(form.colour === name)}
          aria-pressed={form.colour === name}
          onClick={() => setForm({ ...form, colour: name })}
        >
          <span aria-hidden />
          {label}
        </button>
      ))}
    </fieldset>

    <fieldset className="record-field record-colours">
      <legend className="record-label">Territory shape</legend>
      {SHAPES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className="record-pill"
          data-on={String(form.shape === id)}
          onClick={() => setForm({ ...form, shape: id })}
        >
          {label}
        </button>
      ))}
    </fieldset>
  </>
)}
```

- [ ] **Step 5: Add the pill/preview CSS**

Add to `shell.css`, after the `.record-swatch[data-on='true']` rule:

```css
.record-pill {
  padding: 3px var(--s-2);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: none;
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  color: var(--ink-soft);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.3;
}
.record-pill small {
  font-size: 0.5rem;
  color: var(--ink-soft);
  opacity: 0.75;
}
.record-pill[data-on='true'] {
  border-color: var(--accent);
  color: var(--ink);
  font-weight: 600;
}
.record-pill-mine {
  border-style: dashed;
  border-color: var(--sage);
}
.record-pill-add {
  color: var(--ink-soft);
  border-style: dashed;
}

.record-inline-add {
  display: flex;
  gap: var(--s-2);
  align-items: center;
}
.record-inline-add .record-input {
  flex: 1;
}

.record-preview {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.record-preview strong {
  color: var(--ink);
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Manual visual gate**

Same manual process as Task 6's Step 4 — no automated UI test exists in this project. Walk through Step 2 and Step 3 and confirm by eye:
- Fur colour, pattern, sex and age each behave as single-choice (picking one deselects any other in that row).
- The description preview line updates live as questions are answered, and correctly omits a "Don't know" clause.
- Distinguishing marks behave as multi-select; "+ Custom" opens an inline input and adds a new, immediately-selected pill.
- Field note chips insert their phrase into the textbox on click without clearing what's already typed.
- "+ Add your own" saves a phrase, shows it immediately as a dashed-border chip, and — after closing and reopening the panel — the saved phrase is still there (confirms `noteChips.ts` persistence actually round-trips through `localStorage` in a real browser, not just under the check script).
- The four shape pills and eight colour swatches both show a clear selected state.

Take this to the human running the session for a screenshot-based review before continuing.

- [ ] **Step 8: Commit**

```bash
git add app/front-end/src/ui/RecordCat.tsx app/front-end/src/shell.css
git commit -m "$(cat <<'EOF'
Ship Step 2 (Identity) and Step 3 (Character & look)

Five tap-choice questions replace the free-text description, with a
live composed preview. Field note keeps free text, backed by
tap-to-insert chips (built-in plus a personal, persisted set). Adds
the territory shape picker next to the existing colour picker.
EOF
)"
```

---

## Task 8: Step 4 (Place & review) and final wiring

**Files:**
- Modify: `app/front-end/src/ui/RecordCat.tsx`
- Modify: `app/front-end/src/shell.css`

**Interfaces:**
- Consumes: everything from Tasks 1-7. No new exports — this is the last task and closes the loop end to end.

- [ ] **Step 1: Add the review summary to Step 4**

Replace the Step 4 block from Task 6 with the same territory controls plus a summary section above the error message:

```tsx
{step === 3 && (
  <>
    <div className="record-field">
      <span className="record-label">Territory</span>
      <button
        type="button"
        className="record-place"
        data-on={String(placing)}
        onClick={() => setPlacing(!placing)}
      >
        <MapPin size={13} />
        {placing
          ? 'Click the map…'
          : center
            ? `${center[1].toFixed(4)}, ${center[0].toFixed(4)}`
            : 'Place on the map'}
      </button>
      <label className="record-radius">
        <span>Rough size</span>
        <input
          type="range"
          min={MIN_RADIUS}
          max={MAX_RADIUS}
          step={10}
          value={radiusM}
          onChange={(e) => setRadiusM(Number(e.target.value))}
          disabled={!center}
        />
        <span className="record-radius-value">{radiusM * 2} m</span>
      </label>
    </div>

    <div className="record-summary">
      <p>
        <strong>{form.name || 'Unnamed'}</strong> — {form.description || 'no description yet'}
      </p>
      <p>
        {SHAPES.find((s) => s.id === form.shape)?.label} territory,{' '}
        {COLOURS.find((c) => c.token === form.colour)?.label} ·{' '}
        {1 + extraPhotos.length} photo{extraPhotos.length === 0 ? '' : 's'}
      </p>
    </div>
  </>
)}
```

- [ ] **Step 2: Add the summary CSS**

Add to `shell.css`:

```css
.record-summary {
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--rule);
  border-radius: calc(var(--radius) * 0.4);
  background: var(--well);
}
.record-summary p {
  margin: 0;
  font-size: var(--t-xs);
  color: var(--ink-soft);
  line-height: 1.5;
}
.record-summary strong {
  color: var(--ink);
}
```

- [ ] **Step 3: Typecheck the whole project**

Run: `npx tsc -b`
Expected: no errors anywhere — this is the first point every file touched by this plan compiles together.

- [ ] **Step 4: Full manual walkthrough (the actual end-to-end gate)**

Run `npm run dev` if it is not already running (do not start a second instance), open `/app.html?role=admin`, and complete one full add-a-cat pass:

1. Click "Add a new cat".
2. Step 1: upload a real photo (ideally a large one, several MB, from a phone if available) as the main photo; add two more as "More photos"; remove one of them; confirm "Next" was disabled until the main photo was set.
3. Step 2: type a name; answer all five questions including at least one "Don't know" and two distinguishing marks (one built-in, one custom); confirm the live description preview looks like a real sentence with no stray "· ·" or trailing comma.
4. Step 3: click two field-note chips (confirm both phrases land in the textbox); add and save a custom phrase; pick a territory colour and a non-Round shape.
5. Step 4: click "Place on the map", click a spot; confirm the dashed preview on the map matches the shape chosen in Step 3, not a plain circle; drag the radius slider and confirm the preview resizes; check the review summary text reads correctly.
6. Submit. Confirm the panel closes, the new cat appears in the Rail/CatDeck list immediately (no reload), and opening its plate shows: the compressed main photo as the hero image, the chosen territory shape and colour on the map, and — in the plate's existing photo pile — the extra photos uploaded in Step 1.
7. Open devtools' Application/Storage tab and spot-check that `meowtro.cats.v1` and `meowtro.sightings.v1` both hold reasonably small compressed strings, not multi-megabyte raw uploads.

Take this to the human running the session for the final screenshot-based review — this is the gate the whole feature closes on.

- [ ] **Step 5: Commit**

```bash
git add app/front-end/src/ui/RecordCat.tsx app/front-end/src/shell.css
git commit -m "$(cat <<'EOF'
Ship Step 4 (Place & review), closing the add-a-cat wizard

Adds a plain-text summary of every choice made so far above the
existing place/radius controls. This is the last task in the redesign
plan; the wizard is now feature-complete end to end.
EOF
)"
```

---

## Plan self-review notes

- **Spec coverage:** §1 (label) → Task 6. §2 (shapes) → Task 1, 6, 8. §3 (photo upload + gallery) → Tasks 4, 5, 6. §4 (description questions) → Task 2, 7. §5 (note chips) → Task 3, 7. §6 (wizard) → Tasks 6-8. §7/§8 (data model, files) → covered across all tasks; `Plate.tsx` and `cats.seed.ts` are explicitly left untouched, matching the spec.
- **No placeholders:** every step above either shows real code or, where no automated check is possible (photo compression, the wizard UI itself), says so explicitly and substitutes a concrete manual-verification checklist rather than "add appropriate tests."
- **Type consistency checked:** `Shape` (Task 1) flows unchanged into `CatDraft`/`SHAPES`/`shapeRing` calls in Tasks 6-8; `CoatAnswers`/`composeDescription` (Task 2) match their use in Task 7; `addAdminSighting`'s five-argument signature (Task 4) matches its one call site in `catsRepo.addCat`; `compressImage(file, maxDim, quality)` (Task 5) matches both call sites in Task 6.
