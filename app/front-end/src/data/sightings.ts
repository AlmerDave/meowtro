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
  type Firestore,
} from 'firebase/firestore'
/* Relative rather than through the "@/" alias, which is what every other
   consumer in the app uses. TypeScript's paths are resolved at compile
   time and left untouched in the emitted JavaScript, so an aliased import
   here would make this module unloadable by node, and sightings.check.ts
   has to load it. Same reason map/liveWeather.ts imports the way it does. */
import { ringCentroid } from '../map/centroid'

/* Sightings: "I saw this cat here", the one thing a visitor can contribute.

   ## Why a sighting and not an edit

   The obvious shape for this feature is "let the user move the cat". It was
   rejected for two reasons that both come due later rather than now.

   A cat is a territory, never a point (spec §9). "Move the cat" is a
   point-shaped verb and would have pulled the data toward exactly the thing
   that rule forbids. "I saw it here" is a point about a PERSON's
   observation, which is a different claim: it says where somebody stood,
   not where an animal lives.

   And one visitor's observation should not overwrite a shared record. The
   system this mocks has admins reviewing what visitors submit, so a
   visitor's action has to be a submission that can be pending, applied or
   thrown away. Modelled as an edit there would be nothing left to review.

   ## Phase 9: the storage half moves to Firestore

   Every sighting now carries `authorUid`, which is what "mine" (withdraw,
   and the plate's own pending-lock) means from here on: no more "this
   browser's own", since everyone signs in to report (design doc, "Auth").
   The `sightings` Firestore collection replaces localStorage as the source
   of record, and review (phase 8's pending/surveyed/discarded status) is
   still a filter over this same list rather than a second data model,
   exactly as it was before the storage swap. The pure predicate/geometry
   functions below this point are untouched: only what reads and writes
   them changed. */

/* Where a submission is in review, phase 8.

   `discarded` rather than deleting the row, because an admin's decision
   about somebody else's submission is exactly the kind of thing the audit
   trail exists to hold. A withdrawal is different and does delete: nothing
   was ever published and no decision was ever made, so there is nothing to
   audit and "take it back" should mean gone. */
export type SightingStatus = 'pending' | 'surveyed' | 'discarded'

export type Sighting = {
  id: string
  catId: string
  point: [number, number]
  status: SightingStatus
  /** Epoch ms. When the cat was seen, which is not the same as when it was
      reported: the panel offers "earlier today" and "yesterday". */
  at: number
  photo?: string
  /** An admin's manual sequencing (reorderSighting below), never when the
      sighting happened. Absent means "no opinion": the sighting falls back
      to newest-first, same as before this field existed. Ascending, lower
      shows first, so promoting a photo to the front of the stack is a
      smaller number, not a bigger one. */
  order?: number
  authorUid: string
  /** This viewer's own vote on a pending sighting, joined in per-request
      from the sightings/{id}/votes/{myUid} subdocument (see myVoteFor);
      no longer stored on the sighting itself, since "mine" now spans
      every viewer, not one browser (Sighting.votes's old note explains
      why a shared field can't hold a personal fact). */
  myVote?: 'up' | 'down'
  /** The corroboration tally, now shared across every visitor via the
      Firestore transaction in voteSighting below, rather than local to one
      browser the way it was before phase 9 (see myVote's own note above for
      the parallel story on the personal half). Absent until the first vote
      lands. */
  votes?: { up: number; down: number }
}

const COLLECTION = 'sightings'

/* `db` is fetched through a dynamic import rather than a static one, and
   that is a second, unrelated reason this file has to watch what it pulls
   in at load time (the note above is about the "@/" alias; this one is
   about timing). firebase.ts reads `import.meta.env` at its own module top
   level, which Vite replaces at build time but which is simply undefined
   under plain node, so a static `import { db } from '../firebase'` would
   crash the instant sightings.check.ts requires this file, before a single
   assert runs. A dynamic import only resolves the first time one of the
   Firestore-touching functions below is actually called, and the check
   script never calls any of them (it exercises only applyVote and
   pendingByCat, both below), so firebase.ts is never loaded under node.

   The path is routed through a plain `string`-typed local rather than
   written as `import('../firebase')` directly for a third, purely
   type-checking reason: tsc resolves and type-checks a dynamic import's
   target whenever the specifier is a string literal, static or not, so a
   literal here would pull firebase.ts's `import.meta.env` straight back
   into this check's compile even though nothing would ever call the
   import at runtime. Widening the specifier to `string` is what tells tsc
   it cannot know which module this resolves to, so it leaves the target
   file out of the program entirely; the app itself still gets the exact
   same runtime import Vite would code-split on. */
