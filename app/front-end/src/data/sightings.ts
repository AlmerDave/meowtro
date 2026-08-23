import type { Feature, Polygon } from 'geojson'
import { ringCentroid } from '@/map/centroid'

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

export type Sighting = {
  id: string
  catId: string
  point: [number, number]
  /** Epoch ms. When the cat was seen, which is not the same as when it was
      reported: the panel offers "earlier today" and "yesterday". */
  at: number
}

function isSighting(value: unknown): value is Sighting {
  if (!value || typeof value !== 'object') return false
  const { id, catId, point, at } = value as Partial<Sighting>
  return (
    typeof id === 'string' &&
    typeof catId === 'string' &&
    Array.isArray(point) &&
    point.length === 2 &&
    point.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof at === 'number' &&
    Number.isFinite(at)
  )
}

/* Same reasoning as localCats.ts: this is a string a person can edit and a
   browser can truncate, and a malformed point reaching a polygon reaching
   addSource takes the whole map down with it. */
export function readSightings(): Sighting[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isSighting) : []
  } catch {
    return []
  }
}

function write(list: Sighting[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export function addSighting(catId: string, point: [number, number], at: number): Sighting | null {
  const sighting: Sighting = { id: `${catId}-${at}-${Math.random().toString(36).slice(2, 7)}`, catId, point, at }
  return write([...readSightings(), sighting]) ? sighting : null
}

/** Undo. One sighting by id, not "the last one": by the time somebody
    presses undo, another tab could have added a different one, and removing
    whatever happens to be last would silently delete the wrong record. */
export function removeSighting(id: string): boolean {
  return write(readSightings().filter((sighting) => sighting.id !== id))
}

/** The newest sighting per cat. Older ones are kept rather than overwritten,
    because a list of observations over time is the thing this data actually
    is, and a review queue will need all of them. */
export function latestByCat(list: Sighting[] = readSightings()): Map<string, Sighting> {
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
