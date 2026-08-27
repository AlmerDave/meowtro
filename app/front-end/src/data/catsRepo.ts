import type { FeatureCollection, Polygon } from 'geojson'
import { CATS, type Cat } from './cats.seed'
import baseTerritories from './territories.geo.json'
import { shapeFeature, readStored, slugify, writeStored, type CatDraft } from './localCats'
import { applyOverlay, hideOverlay, patchOverlay, readOverlay } from './overlay'
import {
  addAdminSighting,
  allSightings,
  deleteSighting as removeAnySighting,
  describeWhen,
  isOwnPending,
  isSurveyed,
  latestByCat,
  readSightings,
  removeSighting,
  reorderSighting as reorder,
  reviewSighting as review,
  sortForDisplay,
  translateToward,
  voteSighting as vote,
  type Sighting,
} from './sightings'

/* The v1/v2 seam, spec §9. The entire abstraction is that these functions are
   async over local data, so every consumer already handles loading and
   swapping to a real API is an edit to this file only.
   Territories stay polygons here and in v2: never an exact point for a real
   cat (spec §9, safety constraint). Do not add a `location` to Cat.

   Two sources behind that seam now, not one: the seeded three, and whatever
   has been recorded into this browser (localCats.ts). They are concatenated
   here rather than merged anywhere downstream, so nothing in the app knows
   or cares which of the two a cat came from. That is the point of doing it
   at this file: when the recorded ones move to a server, this is again the
   only file that changes. */

/* --- The review boundary, phase 8 --------------------------------------

   This file is where "published" is decided, and the reason it is here
   rather than in each consumer is that a real server would do exactly the
   same thing: a public endpoint never serves pending rows, so nothing
   downstream can forget to filter and nothing downstream has to learn what
   a status is. Phase 9 replaces these bodies with fetches and the guarantee
   survives the move.

   The predicates themselves live in data/sightings.ts, because
   map/Territories.tsx has to apply the same policy synchronously from
   inside a MapLibre effect and cannot await this file. One definition of
   "published", two callers. */

/** What the public map is built from. */
function published(): Sighting[] {
  return allSightings().filter(isSurveyed)
}

const CAT_OVERLAY = 'meowtro.cats.overlay.v1'

export async function listCats(): Promise<Cat[]> {
  /* Surveyed only, and this is a safety line rather than a detail.
     `lastSeen` is derived from the newest observation, so an unreviewed
     report would otherwise print "Last seen: Today" on the public record:
     an unverified claim that a real animal was somewhere recently, which is
     precisely what review exists to hold back. */
  const seen = latestByCat(published())
  const base = [...CATS, ...readStored().map((entry) => entry.cat)].map((cat) => {
    const sighting = seen.get(cat.id)
    /* `range` is deliberately NOT derived here the way lastSeen is, and
       went through two other designs before landing here. First it was
       overwritten with a generic sentence on every cat with a published
       sighting — which a seed cat's overlay patch could still win against
       (the overlay applies after this map), but a recorded cat had no
       overlay step after it, so the generic text silently clobbered
       anything more specific on every single read. Second, a dedicated
       writer (setDerivedRange, since removed) tried to persist a real
       place name at the moment of approval instead — which fixed the
       clobbering but could still go stale, the same way any write-once
       field can: a cat's `range` kept whatever was written at ITS last
       approval, however out of date that later became.

       `range` is now left alone here entirely, same as any other seed
       field, and the live fact — how big the territory currently is, and
       what's nearest its centre — is computed fresh on every render
       instead, by plate/TerritoryGlyph.tsx off the live translated ring
       this file's own listTerritories already produces. Nothing to clobber
       and nothing to go stale, because nothing is ever written. */
    return sighting ? { ...cat, lastSeen: describeWhen(sighting.at) } : cat
  })
  /* The overlay applies last, after the derived lastSeen above, so an
     admin's manual correction always wins over the automatic one. That is
     the one deliberate exception to "derived fields are not typed in": see
     CatPatch below for why lastSeen is on that list at all. */
  return applyOverlay(CAT_OVERLAY, base, (cat) => cat.id)
}

