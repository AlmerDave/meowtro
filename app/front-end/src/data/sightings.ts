import type { Feature, FeatureCollection, Polygon } from 'geojson'
/* Relative rather than through the "@/" alias, which is what the rest of
   the app uses. TypeScript's paths are resolved at compile time and left
   untouched in the emitted JavaScript, so an aliased import here would make
   this module unloadable by node, and sightings.check.ts has to load it.
   Same reason map/liveWeather.ts imports the way it does. */
import { centroidsById, ringCentroid } from '../map/centroid'
import baseTerritories from './territories.geo.json'

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
   system this is a mock of has admins reviewing what visitors submit, so a
   visitor's action has to be a submission that can be pending, applied or
   thrown away. Modelled as an edit there would be nothing left to review.

   ## What it does today

   There is no admin yet, so a sighting is applied the moment it is made and
   the panel says so out loud. When review arrives, the change is a filter
   over this list rather than a new data model: every sighting already
   carries who-what-where-when, and the only missing field is a status.

   Applying means the cat's territory is TRANSLATED to the reported point,
   its shape kept. Replacing it with a circle would have thrown away the
   hand-drawn outline that is most of what makes the map look like a survey,
   and would have made every reported cat's patch identical. */

const KEY = 'meowtro.sightings.v1'

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
  /** Reviewed, waiting, or turned down. See SightingStatus.

      Required here and tolerant on the way in: sightings written before
      review existed have no status at all, and readSightings reads a
      missing one as `surveyed`. They were made under a regime where
      reporting meant applying and they are already on that visitor's map,
      so un-publishing them retroactively would rewrite what somebody has
      already seen. That is a worse outcome than one grandfathered row in a
      survey of fictional cats. */
  status: SightingStatus
  /** Epoch ms. When the cat was seen, which is not the same as when it was
      reported: the panel offers "earlier today" and "yesterday". */
  at: number
  /** A photograph of the cat as it was seen, if there is one.

      A URL, and always a URL, which is the whole reason this field is one
      line rather than a subsystem. Today it is filled from the seeds below;
      when there is a server it is filled from the server. Nothing that
      renders a sighting can tell the difference, so the change is confined
      to wherever the sightings come from.

      Optional, and genuinely so rather than as a hedge. The panel a visitor
      reports through (ui/ReportSighting.tsx) has nowhere to upload a
      photograph to and does not ask for one, so every sighting anybody
      actually makes today arrives without this field. A consumer that
      assumed it was there would be broken by the first real report. */
  photo?: string
}

const STATUSES: SightingStatus[] = ['pending', 'surveyed', 'discarded']

function isSighting(value: unknown): value is Omit<Sighting, 'status'> & {
  status?: SightingStatus
} {
  if (!value || typeof value !== 'object') return false
  const { id, catId, point, at, photo, status } = value as Partial<Sighting>
  return (
    typeof id === 'string' &&
    typeof catId === 'string' &&
    Array.isArray(point) &&
    point.length === 2 &&
    point.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof at === 'number' &&
    Number.isFinite(at) &&
    // Absent is valid; present and not a string is not.
    (photo === undefined || typeof photo === 'string') &&
    // Absent is valid and means `surveyed`; see the field's own note. An
    // unrecognised value is not: a typo'd status must not be able to make a
    // record invisible to review by matching none of the filters.
    (status === undefined || STATUSES.includes(status))
  )
}

/* --- The review policy -------------------------------------------------

   Two predicates, and every filter in the app is one of them. They live
   here rather than in catsRepo because the policy has to be applied from
   both an async context (the repo, which is where the app reads data) and
   a synchronous one (map/Territories.tsx draws its "seen elsewhere" zones
   inside a MapLibre effect and cannot await). One definition, two callers,
   so there is exactly one place to change the meaning of "published".

   Safety-first, which is the whole reason review exists here: a pending
   observation is a claim about where a real animal was, and until somebody
   has looked at it, it is not the survey's claim to publish. */

/** Published: what everybody is allowed to see. */
export function isSurveyed(sighting: Sighting): boolean {
  return sighting.status === 'surveyed'
}

/** This browser's own unreviewed submission.

    The single exception to the rule above, and it is safe for one specific
    reason: the data came from this browser, so showing it back tells its
    reader nothing they did not type in themselves. In phase 9 this becomes
    "pending rows belonging to the caller's token", which is an ordinary
    thing for a server to serve. It is NOT "any pending sighting". */
export function isOwnPending(sighting: Sighting, own: Sighting[]): boolean {
  return sighting.status === 'pending' && own.some((mine) => mine.id === sighting.id)
}

/* Same reasoning as localCats.ts: this is a string a person can edit and a
   browser can truncate, and a malformed point reaching a polygon reaching
   addSource takes the whole map down with it. */
export function readSightings(): Sighting[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    /* A missing status reads as `surveyed`, normalised here so nothing
       downstream has to know that records older than review exist. See the
       field's own note for why grandfathering rather than re-queueing. */
    return parsed
      .filter(isSighting)
      .map((sighting) => ({ ...sighting, status: sighting.status ?? 'surveyed' }))
  } catch {
    return []
  }
}

