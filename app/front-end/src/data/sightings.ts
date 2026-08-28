import type { Feature, Polygon } from 'geojson'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
      no longer stored on the sighting itself, because it is a personal
      fact and `votes` below is a shared one, and phase 9 gave every viewer
      an account (`authorUid`) that can tell the two apart, rather than one
      browser's storage standing in for "this viewer" as it did before. */
  myVote?: 'up' | 'down'
  /** The corroboration tally: everybody's up/down count on this sighting,
      kept in sync with the personal `myVote` half above by the same
      Firestore transaction in voteSighting below, so the two can never
      disagree. Shared across every visitor as of phase 9, unlike `myVote`,
      which stays personal. Absent until the first vote lands. */
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

   The specifier is cast `as string` rather than passed as a bare
   `import('../firebase')` for a third, purely type-checking reason: tsc
   resolves and type-checks a dynamic import's target whenever the
   specifier is a string literal, static or not, so an uncast literal here
   would pull firebase.ts's `import.meta.env` straight back into this
   check's compile even though nothing would ever call the import at
   runtime. The cast is what tells tsc it cannot know which module this
   resolves to, so it leaves the target file out of the program entirely.
   Crucially the specifier is still a literal in the emitted JS, since a
   TypeScript cast carries no runtime code — Vite's bundler sees the same
   `import('../firebase')` a static import would produce and code-splits
   it into a real chunk. Routing it through a `string`-typed local instead,
   as this used to do, hid that literal from Vite too: the browser then
   resolved the import at its own runtime, relative to wherever the
   bundler happened to place the calling chunk, which 404s the moment
   production output isn't sitting next to a file literally named
   "firebase" (it never is — Vite hashes and flattens build output). */