export async function getCat(id: string): Promise<Cat | null> {
  return (await listCats()).find((cat) => cat.id === id) ?? null
}

/** One cat's observations, newest first.

    Per cat rather than all of them, because that is the request a server
    will actually be asked to serve: the plate is the only thing that reads
    these, and it is only ever open on one cat. Behind the same seam as the
    rest, so phase 3 replaces the body of this function with a fetch and
    changes nothing above it. */
export async function listSightings(catId: string): Promise<Sighting[]> {
  /* Published, plus this browser's own unreviewed reports. The one place
     pending data reaches a non-admin surface, and safe for a specific
     reason spelled out at isOwnPending: it came from this browser, so it
     tells its reader nothing they did not type in. The plate marks them,
     and offers to withdraw them.

     Discarded ones are not here. They belong to the audit trail, not to a
     cat's record: showing a visitor a turned-down report every time they
     open that plate is a standing argument, not a log. */
  const own = readSightings()
  return sortForDisplay(
    allSightings()
      .filter((sighting) => sighting.catId === catId)
      .filter((sighting) => isSurveyed(sighting) || isOwnPending(sighting, own))
  )
}

/** Everything waiting on a verdict, oldest first, for the review queue.

    Oldest first on purpose, unlike every other list in this app: a queue is
    worked from the front, and the submission that has been waiting longest
    is the one somebody is still waiting on an answer to. */
export async function listPending(): Promise<Sighting[]> {
  return allSightings()
    .filter((sighting) => sighting.status === 'pending')
    .sort((a, b) => a.at - b.at)
}

/** Every decision that has been made, newest first: the audit trail. Both
    verdicts, because "what did we turn down" is the half of a review log
    that is actually worth having. Seeded history is excluded, since nobody
    ever decided anything about it. */
export async function listReviewed(): Promise<Sighting[]> {
  return readSightings()
    .filter((sighting) => sighting.status !== 'pending')
    .sort((a, b) => b.at - a.at)
}

/** An admin's verdict. Approving is what makes the territory move, which
    until now happened the instant a sighting was made. */
export async function reviewSighting(
  id: string,
  verdict: 'surveyed' | 'discarded'
): Promise<boolean> {
  return review(id, verdict)
}

/** A visitor taking back their own unreviewed report. Deletes it: nothing
    was published and no decision was made, so there is nothing to keep.

    Guarded rather than trusting the caller, because "withdraw" must never
    become a way to delete somebody else's record or an already-approved
    one. Only this browser's own storage is readable here at all, so the
    only real check left is that it is still pending. */
export async function withdrawSighting(id: string): Promise<boolean> {
  const mine = readSightings().find((sighting) => sighting.id === id)
  if (!mine || mine.status !== 'pending') return false
  return removeSighting(id)
}

/** An admin cleaning up the sighting log itself: any record, any status,
    gone for good. Not a review verdict (reviewSighting above) and not a
    visitor's own undo (withdrawSighting above) — see sightings.ts's
    deleteSighting for the distinction written out in full. */
export async function deleteSighting(id: string): Promise<boolean> {
  return removeAnySighting(id)
}

/** An admin re-sequencing one cat's log: which photo leads the stack, never
    when a sighting happened. */
export async function reorderSighting(catId: string, id: string, direction: 'up' | 'down'): Promise<boolean> {
  return reorder(catId, id, direction)
}

/** Every open report on one cat, oldest first: the admin's decision list on
    the plate (phase 9). Unlike listSightings above, not narrowed to "mine
    plus published" — this is the one place besides admin review itself
    that a non-owner's pending row is readable, and it stays readable here
    on purpose: the plate's own visitor-facing lock (plate/Plate.tsx) reads
    the same list to know a report already exists, without ever rendering
    its point. What differs by caller is what gets drawn from it, not what
    is fetched. */
export async function listPendingForCat(catId: string): Promise<Sighting[]> {
  return allSightings()
    .filter((sighting) => sighting.catId === catId && sighting.status === 'pending')
    .sort((a, b) => a.at - b.at)
}

/** A visitor's corroborating (or doubting) thumb on an open report, local to
    this browser (see Sighting.votes' own note on why that is honest rather
    than a shortcut). */
