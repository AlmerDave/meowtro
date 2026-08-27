import type { Cat } from './cats.seed'

/* Territory geometry: pure math, no storage. Split out of localCats.ts
   when that file's storage half moved to Firestore (Phase 9); this half
   has no reason to move anywhere, since drawing a shape was never
   localStorage-specific to begin with. Everything below is unchanged from
   its original localCats.ts form. */

export type CatDraft = {
  name: string
  description: string
  note: string
  photo: string
  line: string
  colour: Cat['colour']
  shape: Shape
  extraPhotos: string[]
  center: [number, number]
  radiusM: number
  /** The signed-in admin recording this cat (Phase 9). Every extra photo
      becomes its own admin sighting (catsRepo.addCat), which needs an
      author the same way any other sighting does. */
  authorUid: string
}

export type Shape = 'round' | 'elongated' | 'notched' | 'blocky' | 'ragged'

export const SHAPES: { id: Shape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'elongated', label: 'Elongated' },
  { id: 'notched', label: 'Notched' },
  { id: 'blocky', label: 'Blocky' },
  { id: 'ragged', label: 'Ragged' },
]

const EARTH_RADIUS_M = 6371008.8
const M_PER_DEG = (Math.PI * EARTH_RADIUS_M) / 180
const RING_STEPS = 48

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
  ring.push(ring[0])
  return ring
}

export function shapePreviewPoints(shape: Shape): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    const scale = shape === 'round' ? 1 : REAL_SHAPES[shape][i]
    points.push([Math.cos(angle) * scale, Math.sin(angle) * scale])
  }
  return points
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `cat-${Date.now().toString(36)}`
}
