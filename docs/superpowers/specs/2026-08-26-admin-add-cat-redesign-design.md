# Meowtro — admin "add a new cat" redesign

**Created:** 2026-08-26
**Supersedes nothing.** Extends the rev 5 design spec
([`2026-08-16-meowtro-design.md`](./2026-08-16-meowtro-design.md)); every
decision there still stands unless named below, in particular §9's binding
rule that `Cat` never carries an exact location.

---

## 0. Where this came from

`ui/RecordCat.tsx`, the admin-only panel that records a new cat, was built
minimal on purpose: a single flat form (name, description, photo link,
field note, colour, click-and-drag-radius territory). Reviewing it turned
up three real gaps rather than one:

1. The panel's own label ("Record a cat") reads like an internal filing
   term, not what an admin is doing.
2. Two fields ask the admin to invent something from nothing: `description`
   wants a hand-composed sentence, and `photo` wants a hosted URL when
   there is no host to put a photo on.
3. Territory is circle-only. Every *seeded* territory is an irregular
   hand-traced polygon; a recorded cat's territory looks visibly different
   from the ones around it.

Fixing all three, plus letting an admin seed more than one photo per cat,
grows the form enough that it needs to stop being one flat page. That
restructuring is folded into this spec rather than treated as a separate
follow-up, because the field changes and the layout change caused each
other.

**Non-goals**, decided explicitly during brainstorming and not open for
silent scope creep:

- No freehand polygon drawing. Spec §9 forbids stating an exact area a real
  cat actually moves through; a draw tool is the shape of the thing the
  rule exists to prevent. Only pre-built templates.
