import type { Cat } from './cats.seed'

/* Territory geometry: pure math, no storage. Split out of localCats.ts
   when that file's storage half moved to Firestore (Phase 9); this half
   has no reason to move anywhere, since drawing a shape was never
   localStorage-specific to begin with. Everything below is copied
   verbatim from localCats.ts, comments included, aside from the one new
   CatDraft field (authorUid) Phase 9 adds. */

/** What the panel collects. Everything else on a Cat is derived (see
    catsRepo.addCat): the plate number counts, the coordinates are the
    territory's own centre, and the date is today. */
export type CatDraft = {
  name: string
  description: string
  note: string
  photo: string
  /** Left empty by the form itself: ui/RecordCat.tsx overwrites this at
      submit with a place name looked up against the point just placed
      (map/landmark.ts's nearestPlaceName), the same derivation every other
      "collected" field here gets. Just the place half ("9TH AVENUE"), not
      the whole "LINE NN · ..." string: the number in front of it is
      catsRepo.addCat's own job (nextLineNumber), so this stays empty when
      nothing named is nearby enough to name and addCat's own "FIELD
      ENTRY" fallback fires instead. */
  line: string
  colour: Cat['colour']
  shape: Shape
  /** Extra photos for the plate's photo pile, already compressed to a
      data URI each (see ui/imageToDataUrl.ts). Never stored on the cat
      itself: catsRepo.addCat turns each one into its own surveyed
      Sighting, so this array only ever exists for the length of one
      submit. */
  extraPhotos: string[]
  /** Where the person clicked. Becomes the centre of the ring below. */
  center: [number, number]
  /** Rough radius in metres, off the panel's slider. */
  radiusM: number
  /** The signed-in admin recording this cat (Phase 9). Every extra photo
      becomes its own admin sighting (catsRepo.addCat), which needs an
      author the same way any other sighting does. */
  authorUid: string
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

/** The five territories an admin can pick, alongside the colour. `round`
    is exactly what this app has always drawn: a plain circle, zero
    deformation, so a shape picker never quietly changes an existing look.
    The other four are still `Polygon` rings built off the same loop, only
    warped, and warped by real data rather than a formula: each one is the
    actual outline of a named cat's seeded territory (territories.geo.json),
    normalised to a unit radius and re-sampled at this loop's own 48 angles
    (see REAL_SHAPES below for exactly which cat and how). Nothing here is a
    "real" circle or rectangle primitive any more than the seeded
    territories always were; the four non-circle picks now trace the same
    kind of irregular outline a hand survey actually produces, at whatever
    centre and radius the admin draws, instead of a synthetic curve that
    only looked like one. */
export type Shape = 'round' | 'elongated' | 'notched' | 'blocky' | 'ragged'

export const SHAPES: { id: Shape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'elongated', label: 'Elongated' },
  { id: 'notched', label: 'Notched' },
  { id: 'blocky', label: 'Blocky' },
  { id: 'ragged', label: 'Ragged' },
]

/* One borrowed outline per non-round shape, traced from an actual seeded
   territory rather than invented. Each array is that cat's real polygon
   (territories.geo.json), centred on its own centroid, every point's
   distance from centre divided by the mean distance (so the shape is a
   unit-radius multiplier, reusable at any radiusM), then re-sampled at this
   file's own 48 even angle-steps by linear interpolation between the
   nearest two real vertices. Regenerate with:

     node -e "
       const data = require('./territories.geo.json')
       const RING_STEPS = 48
       function extract(id) {
         const f = data.features.find((f) => f.properties.id === id)
         const ring = f.geometry.coordinates[0]
         const n = ring.length - 1
         const pts = ring.slice(0, n)
         const cx = pts.reduce((s, p) => s + p[0], 0) / n
         const cy = pts.reduce((s, p) => s + p[1], 0) / n
         const dists = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))
         const mean = dists.reduce((a, b) => a + b, 0) / n
         const samples = pts
           .map((p, i) => {
             let angle = Math.atan2(p[1] - cy, p[0] - cx)
             if (angle < 0) angle += 2 * Math.PI
             return { angle, r: dists[i] / mean }
           })
           .sort((a, b) => a.angle - b.angle)
         const out = []
         for (let i = 0; i < RING_STEPS; i++) {
           const angle = (i / RING_STEPS) * 2 * Math.PI
           let lo = samples[samples.length - 1], hi = samples[0]
           for (const s of samples) {
             if (s.angle <= angle) lo = s
             if (s.angle >= angle) { hi = s; break }
           }
           let loA = lo.angle, hiA = hi.angle
           if (hiA <= loA) hiA += 2 * Math.PI
           const a2 = angle < loA ? angle + 2 * Math.PI : angle
           const t = hiA === loA ? 0 : (a2 - loA) / (hiA - loA)
           out.push(Math.round((lo.r + (hi.r - lo.r) * t) * 1000) / 1000)
         }
         return out
       }
       console.log(extract('pandan'))
     "

   The four source cats were picked by computing eccentricity (max/min
   normalised radius) and lobe count (local maxima in the normalised radius
   sequence) for all twelve seeded territories, then choosing four with
   distinct character rather than four that happen to look alike: pandan is
   the smoothest of the four (5 lobes), bagyo swings hardest between two
   points (6 lobes, widest single jump), nilad is the most faceted (9
   lobes), and ube is the most eccentric overall. milo/biscuit/tala were
   excluded: at ~1.03 eccentricity they are already near-circles, which
   `round` already covers. */