let dbPromise: Promise<Firestore> | undefined
function getDb(): Promise<Firestore> {
  const firebaseModulePath: string = '../firebase'
  if (!dbPromise) dbPromise = import(firebaseModulePath).then((m) => (m as { db: Firestore }).db)
  return dbPromise
}

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
    app already worked before phase 9; only the source changed. */
export async function listAllSightings(): Promise<Sighting[]> {
  const db = await getDb()
  const snap = await getDocs(collection(db, COLLECTION))
  return snap.docs.map((d) => fromDoc(d.id, d.data()))
}

/* --- The review policy -------------------------------------------------

   Two predicates, and every filter in the app is one of them: this one and
   isOwnPending further below (moved next to myVoteFor now that "mine" is a
   uid check rather than a same-file localStorage scan). They live here
   rather than in catsRepo because the policy has to be applied from both an
   async context (the repo, which is where the app reads data) and a
   synchronous one (map/Territories.tsx draws its "seen elsewhere" zones
   inside a MapLibre effect and cannot await). One definition, two callers,
   so there is exactly one place to change the meaning of "published".

   Safety-first, which is the whole reason review exists here: a pending
   observation is a claim about where a real animal was, and until somebody
   has looked at it, it is not the survey's claim to publish. */

/** Published: what everybody is allowed to see. */
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
    const db = await getDb()
    const ref = doc(collection(db, COLLECTION))
    const data = { catId, point, status: 'pending' as const, at, authorUid, ...(photo ? { photo } : {}) }
    await setDoc(ref, data)
    return fromDoc(ref.id, data)
  } catch {
    return null
  }
}

/** An admin's own sighting, `surveyed` outright, same trust level as the
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
    const db = await getDb()
    const ref = doc(collection(db, COLLECTION))
    const data = { catId, point, status: 'surveyed' as const, at, photo, order, authorUid }
    await setDoc(ref, data)
    return fromDoc(ref.id, data)
  } catch {
    return null
  }
}

/** Undo/withdraw: deletes outright, same reasoning as before phase 9:
    nothing was published and no decision was made. Security rules are the
    real guard on "only your own, only while pending"; this still checks
    first so a caller gets `false` rather than a thrown permission error. */
export async function removeSighting(id: string): Promise<boolean> {
  try {
    const db = await getDb()
    await deleteDoc(doc(db, COLLECTION, id))
    return true
  } catch {
    return false
  }
}

/** An admin's housekeeping on the log itself: any record, any status,
    gone for good. Distinct from removeSighting above only by who is
    allowed to call it: firestore.rules enforces that distinction, this
    function is the same delete either way. */
export async function deleteSighting(id: string): Promise<boolean> {
  return removeSighting(id)
}

async function setOrder(id: string, order: number): Promise<boolean> {
  try {
    const db = await getDb()
    await updateDoc(doc(db, COLLECTION, id), { order })
    return true
  } catch {
    return false
  }
}

/** Swaps one sighting with whichever neighbour is currently next to it in
    `sortForDisplay`'s order, up or down; unchanged logic, now reading
    Firestore for the cat's log instead of localStorage. */
