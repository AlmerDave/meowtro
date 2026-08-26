import type { FeatureCollection, Polygon } from 'geojson'
import { CATS, type Cat } from './cats.seed'
import baseTerritories from './territories.geo.json'
import { shapeFeature, readStored, slugify, writeStored, type CatDraft } from './localCats'
import {
  addAdminSighting,
  allSightings,
  describeWhen,
  isOwnPending,
  isSurveyed,
  latestByCat,
  readSightings,
  removeSighting,
  reviewSighting as review,
  translateToward,
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

export async function listCats(): Promise<Cat[]> {
  /* Surveyed only, and this is a safety line rather than a detail.
     `lastSeen` is derived from the newest observation, so an unreviewed
     report would otherwise print "Last seen: Today" on the public record:
     an unverified claim that a real animal was somewhere recently, which is
     precisely what review exists to hold back. */
  const seen = latestByCat(published())
  return [...CATS, ...readStored().map((entry) => entry.cat)].map((cat) => {
    const sighting = seen.get(cat.id)
    /* Spread rather than mutate: CATS is a module-level array shared by
       every call, and writing a derived field onto it would leave the last
       sighting stuck to the seed data for the life of the page. */
    return sighting ? { ...cat, lastSeen: describeWhen(sighting.at) } : cat
  })
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
  return allSightings()
    .filter((sighting) => sighting.catId === catId)
    .filter((sighting) => isSurveyed(sighting) || isOwnPending(sighting, own))
    .sort((a, b) => b.at - a.at)
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
  return {
    type: 'FeatureCollection',
    /* Sightings are applied here, at read time, rather than written back
       into the shapes. The recorded outline stays the recorded outline, and
       what the map draws is that outline plus whatever has been observed
       since, which is the same relationship a review queue will need: the
       submission never destroys what it proposes to change. */
    features: [...base.features, ...readStored().map(shapeFeature)].map((feature) => {
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

/** Removes every recorded cat, not one. Deliberately blunt: this exists so a
    demo can be reset, and per-cat deletion is a real feature with real
    questions attached (who may delete whose) that belong to the version with
    accounts in it, not to this one. */
export function clearRecorded(): boolean {
  return writeStored([])
}

export type { Cat, CatDraft, Sighting }