let dbPromise: Promise<Firestore> | undefined
function getDb(): Promise<Firestore> {
  if (!dbPromise) dbPromise = import('../firebase' as string).then((m) => (m as { db: Firestore }).db)
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

/* --- Reading the log ----------------------------------------------------

   Four queries where there used to be one `listAllSightings`, and the split
   is not an optimisation: it is firestore.rules' own read rule expressed in
   TypeScript, so that every fetch this app makes is one the backend will
   actually serve. A single unfiltered collection read now fails outright for
   anybody but an admin, and it should: a pending report's exact point was
   readable by a signed-out stranger for as long as that one function was the
   only way in.

   Each function below names the reader it is for. A caller picks the
   narrowest one that answers its question, rather than fetching everything
   and filtering afterwards, which is what let a leak hide behind a filter. */

/** Every SURVEYED sighting, readable by anyone including a signed-out
    visitor. What listCats/listTerritories need for "last seen" and the
    territory shift, and the floor of what App.tsx ever shows. */
export async function listPublicSightings(): Promise<Sighting[]> {
  const db = await getDb()
  const snap = await getDocs(query(collection(db, COLLECTION), where('status', '==', 'surveyed')))
  return snap.docs.map((d) => fromDoc(d.id, d.data()))
}

/** Surveyed plus every open pending sighting, for a signed-in viewer.
    A signed-out visitor gets exactly the set listPublicSightings would:
    firestore.rules only opens pending reports to a signed-in caller, for
    corroboration voting (any visitor may vote on any open report, the
    design map/Territories.tsx's own note already argues for), so asking
    for them without a uid would only earn a permission error. Never
    includes discarded records; those are the audit trail. */
export async function listVisibleSightings(uid: string | null): Promise<Sighting[]> {
  const db = await getDb()
  const statuses = uid ? ['surveyed', 'pending'] : ['surveyed']
  const snap = await getDocs(query(collection(db, COLLECTION), where('status', 'in', statuses)))
  return snap.docs.map((d) => fromDoc(d.id, d.data()))
}

/** This signed-in viewer's own sightings, any status, discarded included.
    Only ever used for a count (ui/About.tsx's "yours"/"waiting"), never
    rendered as content: firestore.rules' authorUid branch is what makes a
    visitor's own turned-down report readable at all, and it stays that
    narrow. Nobody sees anybody else's discarded report but an admin. */
export async function listMySightings(uid: string): Promise<Sighting[]> {
  const db = await getDb()
  const snap = await getDocs(query(collection(db, COLLECTION), where('authorUid', '==', uid)))
  return snap.docs.map((d) => fromDoc(d.id, d.data()))
}

/** Every sighting, any status, any author. Only an admin's Firestore
    membership (the admins/{uid} doc firestore.rules checks) lets this
    succeed; this function verifies nothing itself, the rule does. */
export async function listAllSightingsForAdmin(): Promise<Sighting[]> {
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

/** A visitor's report. Lands `pending`: it is a submission, not a fact, and
    nothing on the public map moves until somebody has reviewed it.

    `photo` is optional and genuinely so, same as the field itself: most
    reports still arrive without one, ui/ReportSighting.tsx's camera step
    is a step somebody can skip. */
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
    /* A batch, not a plain setDoc, so the new report and the cat's own
       pendingCount land together: cats/{catId}.pendingCount is the one
       signal a signed-out visitor's plate can read at all (firestore.rules
       keeps the report itself behind sign-in), and a create that landed
       without it would leave that visitor seeing an unlocked "I saw this
       one" button while somebody else's report sat open. increment() needs
       no prior read (unlike the vote transaction below, which has to know
       the caller's previous vote), so a batch is the right size of tool
       here rather than a runTransaction. */
    const batch = writeBatch(db)
    batch.set(ref, data)
    batch.update(doc(db, 'cats', catId), { pendingCount: increment(1) })
    await batch.commit()
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

/** Undo, and withdraw, which are the same operation at two speeds: the
    nine-second toast and the plate's own log. One sighting by id, not "the
    last one": by the time somebody presses undo, a concurrent report
    (another tab, or now another device entirely, since the log lives in
    Firestore rather than one browser's storage) could have added a
    different one, and removing whatever happens to be last would silently
    delete the wrong record.

    Deletes outright rather than marking, same reasoning as before phase 9:
    nothing was published and no decision was made, so there is nothing to
    keep. Security rules are the real guard on "only your own, only while
    pending"; this still checks first so a caller gets `false` rather than
    a thrown permission error.

    `catId`, when given, batches in the matching cats/{catId}.pendingCount
    decrement, same reasoning as addSighting/reviewSighting's own batches:
    a withdrawn report is one fewer thing waiting, and a signed-out
    visitor's plate has no other way to learn that. catsRepo.withdrawSighting
    is the one caller that ever has both a catId and a confirmed `pending`
    status in hand at once, so it is the one caller that passes it. */
export async function removeSighting(id: string, catId?: string): Promise<boolean> {
  try {
    const db = await getDb()
    if (catId) {
      const batch = writeBatch(db)
      batch.delete(doc(db, COLLECTION, id))
      batch.update(doc(db, 'cats', catId), { pendingCount: increment(-1) })
      await batch.commit()
    } else {
      await deleteDoc(doc(db, COLLECTION, id))
    }
    return true
  } catch {
    return false
  }
}

/** An admin's housekeeping on the log itself: any record, any status,
    gone for good. Distinct from removeSighting above only by who is
    allowed to call it: firestore.rules enforces that distinction, this
    function is the same delete either way.

    ponytail: no `catId` passed here, so a still-pending record deleted
    this way (rather than reviewed) leaves cats/{catId}.pendingCount one
    too high. plate/Plate.tsx's own "Manage sightings" list, the only
    caller, is built from catsRepo.listSightings, which never contains
    anyone's pending row but the viewer's own (its own note) — so this
    only reaches a pending record at all when an admin deletes a report
    they filed themselves, straight from the gallery rather than through
    Approve/Reject. Narrow enough to leave; thread catId + a pending check
    through here if that stops being true. */
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
    `sortForDisplay`'s order, up or down. Only the two rows trading places
    get a real `order` value, seeded from the slot they are already sitting
    in, so the first reorder on a cat's log does not have to invent a
    number for every sighting it owns, only the two that moved. Unchanged
    logic from before phase 9, now reading Firestore for the cat's log
    instead of localStorage.

    ponytail: repeated reordering can still leave two rows tied on the same
    order number; sortForDisplay breaks a tie arbitrarily rather than
    renumbering the whole log. Fine for how rarely an admin actually nudges
    one photo ahead of another; a future write path could renumber the
    whole log on every reorder if that ever stops being true. */
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
    decided about it.

    `catId` is a second parameter rather than a read of the sighting doc's
    own field, because every caller (ui/ReviewQueue.tsx, plate/Plate.tsx)
    already has it in hand from the row it is deciding, and reading it back
    here would be a round trip to learn something the caller already knows.
    Batched with the matching pendingCount decrement, same reasoning as
    addSighting's own batch: a verdict that landed without it would leave
    cats/{catId}.pendingCount overcounting forever.

    ponytail: no read-then-check on the sighting's own current status
    first, so calling this twice on an already-decided sighting (a
    double-click before a caller disables its button) would decrement
    pendingCount an extra time. Same trust level this codebase already
    accepts for the votes tally (this file's own note on voteSighting);
    worth a transaction with a status read if it ever actually happens
    rather than guarded against up front. */
export async function reviewSighting(
  id: string,
  catId: string,
  verdict: 'surveyed' | 'discarded'
): Promise<boolean> {
  try {
    const db = await getDb()
    const batch = writeBatch(db)
    batch.update(doc(db, COLLECTION, id), { status: verdict })
    batch.update(doc(db, 'cats', catId), { pendingCount: increment(-1) })
    await batch.commit()
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