/* --- The seeded observations ------------------------------------------

   A survey that has only ever recorded three animals and never observed
   one is not a survey, so the log starts with a history in it. These are
   the same fiction the three cats are (cats.seed.ts, and spec §9 before
   that changes), and they exist so the record has something to show.

   ## Why the points are centroids

   catsRepo.listTerritories applies the newest sighting by translating a
   cat's territory onto the reported point. A seeded sighting at any other
   position would therefore silently move the hand-drawn outlines away from
   where territories.geo.json puts them, on first load, before anybody has
   done anything. Putting each seed on its own territory's centroid makes
   that translation a no-op: translateToward computes its offset with the
   same ringCentroid on the same ring, so the offset is exactly zero.

   Derived rather than written out for the same reason. Three hardcoded
   coordinate pairs would be three chances to be a metre off, and they would
   rot the first time a polygon is redrawn. */
const CENTRES = centroidsById(baseTerritories as FeatureCollection<Polygon>)

const DAY = 24 * 60 * 60 * 1000

/* One cataas id per cat, the same id cats.seed.ts uses for that animal's
   portrait. That is the whole rule: a run of sightings of one cat has to be
   a run of photographs of one cat, and an id is what guarantees it. Sizes
   vary between records, because a photograph taken on a phone in the street
   is not the same crop every time; the id underneath does not.

   Written out rather than imported from cats.seed.ts. This file is loaded
   directly by node for its check (see the note at the top on relative
   imports), and the duplication is nine strings against a second module in
   that path. sightings.check.ts asserts every seeded cat is a real one and
   that every cat has at least one record, so the two files cannot drift
   apart quietly.

   Every cat gets at least one, which is what makes "Last seen" render on
   every plate. The counts are deliberately uneven: a survey where every
   animal has been observed exactly the same number of times is a survey
   nobody actually walked. */
const CAT = (id: string, w: number, h: number) =>
  `https://cataas.com/cat/${id}?width=${w}&height=${h}`

const SEEDS: { catId: string; daysAgo: number; photo?: string }[] = [
  { catId: 'milo', daysAgo: 0.3, photo: CAT('04eEQhDfAL8l5nt3', 640, 480) },
  { catId: 'milo', daysAgo: 2, photo: CAT('04eEQhDfAL8l5nt3', 600, 450) },
  { catId: 'milo', daysAgo: 9, photo: CAT('04eEQhDfAL8l5nt3', 560, 420) },
  { catId: 'milo', daysAgo: 26, photo: CAT('04eEQhDfAL8l5nt3', 520, 390) },
  { catId: 'biscuit', daysAgo: 1.5, photo: CAT('05Xd4JtN14983pns', 640, 480) },
  /* Deliberately without one. Every sighting a visitor can actually make
     today has no photograph attached, so the log has to contain one and
     the plate has to render correctly around it. */
  { catId: 'biscuit', daysAgo: 6 },
  { catId: 'biscuit', daysAgo: 20, photo: CAT('05Xd4JtN14983pns', 560, 420) },
  { catId: 'tala', daysAgo: 0.8, photo: CAT('09wFxpacQzvf9jfM', 640, 480) },
  { catId: 'tala', daysAgo: 4, photo: CAT('09wFxpacQzvf9jfM', 600, 450) },
  { catId: 'tala', daysAgo: 15, photo: CAT('09wFxpacQzvf9jfM', 520, 390) },

  { catId: 'pandan', daysAgo: 1.1, photo: CAT('0B2g7aTANObiqPJJ', 640, 480) },
  { catId: 'pandan', daysAgo: 12, photo: CAT('0B2g7aTANObiqPJJ', 560, 420) },
  { catId: 'ube', daysAgo: 0.6, photo: CAT('0BTTVEVWXNyOgXYd', 640, 480) },
  { catId: 'ube', daysAgo: 7, photo: CAT('0BTTVEVWXNyOgXYd', 600, 450) },
  { catId: 'ube', daysAgo: 33, photo: CAT('0BTTVEVWXNyOgXYd', 520, 390) },
  /* The newest cat on the survey, so one record and nothing behind it. */
  { catId: 'kidlat', daysAgo: 2.4, photo: CAT('0C2bQ39x8kuhx31p', 640, 480) },
  { catId: 'bagyo', daysAgo: 3.2, photo: CAT('0DVs2d6bIVIt3ehk', 640, 480) },
  { catId: 'bagyo', daysAgo: 18, photo: CAT('0DVs2d6bIVIt3ehk', 560, 420) },
  { catId: 'alon', daysAgo: 0.9, photo: CAT('0EsIYDG0at0TPpPD', 640, 480) },
  { catId: 'alon', daysAgo: 11, photo: CAT('0EsIYDG0at0TPpPD', 600, 450) },
  { catId: 'ligaya', daysAgo: 1.8, photo: CAT('0F0IKAPOdWiE755P', 640, 480) },
  { catId: 'ligaya', daysAgo: 5, photo: CAT('0F0IKAPOdWiE755P', 560, 420) },
  { catId: 'ligaya', daysAgo: 29, photo: CAT('0F0IKAPOdWiE755P', 520, 390) },
  { catId: 'buko', daysAgo: 4.5, photo: CAT('0GC9MRUAqxhBzPyA', 640, 480) },
  /* A second one without a photograph, for the same reason as biscuit's:
     the state a real visitor's report lands in should not be rare in the
     seeded data either. */
  { catId: 'buko', daysAgo: 16 },
  { catId: 'maya', daysAgo: 2.7, photo: CAT('0M0Lo3dsYft79xNd', 640, 480) },
  { catId: 'maya', daysAgo: 22, photo: CAT('0M0Lo3dsYft79xNd', 600, 450) },
  { catId: 'nilad', daysAgo: 6.3, photo: CAT('0mstmOIucwiN80jb', 640, 480) },
  { catId: 'nilad', daysAgo: 14, photo: CAT('0mstmOIucwiN80jb', 560, 420) },
  { catId: 'nilad', daysAgo: 41, photo: CAT('0mstmOIucwiN80jb', 520, 390) },
]

