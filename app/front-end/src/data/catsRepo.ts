import type { FeatureCollection, Polygon } from 'geojson'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
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
  listAllSightingsForAdmin,
  listMySightings,
  listPublicSightings,
  listVisibleSightings,
  myVoteFor,
  removeSighting,
  reorderSighting as reorder,
  reviewSighting as review,
  sortForDisplay,
  translateToward,
  voteSighting as vote,
  type Sighting,
} from './sightings'

/* The v1/v2 seam, spec §9: the whole app already goes through this file for
   its data, so what changed at phase 9 is only what sits on the other side
   of these functions, Firestore instead of a seeded array and localStorage.
   Nothing above this file noticed the swap; every consumer already handled
   "async over data I don't own yet".

   Territories stay polygons here and always will: never an exact point for
   a real cat (spec §9, safety constraint). Do not add a `location` to Cat. */

const COLLECTION = 'cats'

/** A Firestore cats/{id} document: everything on Cat except `id` (the doc
    id already is it) and `lastSeen` (derived, see below), plus the
    resolved territory ring. Storing the ring pre-computed rather than
    center/radiusM/shape is what lets a seeded cat (an arbitrary hand-drawn
    polygon from territories.geo.json, not expressible as a warped circle)
    and an admin-recorded cat (built by shapeRing) live in the same shape:
    listTerritories reads `territory` off every doc identically, with no
    branch on where the cat came from.

    `source` is the one field that DOES branch on where the cat came from,
    and exists for exactly one reason: `countRecorded`/`clearRecorded`
    below need to mean what they always meant, "cats an admin added from
    this survey's own panel", not "every document in the collection".
    Before Firestore that distinction was free (`CATS` was a separate
    literal array from `readStored()`); one shared collection needs a field
    to carry the same fact. Every other reader of this collection
    (`listCats`, `getCat`, `listTerritories`) ignores it entirely: a cat
    shows on the map identically either way. */
type CatDoc = Omit<Cat, 'id' | 'lastSeen'> & {
  lastSeen?: string
  territory: [number, number][]
  source: 'seed' | 'recorded'
}

function catFromDoc(id: string, data: CatDoc): Omit<Cat, 'lastSeen'> & { lastSeen?: string } {
  const { territory: _territory, source: _source, ...rest } = data
  return { id, ...rest }
}

/* --- The review boundary ------------------------------------------------

   This file is where "published" is decided, and the reason it is here
   rather than in each consumer is that a real server would do exactly the
   same thing: a public endpoint never serves pending rows, so nothing
   downstream can forget to filter and nothing downstream has to learn what
   a status is.

   The predicates themselves live in data/sightings.ts, because
   map/Territories.tsx has to apply the same policy synchronously from
   inside a MapLibre effect and cannot await this file. One definition of
   "published", two callers.

   Each function below fetches through the narrowest of sightings.ts' four
   queries that answers its own question, rather than pulling the whole log
   and filtering it here. That is a security change, not a tidy-up: the
   unfiltered read those filters used to sit on top of is now admin-only at
   the rule level (firestore.rules' sightings read rule), so a public path
   that asked for it would simply fail. `isSurveyed`/`isOwnPending` still
   run where they always did, as the second, client-side statement of the
   same policy. */

/** The cats, with "last seen" derived from the surveyed log.

    `publicSightings` is the same array a caller may already have fetched
    (App.tsx fetches it once for the whole page and hands it to both this
    and listTerritories below). Optional rather than required so callers
    with only one question to ask (landing/Landing.tsx wants a roster and
    nothing else) stay a single call, and so nothing outside this file had
    to change to get the saving. Passing it turns three round trips per
    page load into one. */
export async function listCats(publicSightings?: Sighting[]): Promise<Cat[]> {
  const [snap, sightings] = await Promise.all([
    getDocs(collection(db, COLLECTION)),
    publicSightings ? Promise.resolve(publicSightings) : listPublicSightings(),
  ])
  /* Surveyed only: an unreviewed report must never print "Last seen:
     Today" on the public record, the same safety line the pre-Firestore
     version drew. */
  const seen = latestByCat(sightings)
  return snap.docs.map((docSnap) => {
    const cat = catFromDoc(docSnap.id, docSnap.data() as CatDoc)
    const sighting = seen.get(cat.id)
    /* `cat.lastSeen` is only ever present when an admin explicitly set it
       (updateCat below): listCats never writes it. That absence-by-default
       is what lets the derived value win when there is no override and the
       admin's correction win when there is one, the same precedence the
       old overlay-applied-after-derivation gave. */
    return { ...cat, lastSeen: cat.lastSeen ?? (sighting ? describeWhen(sighting.at) : undefined) }
  })
}

