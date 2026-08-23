import type { Feature, Polygon } from 'geojson'
import type { Cat } from './cats.seed'

/* Cats recorded in the browser, backing the "record a cat" panel
   (ui/RecordCat.tsx). Storage and geometry only: what a recorded cat IS
   lives in catsRepo.ts, which is the file that already exists to be the
   seam between seeded data and a real one.

   localStorage rather than a server, deliberately and temporarily. This is
   a mock so the flow can be presented and argued with before anything is
   built to hold it: a recorded cat lives on one device, in one browser, and
   goes away when that browser's storage is cleared. Nothing here assumes
   that stays true, which is why the shape stored is a whole Cat plus the
   two numbers its territory is drawn from, rather than a private format
   that would have to be migrated later.

   The safety rule (spec §9, catsRepo.ts) survives this feature and shapes
   it: `Cat` still has no location field. The point the person clicked is
   stored beside the cat as the seed for a POLYGON, exactly as the seeded
   cats' points are, and what the app ever renders is the area, never the
   point. That is also why the panel makes you set a radius rather than just
   dropping a pin. */

const KEY = 'meowtro.cats.v1'

/** What the panel collects. Everything else on a Cat is derived (see
    catsRepo.addCat): the plate number counts, the coordinates are the
    territory's own centre, and the date is today. */
export type CatDraft = {
  name: string
  description: string
  note: string
  photo: string
  line: string
  colour: Cat['colour']
  /** Where the person clicked. Becomes the centre of the ring below. */
  center: [number, number]
  /** Rough radius in metres, off the panel's slider. */
  radiusM: number
}

export type StoredCat = {
  cat: Cat
  center: [number, number]
  radiusM: number
}

/* localStorage is a string the user can edit, a different version of this
   app can have written, and a browser can truncate. Everything read out of
   it is checked before it reaches MapLibre, because the failure mode
   otherwise is not a wrong cat, it is a malformed polygon thrown into
   addSource, which takes the whole map down with it and leaves a blank
   screen with a console error nobody presenting this would see coming. */
function isStored(value: unknown): value is StoredCat {
  if (!value || typeof value !== 'object') return false
  const { cat, center, radiusM } = value as Partial<StoredCat>
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
    radiusM > 0
  )
}

export function readStored(): StoredCat[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isStored) : []
  } catch {
    /* Private-mode Safari throws on getItem, and a half-written value
       throws on parse. Both mean the same thing to a caller: there are no
       recorded cats. The seeded three still render. */
    return []
  }
}

/** @returns false when the write failed (quota, private mode), so the panel
    can say so instead of pretending it saved. */
export function writeStored(list: StoredCat[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/* Metres per degree, on the sphere MapLibre itself measures with: its
   LngLat.distanceTo uses a mean earth radius of 6371008.8m. Matching the
   renderer's own model rather than the WGS84 ellipsoid is deliberate. The
   two disagree by about half a percent at this latitude, and while the
   ellipsoid is the more accurate description of the planet, the sphere is
   the more accurate description of THIS MAP: it means a radius the panel
   calls 90m is 90m to every other distance the app could ever compute. */
const EARTH_RADIUS_M = 6371008.8
const M_PER_DEG = (Math.PI * EARTH_RADIUS_M) / 180

/** Points around the ring. 48 is smooth at the zoom a territory is read at
    and still a small polygon to store; the seeded territories are drawn at a
    similar density. */
const RING_STEPS = 48

/* A circle, because every territory in territories.geo.json is already one
   (see centroid.ts's note) and because a rough area is the only shape this
   app is willing to state. A polygon editor would let someone trace a real
   cat's actual movements, which is precisely the thing spec §9 exists to
   stop.

   Plain trigonometry rather than turf.js: turf is 200KB+ for a project that
   needs exactly one of its functions, and the equirectangular approximation
   is accurate to well under a metre over a 250 metre radius at 14 degrees
   north (checked, not assumed). Coordinates are rounded to six decimals, about 10cm, matching the
   seeded file rather than storing float noise. */
export function circleRing(center: [number, number], radiusM: number): [number, number][] {
  const [lng, lat] = center
  const dLat = radiusM / M_PER_DEG
  const dLng = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  const round = (n: number) => Math.round(n * 1e6) / 1e6

  const ring: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    ring.push([round(lng + dLng * Math.cos(angle)), round(lat + dLat * Math.sin(angle))])
  }
  // GeoJSON rings must close: last point identical to the first, not merely
  // near it. Pushing the same array element is what guarantees that.
  ring.push(ring[0])
  return ring
}

export function circleFeature(stored: StoredCat): Feature<Polygon> {
  return {
    type: 'Feature',
    // The same two properties the seeded features carry, because
    // Territories reads `id` off the feature and promotes it for
    // feature-state, and nothing downstream may care where a cat came from.
    properties: { id: stored.cat.id, name: stored.cat.name },
    geometry: { type: 'Polygon', coordinates: [circleRing(stored.center, stored.radiusM)] },
  }
}

/** URL-safe, collision-checked by the caller. Falls back to a timestamp so a
    name written entirely in a non-latin script still produces an id rather
    than an empty string. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `cat-${Date.now().toString(36)}`
}