/* Relative to load, not absolute dates. describeWhen says "Today" and
   "Yesterday" for the two days anyone thinks in, and a demo whose most
   recent observation is a fixed date in 2026 reads as abandoned the week
   after it is written.

   A cat with no territory is skipped rather than defaulted: without a
   polygon there is no centroid, and a sighting at [0, 0] would drag the
   whole survey into the Gulf of Guinea. */
const SEEDED: Sighting[] = SEEDS.flatMap((seed, index) => {
  const point = CENTRES.get(seed.catId)
  if (!point) return []
  return [
    {
      id: `seed-${seed.catId}-${index}`,
      catId: seed.catId,
      point,
      at: Date.now() - seed.daysAgo * DAY,
      photo: seed.photo,
      /* The survey's own recorded history, so it is reviewed by definition.
         These never appear in the queue and never need a verdict. */
      status: 'surveyed',
    },
  ]
})

/* Everything the survey has observed: the seeded history plus whatever this
   browser has reported.

   Kept separate from readSightings, and that separation is the point rather
   than tidiness. The two write paths below both work by filtering what
   readSightings returned and writing the result back, so if readSightings
   included the seeds, the first undo anybody pressed would persist all ten
   of them into that visitor's localStorage, where they would then survive
   any future change to this file. Reads that want the whole picture call
   this; writes call readSightings and only ever touch what was stored. */
export function allSightings(): Sighting[] {
  return [...SEEDED, ...readSightings()]
}

function write(list: Sighting[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** A visitor's report. Lands `pending`: it is a submission, not a fact, and
    nothing on the public map moves until somebody has reviewed it. */
export function addSighting(catId: string, point: [number, number], at: number): Sighting | null {
  const sighting: Sighting = {
    id: `${catId}-${at}-${Math.random().toString(36).slice(2, 7)}`,
    catId,
    point,
    at,
    status: 'pending',
  }
  return write([...readSightings(), sighting]) ? sighting : null
}

/** Undo, and withdraw, which are the same operation at two speeds: the
    nine-second toast and the plate's own log. One sighting by id, not "the
    last one": by the time somebody presses undo, another tab could have
    added a different one, and removing whatever happens to be last would
    silently delete the wrong record.

    Deletes rather than marking, unlike an admin's discard. Nothing was
    published and no decision was made, so there is nothing to keep. */
export function removeSighting(id: string): boolean {
  return write(readSightings().filter((sighting) => sighting.id !== id))
}

/** An admin's verdict. Writes the decision onto the record rather than
    removing it either way, which is what makes the audit trail possible:
    every sighting keeps who, what, where and when, and now also what was
    decided about it.

    Only ever touches stored sightings. The seeded history is the survey's
    own and is not in the queue to begin with, so an id that names one is a
    no-op rather than an error. */
export function reviewSighting(id: string, verdict: 'surveyed' | 'discarded'): boolean {
  const stored = readSightings()
  if (!stored.some((sighting) => sighting.id === id)) return false
  return write(
    stored.map((sighting) => (sighting.id === id ? { ...sighting, status: verdict } : sighting))
  )
}

/** The newest sighting per cat. Older ones are kept rather than overwritten,
    because a list of observations over time is the thing this data actually
    is, and a review queue will need all of them. */
export function latestByCat(list: Sighting[] = allSightings()): Map<string, Sighting> {
  const byCat = new Map<string, Sighting>()
  for (const sighting of list) {
    const current = byCat.get(sighting.catId)
    if (!current || sighting.at > current.at) byCat.set(sighting.catId, sighting)
  }
  return byCat
}

/* --- Geometry ---------------------------------------------------------- */

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