- No relocation of the entry point. "Add a new cat" (renamed from "Record a
  cat") stays exactly where the panel already lives, in the map's
  admin-controls HUD. It does not move into the Rail/CatDeck list.
- No separate "manage all cats" admin table. The existing Rail/CatDeck
  already lists a recorded cat the instant it's saved; nothing about that
  needs to change.
- No change to the `Cat` type's shape or to any field an admin cannot
  already edit today (`id`, `plate`, `coordinates`, `range` stay derived,
  never typed).

---

## 1. Label

"Record a cat" → "Add a new cat", everywhere the string appears:
`RecordCat.tsx`'s open-button `aria-label` and visible text, the form's own
`aria-label`, and the "New record" → "New cat" panel heading. Cosmetic
only, no behavioural change.

---

## 2. Territory: shape templates

Four templates, each a genuine `Polygon` (nothing here is a "real" circle
primitive — even today's circle is already a 48-point ring, same as every
seeded territory):

| Shape | Description |
|---|---|
| Round | Today's plain circle — zero deformation. |
| Elongated | Stretched along one axis, for a territory that runs along a street. |
| Notched | An inward pinch on one side, for an L-shaped block or a corner lot. |
| Blocky | Squared-off, for a courtyard or a compound. |

**Implementation shape:** `localCats.ts`'s `circleRing(center, radiusM)`
generalizes to `shapeRing(shape, center, radiusM)`. The 48-point loop and
its trig stay exactly as they are; only the per-angle radius changes, from
a constant to `radiusM * deform(shape, angle)`, where `deform` is a small
fixed formula per shape (a sum of one or two sine terms at a fixed
frequency/phase/amplitude — no randomness, no seed, so the same shape
picked twice looks the same, matching what "Round" already promises by
being exactly today's circle). `circleRing` itself is retired in favour of
this; nothing else called it directly.

**Data model:** `CatDraft` and `StoredCat` (`localCats.ts`) both gain
`shape: Shape`, where `Shape = 'round' | 'elongated' | 'notched' |
'blocky'`. `isStored`'s runtime validator checks it's one of the four.
`circleFeature` (renamed `shapeFeature`) reads the stored shape when
rebuilding the polygon for `catsRepo.listTerritories`.

**UI:** a fourth field in the panel, styled with the same swatch-button
pattern the colour picker already uses (`RecordCat.tsx`'s `record-swatch`
buttons) — one small silhouette icon and a label per shape, selected state
identical to how a colour swatch shows selection. The live dashed preview
on the map (already built, `RecordCat.tsx:136-192`) calls `shapeRing`
instead of `circleRing`; nothing else about the preview changes.

---

## 3. Photo: upload instead of a link, plus a gallery

**Main photo.** The `<input type="url">` becomes `<input type="file"
accept="image/*">`. On selection: `FileReader` reads it, an off-screen
`<canvas>` downscales it to ~640px on the longest edge (matching the
seeded photos' own size) at ~0.75 JPEG quality, and the resulting data-URI
string is written into `form.photo` — the same field, same `string` type
`Cat.photo` already has. A thumbnail shows what was picked. Still
`required`; there is no URL fallback.

Compression is load-bearing, not polish: everything lives in
`localStorage` (5–10MB total, shared across every recorded cat), and one
uncompressed phone photo can be several MB on its own.

**Additional photos → the existing photo pile, not a new gallery.** The
plate already renders a scrollable stack of photos (`CardStack` in
`plate/Plate.tsx:338-355,763-766`), sourced from every *surveyed*
`Sighting.photo` for that cat (`catsRepo.listSightings`). Nothing there
needs to change. What's missing is a way for the admin to seed one or more
already-surveyed sightings, each carrying a photo, at the moment the cat is
created.

- `RecordCat.tsx` gets an optional "More photos" multi-file picker
  (same FileReader+canvas compression as the main photo, one pass per
  file), shown as a row of thumbnails with per-photo remove buttons.
- `sightings.ts` gains a new creation function alongside the existing
  `addSighting` (which always writes `status: 'pending'` and takes no
  photo, by design — a visitor's report waits for review). The new
  function writes `status: 'surveyed'` directly, since a photo an admin
  attaches while creating the cat record is already at the same trust
  level as the cat record itself (which skips review entirely). It takes a
  `photo` and an `order` (the existing field built for "admin's manual
  stack sequencing"), so multiple bootstrap photos stack in the order they
  were added.
- `catsRepo.addCat` orchestrates: create the cat, then for each extra photo
  call the new sighting function with `catId`, the same territory `center`
  as the `point` (the only coordinate this flow has), `at: Date.now()`,
  the photo, and a sequential `order`.
- `plate/Plate.tsx` needs **zero changes** — the photo pile already reads
  off surveyed sightings with a photo attached.

---

## 4. Description: five tap-choice questions instead of free text

Replaces the blank `description` text box with five questions, each a
swatch/pill picker (same visual language as the shape and colour pickers
above), composing into the same style of string the seeded cats already
use.

| Question | Options |
|---|---|
| Fur colour | Black · Grey · Orange/Ginger · White · Brown · Calico/Mixed · Don't know |
| Pattern | Solid · Tabby · Tuxedo · Tricolor · Tortoiseshell · Colorpoint · Don't know |
| Distinguishing marks (multi) | White socks · White chest · Bobtail · Notched ear · Long-haired · Short-haired · None · Don't know · **+ Custom** (free text) |
| Sex | Male · Female · Don't know |
| Age | Kitten (<1yr) · Young adult (1-3yr) · Adult (3-7yr) · Senior (7yr+) · Don't know |

A live preview line composes the answers as they're picked (`Grey Tabby ·
white chest · male, est. young adult`), skipping any clause left "Don't
know." `description` stays `required` on submit — the preview line simply
starts empty and fills in as questions are answered. This is presentational
only: `Cat.description` is still one plain string; the five answers are
never stored individually.

---

## 5. Field note: quick-insert chips + a personal, persisted set

The field note stays free text (`Cat.note`) — per the code's own existing
comment, it's deliberately the one field that answers "what is this cat
*like*," and turning it into pure multiple-choice would flatten the thing
that makes it worth reading. Two additions instead of a replacement:

- **Built-in chips** insert a starter phrase into the text box on tap
  (still freely editable/extendable after): *Friendly with people, Shy
  keeps distance, Vocal meows a lot, Food-motivated, Territorial with other
  cats, Follows joggers/people, Sleeps in the same spot, Grooms itself
  often.*
- **A personal set.** A "+ Add your own" chip opens an inline text field;
  saving it both inserts the phrase and stores it in a new
  `localStorage`-backed list (new small module, `data/noteChips.ts`,
  following the same read/write/validate pattern `localCats.ts` and
  `sightings.ts` already use for their own local lists). Every phrase saved
  this way appears as an extra chip, visually distinguished (dashed border)
  from the built-ins, in every future "add a new cat" session on this
  browser.

Confirmed working end-to-end in the reviewed mockup (localStorage
persistence, dashed-border distinction, reset control) — this section
describes what ships, not a new proposal.

---

## 6. Panel restructuring: one flat form → a four-step wizard

Adding the above to a single scrolling page makes the "too long" problem
real rather than hypothetical. Fix: progressive disclosure, four steps,
dot progress indicator, Back/Next, Submit only on the last step.

1. **Photo** — main photo (required) + optional extra photos for the pile.
2. **Identity** — Name, then the five description questions, live preview
   underneath.
3. **Character & look** — field note (chips + free text), territory
   colour, territory shape.
4. **Place & review** — click-to-place + radius slider (today's live map
   preview, generalized to the chosen shape) → a short summary of every
   choice made so far → Submit.

Each step keeps its own local validation (e.g. step 2 can't advance
without a name); the final submit still runs the one existing check that
has no input behind it — a territory must be placed — exactly as
`RecordCat.tsx`'s current `submit` does.

---

## 7. Data model summary

- `Cat` — **unchanged.** No new fields, no type changes. `photo` holds a
  data URI instead of a URL; still a `string`.
- `CatDraft` / `StoredCat` (`localCats.ts`) — add `shape: Shape`.
- `Shape` — new type, `'round' | 'elongated' | 'notched' | 'blocky'`.
- `Sighting` — **unchanged shape**, new creation path (`status: 'surveyed'`
  written directly, with `photo` and `order` set) alongside the existing
  visitor-facing `addSighting`.
- New: a small persisted string list for field-note phrases
  (`data/noteChips.ts`), independent of `CatDraft`/`Cat`.

---

## 8. Files touched

- `app/front-end/src/ui/RecordCat.tsx` — label, four-step wizard, shape
  picker, photo upload + compression (main and extra), structured
  description questions + live preview, field-note chips.
- `app/front-end/src/data/localCats.ts` — `Shape` type, `CatDraft`/
  `StoredCat` gain `shape`, `circleRing` → `shapeRing`, `circleFeature` →
  `shapeFeature`, `isStored` validator updated.
- `app/front-end/src/data/catsRepo.ts` — `addCat` threads `shape` through
  and creates bootstrap sightings for extra photos.
- `app/front-end/src/data/sightings.ts` — new admin-authored sighting
  creation function (surveyed, with photo + order).
- `app/front-end/src/data/noteChips.ts` — **new file**, small
  localStorage-backed list of an admin's saved note phrases.
- `app/front-end/src/plate/Plate.tsx` — **not touched.** The photo pile
  already renders whatever surveyed sightings with photos exist for a cat.
- `app/front-end/src/data/cats.seed.ts` — **not touched.** `Cat`'s shape is
  unchanged.