export async function reorderSighting(
  catId: string,
  id: string,
  direction: 'up' | 'down'
): Promise<boolean> {
  const db = await getDb()
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

/** Display order for a cat's log: an admin's explicit `order` first
    (ascending), then everything else falls in behind it newest-first, the
    same default as before reorder existed. This is only ever about which
    photo shows first in the stack: `latestByCat` below still reads `at`
    for "last seen", so reordering a cat's sightings never changes what the
    survey considers its most recent observation. */
export function sortForDisplay(list: Sighting[]): Sighting[] {
  return [...list].sort((a, b) => {
    if (a.order !== undefined || b.order !== undefined) {
      return (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY)
    }
    return b.at - a.at
  })
}

/** An admin's verdict. Writes the decision onto the record rather than
    removing it either way, which is what makes the audit trail possible:
    every sighting keeps who, what, where and when, and now also what was
    decided about it. */
export async function reviewSighting(id: string, verdict: 'surveyed' | 'discarded'): Promise<boolean> {
  try {
    const db = await getDb()
    await updateDoc(doc(db, COLLECTION, id), { status: verdict })
    return true
  } catch {
    return false
  }
}

/** The pure half of voteSighting below (unchanged from before phase 9),
    kept separate so it is checkable under node without a live Firestore to
    read or write (sightings.check.ts).

    A toggle, not an add: pressing the thumb you already pressed withdraws
    the vote rather than doubling it, and pressing the other one moves it
    rather than letting both stand. One vote per uid per sighting is the
    only shape that matches what "this viewer's own tally" can honestly
    mean, now that voting spans every viewer rather than one browser (see
    Sighting.myVote's own note). */
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
  try {
    const db = await getDb()
    const sightingRef = doc(db, COLLECTION, id)
    const voteRef = doc(db, COLLECTION, id, 'votes', uid)
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
    reads `oldestPending.myVote` directly; see catsRepo.ts's
    listPendingForCat, which joins this in per sighting). */
export async function myVoteFor(sightingId: string, uid: string): Promise<'up' | 'down' | undefined> {
  const db = await getDb()
  const snap = await getDoc(doc(db, COLLECTION, sightingId, 'votes', uid))
  return snap.exists() ? (snap.data().direction as 'up' | 'down') : undefined
}

/** This viewer's own unreviewed submission (the one exception to
    isSurveyed above), safe for the same reason it always was: the data is
    already theirs, so showing it back tells them nothing they did not
    submit. `uid` rather than an `own: Sighting[]` scan, now that "mine"
    is an account fact instead of a browser fact (Sighting.authorUid).
    Exported and pure so both an async caller (catsRepo.listSightings)
    and a synchronous one (map/Territories.tsx, inside a MapLibre effect
    that cannot await) can apply the exact same rule to a list they
    already have in hand; see that file's own note on why this cannot
    live in catsRepo.ts alone. */
export function isOwnPending(sighting: Sighting, uid: string | null): boolean {
  return sighting.status === 'pending' && sighting.authorUid === uid
}

/** The newest sighting per cat. Older ones are kept rather than overwritten,
    because a list of observations over time is the thing this data actually
    is, and a review queue will need all of them. */
export function latestByCat(list: Sighting[]): Map<string, Sighting> {
  const byCat = new Map<string, Sighting>()
  for (const sighting of list) {
    const current = byCat.get(sighting.catId)
    if (!current || sighting.at > current.at) byCat.set(sighting.catId, sighting)
  }
  return byCat
}

export type PendingSummary = { oldest: Sighting; count: number }

/** One cat's open review: the oldest still-pending sighting on it plus how
    many are waiting in total.

    Oldest, not newest, and deliberately the opposite choice from
    latestByCat above: the pending queue already sorts oldest first because
    "the submission that has been waiting longest is the one somebody is
    still waiting on an answer to", and the map's ghost territory (map/
    Territories.tsx) and ping-badge (map/CatMarkers.tsx) anchor to the same
    one sighting so they can never disagree about which report they mean.

    One summary per cat, not one per report. A cat can collect more than one
    pending sighting (data/catsRepo.ts locks the report button once one
    exists, but an admin review can still be mid-flight when a second one
    lands from before the lock), and drawing a ghost per report would fan a
    single territory into a small crowd of overlapping shapes. `count` is
    how the admin's plate section and the map badge say "more than one is
    waiting" without drawing more than one.

    Always takes an explicit list now: the old `= allSightings()` default
    read straight from localStorage, and there is nothing left to default to
    synchronously once the source is Firestore, so every caller passes in
    the list it already fetched. */
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

/** Metres between two lng/lat pairs, flat-earth. Over the few hundred metres
    this app ever measures, the error against a great-circle distance is
    centimetres, and it uses the same sphere the rest of the app does
    (data/localCats.ts has the note on why that consistency was chosen). */
export function distanceM(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const dx = (b[0] - a[0]) * M_PER_DEG * Math.cos(meanLat)
  const dy = (b[1] - a[1]) * M_PER_DEG
  return Math.hypot(dx, dy)
}

/** How far the territory reaches from its own middle: the distance to its
    furthest vertex. Used to tell somebody whether the point they just
    tapped is inside the range this cat is already known for. */
export function ringRadiusM(ring: [number, number][], center: [number, number]): number {
  return ring.reduce((furthest, point) => Math.max(furthest, distanceM(center, point)), 0)
}

/* Moves a territory so its centroid lands on `to`, keeping its shape.

   A flat offset added to every vertex, not a reprojection. At this scale
   that is the correct thing rather than a shortcut: a few hundred metres of
   translation changes the metres-per-degree-of-longitude factor by about
   0.001%, which is four orders of magnitude below the coordinate rounding
   these shapes are stored at. */
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

/** For the plate's "Last seen" row. Relative for the two days anyone thinks
    in, absolute after that: "3 days ago" is a number people have to convert
    back into a date, and this is a survey record. */
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