const REAL_SHAPES: Record<Exclude<Shape, 'round'>, number[]> = {
  elongated: [
    0.907, 0.952, 1.001, 1.044, 1.061, 1.071, 1.072, 1.057, 1.048, 1.042, 1.04, 1.013, 0.972, 0.95,
    0.956, 0.986, 1.004, 1.018, 1.026, 0.991, 0.951, 0.914, 0.971, 1.025, 1.047, 1.055, 1.079, 1.128,
    1.053, 0.998, 0.975, 1.025, 1.039, 1.009, 0.956, 0.911, 0.878, 0.934, 0.996, 1.053, 1.018, 0.989,
    0.984, 0.979, 0.973, 0.965, 0.955, 0.932,
  ],
  notched: [
    1.019, 1.105, 1.124, 1.084, 0.995, 0.953, 0.948, 1.007, 1.002, 0.958, 0.889, 0.901, 0.968, 0.995,
    0.97, 0.894, 0.91, 0.962, 1.055, 1.068, 1.08, 1.098, 1.136, 1.137, 1.095, 1.06, 1.004, 0.93, 0.9,
    0.893, 0.907, 0.98, 1.049, 1.109, 1.023, 0.975, 0.967, 0.949, 0.926, 0.897, 0.947, 0.999, 1.04,
    1.042, 1.033, 1.015, 0.982, 0.981,
  ],
  blocky: [
    1.028, 1.04, 1.048, 1.035, 0.946, 0.903, 0.931, 0.955, 0.978, 1, 1.015, 0.999, 0.946, 0.971,
    0.983, 0.963, 0.945, 0.967, 1.046, 1.019, 0.998, 0.991, 1.052, 1.038, 0.969, 0.908, 0.949, 1.029,
    1.09, 1.068, 1.013, 0.955, 0.93, 0.93, 0.986, 1.03, 1.057, 0.974, 0.944, 0.966, 1.073, 1.124,
    1.083, 1.004, 0.965, 1.013, 1.064, 1.078,
  ],
  ragged: [
    1.058, 0.999, 0.96, 0.946, 1.013, 1.066, 1.102, 1.034, 0.995, 0.981, 0.998, 0.985, 0.942, 1.01,
    1.051, 1.049, 0.995, 0.942, 0.899, 0.87, 0.895, 0.998, 1.101, 1.116, 1.033, 0.982, 0.964, 0.975,
    1.029, 1.039, 1.024, 1.002, 0.993, 0.988, 0.959, 0.998, 1.081, 1.04, 0.995, 0.945, 0.932, 0.946,
    0.994, 1.068, 1.076, 0.984, 0.962, 0.985,
  ],
}

/** Territory geometry for any of the five shapes: one shared loop, rounding
    and closing rule; only the per-step multiplier changes, so "the same
    shape looks the same twice" holds without five near-duplicate functions.
    `round` computes its multiplier (always 1); every other shape looks it
    up by ring index from REAL_SHAPES, since a borrowed outline has no
    continuous formula to evaluate at an arbitrary angle, only 48 real
    samples already taken at this exact set of angles.

    Plain trigonometry rather than turf.js: turf is 200KB+ for a project
    that needs exactly one of its functions, and the equirectangular
    approximation is accurate to well under a metre over a 250 metre radius
    at 14 degrees north (checked, not assumed). Coordinates are rounded to
    six decimals, about 10cm, matching the seeded file rather than storing
    float noise. */
export function shapeRing(shape: Shape, center: [number, number], radiusM: number): [number, number][] {
  const [lng, lat] = center
  const dLat = radiusM / M_PER_DEG
  const dLng = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  const round = (n: number) => Math.round(n * 1e6) / 1e6

  const ring: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    const scale = shape === 'round' ? 1 : REAL_SHAPES[shape][i]
    ring.push([
      round(lng + dLng * Math.cos(angle) * scale),
      round(lat + dLat * Math.sin(angle) * scale),
    ])
  }
  // GeoJSON rings must close: last point identical to the first, not merely
  // near it. Pushing the same array element is what guarantees that.
  ring.push(ring[0])
  return ring
}

/** The same per-shape multiplier shapeRing uses, but in a plain unit
    circle (no lng/lat, no metres, radius 1 centred on the origin) rather
    than projected onto the earth. shapeRing's own geometry can't be reused
    directly for this: its output is in degrees-of-longitude/latitude at
    whatever centre and radius the admin picked, which is meaningless as a
    small on-screen icon. This exists so the shape picker's swatches can
    show the *actual* borrowed outline instead of a generic placeholder
    glyph, built from the same data shapeRing draws on the map, not a
    second approximation of it. Callers render it as an SVG `points`
    string sized to their own icon. */
export function shapePreviewPoints(shape: Shape): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    const scale = shape === 'round' ? 1 : REAL_SHAPES[shape][i]
    points.push([Math.cos(angle) * scale, Math.sin(angle) * scale])
  }
  return points
}

/** Firestore rejects nested arrays outright (an array of [lng, lat] pairs is
    an array of arrays), so a ring can't be written as `shapeRing` returns
    it. Flattened to `[lng0, lat0, lng1, lat1, ...]` for storage and paired
    back up on read; every writer (catsRepo.addCat, scripts/migrateSeed.ts)
    and every reader (catsRepo.listTerritories) goes through these two so
    the encoding can't drift between them. */
export function flattenRing(ring: [number, number][]): number[] {
  return ring.flat()
}

export function unflattenRing(flat: number[]): [number, number][] {
  const ring: [number, number][] = []
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]])
  return ring
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