export async function getCat(id: string): Promise<Cat | null> {
  return (await listCats()).find((cat) => cat.id === id) ?? null
}

/** How many cats an admin has recorded through this survey's own panel,
    seeded cats not included: the same count `CATS.length` versus
    `readStored().length` used to give for free by being two separate
    arrays. One shared `cats` collection needs a filter instead, so this
    reads `source == 'recorded'` (see CatDoc's own note on why that field
    exists) rather than the whole collection. Async now, unlike before,
    because a filtered query can no longer happen synchronously the way
    reading localStorage did. */
export async function countRecorded(): Promise<number> {
  const snap = await getDocs(query(collection(db, COLLECTION), where('source', '==', 'recorded')))
  return snap.size
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
    admin-recorded alike, so a newly added cat continues the same count
    rather than restarting at a fixed placeholder every time. Parses the
    number off the front of each existing `line` string ("LINE 11 ·
    KALAYAAN" -> 11); a cat with no such prefix does not raise the max,
    same as one with nothing to contribute. The seeded cats stop at 11 (two
    of them share LINE 01), so the first recorded cat lands on 12.
    Unchanged logic from before Firestore; reads the live `cats` collection
    instead of `[...CATS, ...stored]`. */
function nextLineNumber(cats: { line: string }[]): number {
  const max = cats.reduce((n, cat) => {
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

  const snap = await getDocs(collection(db, COLLECTION))
  const existing = snap.docs.map((d) => ({ id: d.id, ...(d.data() as CatDoc) }))
  const taken = new Set(existing.map((cat) => cat.id))

  /* -2, -3 and so on rather than a random suffix: two cats called Mingming
     should read as mingming and mingming-2, and the id shows up in the URL
     (App.tsx's ?cat=), which is a thing a person sees. */
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
    source: 'recorded',
  }

  try {
    await setDoc(doc(db, COLLECTION, id), catData)
  } catch {
    return null
  }

  /* Every extra photo becomes its own surveyed sighting, same as before:
     draft.extraPhotos already carries Storage URLs by the time this runs
     (ui/RecordCat.tsx's pickExtraPhotos uploads them at pick time, see
     Task 13), so this is just attaching them, not compressing them. A
     photo that fails to save here is silently dropped rather than failing
     the whole submit: addAdminSighting swallows its own errors and
     returns null instead of throwing, so one failed write never rejects
     the Promise.all below, and the cat itself is already safely stored by
     this point, so losing one gallery photo is a smaller problem than
     losing the cat record over it. */
  const now = Date.now()
  await Promise.all(
    draft.extraPhotos.map((photo, index) => addAdminSighting(id, draft.center, now, photo, index, draft.authorUid))
  )

  /* `territory` and `source` are Firestore-only: a Cat has never carried
     its own ring or its own provenance (both are re-derived or ignored by
     every reader, see CatDoc's own note), so they are stripped here rather
     than spread into the returned Cat, which would otherwise fail the
     excess-property check on this function's Promise<Cat | null> return
     type. */
  const { territory: _territory, source: _source, ...catFields } = catData
  return { id, ...catFields }
}

/** Removes every cat this survey's own panel recorded, seeded cats left
    alone: the same distinction `clearRecorded` always drew back when
    `readStored()` was a separate array from `CATS`, now expressed as a
    `source == 'recorded'` filter over the one shared collection instead of
    a second array to wipe. Kept for the same reason it always existed (a
    fast demo reset); per-cat deletion is `deleteCat` below. Async because
    deleting a filtered query's results can no longer happen synchronously
    the way clearing localStorage did. */
export async function clearRecorded(): Promise<boolean> {
  const snap = await getDocs(query(collection(db, COLLECTION), where('source', '==', 'recorded')))
  try {
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
    return true
  } catch {
    return false
  }
}

/* --- Admin edits, phase 8's role gate extended to the record itself ----

   Everything RecordCat already collects, plus the two fields that used to
   be read-only because nothing could write them back: `disposition` was
   set once at creation and never revisited, and `lastSeen` is normally
   derived (see listCats above) rather than typed in at all. Both are now on
   the list because an admin correcting the record after the fact is a real
   need review surfaced, a wrong disposition or a stale derived date should
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

/** An admin correcting a record after the fact. Every cat's doc is
    rewritten directly now, seeded or admin-recorded alike, since Firestore
    does not fork the two the way the old CATS-versus-overlay split did. */
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

/** Removes a cat from the survey entirely, deleted outright now that every
    cat lives in the same collection (no seed-versus-overlay split to hide
    one behind instead). Its territory goes with it, since listTerritories
    reads the same `cats` collection this deletes from, and the cat
    vanishing from listCats is what closes its plate (App.tsx's own effect
    clears a selection that no longer names a cat). Its sightings are left
    in the log rather than swept up: they are their own record of what
    somebody reported seeing, and a deleted cat is not a reason to also
    erase that anybody looked. */
export async function deleteCat(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION, id))
    return true
  } catch {
    return false
  }
}