export async function voteSighting(id: string, direction: 'up' | 'down'): Promise<boolean> {
  return vote(id, direction)
}

/** An admin attaching a photo to an EXISTING cat's record from the plate's
    "Update record" mode, same trust level as addCat's own bootstrap photos
    below (sightings.ts's buildAdminSighting) — added straight in as
    `surveyed`, no review. `order: 0` puts it at the front of the stack;
    reaching for a fresh photo is usually the point of adding one, and an
    admin who wants it elsewhere already has the reorder controls next to
    "Manage sightings" to move it there. */
export async function addAdminPhoto(
  catId: string,
  point: [number, number],
  photo: string
): Promise<boolean> {
  return !!addAdminSighting(catId, point, Date.now(), photo, 0)
}

/* The territory shapes, on the same seam and for the same reason. This used
   to be a static import in Territories.tsx and CatMarkers.tsx, which was
   correct while the only cats were the seeded three and wrong the moment one
   could be added at runtime: a JSON import is frozen at module evaluation,
   so a newly recorded cat would have had a marker, a rail row and a plate,
   and no territory under any of them. */
export async function listTerritories(): Promise<FeatureCollection<Polygon>> {
  const base = baseTerritories as FeatureCollection<Polygon>
  /* Surveyed only. This is the line that turns a sighting from something
     that moves the map into something that proposes to. */
  const seen = latestByCat(published())
  /* A deleted seed cat's territory has to go with it, or the map would keep
     drawing a shape for a record the plate and the rail no longer show. */
  const hiddenIds = readOverlay(CAT_OVERLAY).hidden
  return {
    type: 'FeatureCollection',
    /* Sightings are applied here, at read time, rather than written back
       into the shapes. The recorded outline stays the recorded outline, and
       what the map draws is that outline plus whatever has been observed
       since, which is the same relationship a review queue will need: the
       submission never destroys what it proposes to change. */
    features: [...base.features, ...readStored().map(shapeFeature)]
      .filter((feature) => !hiddenIds.includes(feature.properties?.id as string))
      .map((feature) => {
        const sighting = seen.get(feature.properties?.id as string)
        return sighting ? translateToward(feature, sighting.point) : feature
      }),
  }
}

/** How many cats this browser has recorded. Sync, and the one place the
    local-only nature of the mock leaks into the UI on purpose: the panel
    offers to clear them, which is an affordance that exists because storage
    is a browser, and disappears when it is a server. */
