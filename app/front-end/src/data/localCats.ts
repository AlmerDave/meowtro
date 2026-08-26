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
  shape: Shape
  /** Extra photos for the plate's photo pile, already compressed to a
      data URI each (see ui/imageToDataUrl.ts). Never stored on the cat
      itself — catsRepo.addCat turns each one into its own surveyed
      Sighting, so this array only ever exists for the length of one
      submit. */
  extraPhotos: string[]
  /** Where the person clicked. Becomes the centre of the ring below. */
  center: [number, number]
  /** Rough radius in metres, off the panel's slider. */
  radiusM: number
}

export type StoredCat = {
  cat: Cat
  center: [number, number]
  radiusM: number
  shape: Shape
}

/* localStorage is a string the user can edit, a different version of this
   app can have written, and a browser can truncate. Everything read out of
   it is checked before it reaches MapLibre, because the failure mode
   otherwise is not a wrong cat, it is a malformed polygon thrown into
   addSource, which takes the whole map down with it and leaves a blank
   screen with a console error nobody presenting this would see coming. */
const SHAPE_IDS = new Set<Shape>(['round', 'elongated', 'notched', 'blocky'])

export function isStored(value: unknown): value is StoredCat {
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

export function shapeFeature(stored: StoredCat): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { id: stored.cat.id, name: stored.cat.name },
    geometry: { type: 'Polygon', coordinates: [shapeRing(stored.shape, stored.center, stored.radiusM)] },
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