/* The territory shapes, on the same seam and for the same reason. This used
   to be a static import in Territories.tsx and CatMarkers.tsx, which was
   correct while the only cats were the seeded three and wrong the moment one
   could be added at runtime: a JSON import is frozen at module evaluation,
   so a newly recorded cat would have had a marker, a rail row and a plate,
   and no territory under any of them. */
export async function listTerritories(
  publicSightings?: Sighting[]
): Promise<FeatureCollection<Polygon>> {
  const [snap, sightings] = await Promise.all([
    getDocs(collection(db, COLLECTION)),
    publicSightings ? Promise.resolve(publicSightings) : listPublicSightings(),
  ])
  /* Surveyed only. This is the line that turns a sighting from something
     that moves the map into something that proposes to. */
  const seen = latestByCat(sightings)
  return {
    type: 'FeatureCollection',
    /* Sightings are applied here, at read time, rather than written back
       into the shapes. The recorded outline stays the recorded outline,
       and what the map draws is that outline plus whatever has been
       observed since, which is the same relationship a review queue
       needs: the submission never destroys what it proposes to change. */
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

/** One cat's observations, newest first.

    Per cat rather than all of them, because that is the request a server
    will actually be asked to serve: the plate is the only thing that reads
    these, and it is only ever open on one cat. */
export async function listSightings(catId: string, uid: string | null): Promise<Sighting[]> {
  /* Published, plus this viewer's own unreviewed reports. The one place
     pending data reaches a non-admin surface, and safe for a specific
     reason spelled out at isOwnPending: it is already theirs, so it tells
     its reader nothing they did not submit. The plate marks them, and
     offers to withdraw them.

     Discarded ones are not here, and now cannot be: listVisibleSightings
     never asks for them (firestore.rules would only serve somebody their
     own anyway). They belong to the audit trail, not to a cat's record:
     showing a visitor a turned-down report every time they open that plate
     is a standing argument, not a log. */
  const list = (await listVisibleSightings(uid))
    .filter((sighting) => sighting.catId === catId)
    .filter((sighting) => isSurveyed(sighting) || isOwnPending(sighting, uid))
  return sortForDisplay(list)
}

/** Everything waiting on a verdict, oldest first, for the review queue.

    Oldest first on purpose, unlike every other list in this app: a queue is
    worked from the front, and the submission that has been waiting longest
    is the one somebody is still waiting on an answer to.

    Admin-only at the fetch, not merely at the surface that draws it:
    listAllSightingsForAdmin is the unfiltered read, and firestore.rules
    serves it to an admins/{uid} holder and nobody else. */
export async function listPending(): Promise<Sighting[]> {
  return (await listAllSightingsForAdmin())
    .filter((sighting) => sighting.status === 'pending')
    .sort((a, b) => a.at - b.at)
}

/** Every decision that has been made, newest first: the audit trail. Both
    verdicts, because "what did we turn down" is the half of a review log
    that is actually worth having. Admin-only at the fetch, same as
    listPending above and for the same reason: a discarded report is the
    one record in this app nobody but an admin may read about somebody
    else. */
export async function listReviewed(): Promise<Sighting[]> {
  return (await listAllSightingsForAdmin())
    .filter((sighting) => sighting.status !== 'pending')
    .sort((a, b) => b.at - a.at)
}

/** An admin's verdict. Approving is what makes the territory move, which
    until now happened the instant a sighting was made. */
export async function reviewSighting(id: string, verdict: 'surveyed' | 'discarded'): Promise<boolean> {
  return review(id, verdict)
}

/** A visitor taking back their own unreviewed report. Deletes it: nothing
    was published and no decision was made, so there is nothing to keep.

    `uid` is checked here as well as by firestore.rules: belt and
    suspenders, same as the pre-Firestore version checked its own storage
    before trusting the caller. "Withdraw" must never become a way to
    delete somebody else's record or an already-approved one.

    Fetched from listMySightings rather than the whole log: this only ever
    looks for the caller's own document by id, so the caller's own
    documents are the exact right list to look in, and it is the one query
    a non-admin can make that includes every status. */
export async function withdrawSighting(id: string, uid: string): Promise<boolean> {
  const mine = (await listMySightings(uid)).find((sighting) => sighting.id === id)
  if (!mine || mine.status !== 'pending' || mine.authorUid !== uid) return false
  return removeSighting(id)
}

/** An admin cleaning up the sighting log itself: any record, any status,
    gone for good. Not a review verdict (reviewSighting above) and not a
    visitor's own undo (withdrawSighting above): see sightings.ts's
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
    the plate. Unlike listSightings above, not narrowed to "mine plus
    published": this is the one place besides admin review itself that a
    non-owner's pending row is readable, and it stays readable here on
    purpose. The plate's own visitor-facing lock (plate/Plate.tsx) reads the
    same list to know a report already exists, without ever rendering its
    point. What differs by caller is what gets drawn from it, not what is
    fetched.

    Signed out, this is empty rather than "the same list without votes on
    it". Pending reports are readable only to a signed-in caller now
    (firestore.rules; the corroboration branch), so there is no unfiltered
    list left to fall back to, and asking for one would earn a permission
    error rather than a shorter answer. The plate degrades correctly on
    that: no open report visible means the "I saw this one" button is
    offered, which is the right thing to show somebody who cannot vote
    anyway. */
export async function listPendingForCat(catId: string, uid: string | null): Promise<Sighting[]> {
  if (!uid) return []
  const pending = (await listVisibleSightings(uid))
    .filter((sighting) => sighting.catId === catId && sighting.status === 'pending')
    .sort((a, b) => a.at - b.at)
  /* Join in this viewer's own vote per sighting. A handful of extra reads
     at most: a cat rarely has more than one or two open reports at once
     (catsRepo.addSighting locks the report button once one exists), so
     one getDoc per pending row is the right size of solution here rather
     than a batched query for a list this short. */
  return Promise.all(
    pending.map(async (sighting) => ({ ...sighting, myVote: await myVoteFor(sighting.id, uid) }))
  )
}

/** A visitor's corroborating (or doubting) thumb on an open report, one per
    uid now that voting spans every viewer rather than one browser (see
    Sighting.votes' own note in sightings.ts). */
export async function voteSighting(id: string, uid: string, direction: 'up' | 'down'): Promise<boolean> {
  return vote(id, uid, direction)
}

/** An admin attaching a photo to an EXISTING cat's record from the plate's
    "Update record" mode, same trust level as addCat's own bootstrap photos
    above: added straight in as `surveyed`, no review. `order: 0` puts it at
    the front of the stack; reaching for a fresh photo is usually the point
    of adding one, and an admin who wants it elsewhere already has the
    reorder controls next to "Manage sightings" to move it there. */
export async function addAdminPhoto(
  catId: string,
  point: [number, number],
  photo: string,
  authorUid: string
): Promise<boolean> {
  return !!(await addAdminSighting(catId, point, Date.now(), photo, 0, authorUid))
}

export type { Cat, CatDraft, Sighting }