export function countRecorded(): number {
  return readStored().length
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

/** Formatted the way the seeded cats' coordinates are, and derived from the
    territory's own centre rather than stored separately, so there is exactly
    one point associated with a cat and it is the middle of a drawn area. */
function formatCoordinates([lng, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${
    lng >= 0 ? 'E' : 'W'
  }`
}

/** One higher than every survey-line number already on record, seeded and
    locally recorded alike, so a newly added cat continues the same count
    rather than restarting at a fixed placeholder every time. Parses the
    number off the front of each existing `line` string ("LINE 11 ·
    KALAYAAN" -> 11); a cat with no such prefix does not raise the max,
    same as one with nothing to contribute. The seeded cats stop at 11
    (two of them share LINE 01), so the first recorded cat lands on 12. */
function nextLineNumber(stored: { cat: Cat }[]): number {
  const all = [...CATS, ...stored.map((entry) => entry.cat)]
  const max = all.reduce((n, cat) => {
    const match = /^LINE (\d+)/.exec(cat.line)
    return match ? Math.max(n, Number(match[1])) : n
  }, 0)
  return max + 1
}

/* Everything a Cat needs that the panel does not ask for. Asking would be
   asking someone to invent a filing convention: the plate number is a
   count, the date is today, and the coordinates and range are restatements
   of the circle that was just drawn. */
export async function addCat(draft: CatDraft): Promise<Cat | null> {
  const name = draft.name.trim()
  if (!name) return null

  const stored = readStored()
  const taken = new Set([...CATS, ...stored.map((entry) => entry.cat)].map((cat) => cat.id))

  /* -2, -3 and so on rather than a random suffix: two cats called Mingming
     should read as mingming and mingming-2, and the id shows up in the URL
     (App.tsx's ?cat=), which is a thing a person sees. */
  const base = slugify(name)
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const cat: Cat = {
    id,
    name: name.toUpperCase(),
    plate: `PLATE ${String(CATS.length + stored.length + 1).padStart(2, '0')}`,
    line: `LINE ${String(nextLineNumber(stored)).padStart(2, '0')} · ${draft.line.trim() || 'FIELD ENTRY'}`,
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
     same territory centre (the only coordinate this flow has). This is
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

/** Removes every recorded cat, not one. Kept for the same reason it always
    existed (a fast demo reset); per-cat deletion is `deleteCat` below, now
    that there is a role to gate it behind. */
export function clearRecorded(): boolean {
  return writeStored([])
}

/* --- Admin edits, phase 8's role gate extended to the record itself ----

   Everything RecordCat already collects, plus the two fields that used to
   be read-only because nothing could write them back: `disposition` was
   set once at creation and never revisited, and `lastSeen` is normally
   derived (see listCats above) rather than typed in at all. Both are now on
   the list because an admin correcting the record after the fact is a real
   need review surfaced — a wrong disposition or a stale derived date should
   not have to wait for the next sighting to fix itself.

   Never `id`, `plate`, `coordinates` or `range`: those describe the
   territory's own shape and position, and editing them here without
   touching the polygon would just make the record lie about where it is
   (same reasoning RecordCat's panel gives for drawing a circle instead of
   typing coordinates). Redrawing a territory is a real feature with a real
   UI cost (the whole click-to-place-and-size flow) and is not this one. */
export type CatPatch = Partial<
  Pick<
    Cat,
    | 'name'
    | 'description'
    | 'note'
    | 'photo'
    | 'line'
    | 'colour'
    | 'disposition'
    | 'firstRecorded'
    | 'lastSeen'
  >
>

/* `note` and `lastSeen` may be cleared back to "nothing recorded"; every
   other field must stay filled, the same rule RecordCat's `required` inputs
   already enforce on the way in. */
const CLEARABLE = new Set<keyof CatPatch>(['note', 'lastSeen'])

function cleanPatch(patch: CatPatch): CatPatch | null {
  const clean: Record<string, string | undefined> = {}
  for (const [key, raw] of Object.entries(patch)) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value) {
      clean[key] = value
      continue
    }
    if (!CLEARABLE.has(key as keyof CatPatch)) return null
    clean[key] = undefined
  }
  return clean as CatPatch
}

/** An admin correcting a record after the fact. A seed cat's edit lands in
    the overlay (see data/overlay.ts); a recorded cat's storage entry is
    rewritten directly, since nothing is frozen about it to begin with. */
export async function updateCat(id: string, patch: CatPatch): Promise<boolean> {
  const clean = cleanPatch(patch)
  if (!clean) return false
  if (CATS.some((cat) => cat.id === id)) return patchOverlay(CAT_OVERLAY, id, clean)
  const stored = readStored()
  const idx = stored.findIndex((entry) => entry.cat.id === id)
  if (idx < 0) return false
  const next = [...stored]
  next[idx] = { ...next[idx], cat: { ...next[idx].cat, ...clean } }
  return writeStored(next)
}

/** Removes a cat from the survey entirely: a recorded cat's entry is
    deleted outright, a seed cat is hidden by the overlay (cats.seed.ts
    itself is never rewritten). Its territory goes with it (listTerritories
    filters the same hidden set), and the cat vanishing from listCats is
    what closes its plate (App.tsx's own effect clears a selection that no
    longer names a cat). Its sightings are left in the log rather than swept
    up: they are their own record of what somebody reported seeing, and a
    deleted cat is not a reason to also erase that anybody looked. */
export async function deleteCat(id: string): Promise<boolean> {
  if (CATS.some((cat) => cat.id === id)) return hideOverlay(CAT_OVERLAY, id)
  const stored = readStored()
  if (!stored.some((entry) => entry.cat.id === id)) return false
  return writeStored(stored.filter((entry) => entry.cat.id !== id))
}

export type { Cat, CatDraft, Sighting }
