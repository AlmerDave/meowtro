import assert from 'node:assert/strict'
import { distanceM } from './sightings'
import { isStored, shapeRing, type Shape, type StoredCat } from './localCats'

/* Run: npm run check:localcats (no test runner in this project — see
   sightings.check.ts for why a check script compiles itself and runs
   under node instead). */

const CENTER: [number, number] = [121.05, 14.55]
const RADIUS = 90

// 'round' is today's plain circle and must stay one: every point sits
// within a hair of RADIUS metres from the centre, same tolerance the old
// circleRing gave (points are rounded to six decimals, ~10cm).
const round = shapeRing('round', CENTER, RADIUS)
for (const point of round) {
  const d = distanceM(CENTER, point)
  assert.ok(Math.abs(d - RADIUS) < 0.2, `round shape point drifted ${d}m from a ${RADIUS}m radius`)
}

// A ring is a closed GeoJSON polygon boundary: first point repeats last.
for (const shape of ['round', 'elongated', 'notched', 'blocky', 'ragged'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  assert.deepEqual(ring[0], ring[ring.length - 1], `${shape} ring does not close`)
  assert.equal(ring.length, 49, `${shape} ring should have 48 steps plus the closing point`)
}

// The four borrowed-outline templates must not be circles: at least one
// point has to sit meaningfully nearer or farther than RADIUS, or the shape
// picker would just be four names for the same silhouette.
for (const shape of ['elongated', 'notched', 'blocky', 'ragged'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  const distances = ring.map((point) => distanceM(CENTER, point))
  const spread = Math.max(...distances) - Math.min(...distances)
  assert.ok(spread > RADIUS * 0.15, `${shape} is too close to a plain circle (spread ${spread}m)`)
  assert.ok(Math.min(...distances) > 0, `${shape} produced a point on top of its own centre`)
}

// Deterministic: the same shape drawn twice must look identical, or two
// admins picking "Notched" at the same radius would see different
// territories for no visible reason.
assert.deepEqual(
  shapeRing('notched', CENTER, RADIUS),
  shapeRing('notched', CENTER, RADIUS),
  'shapeRing is not deterministic'
)

// isStored must accept a real shape and reject a bogus one, the same
// defensive read every other localStorage-backed list in this app does.
const base: StoredCat = {
  cat: {
    id: 'x',
    name: 'X',
    plate: 'PLATE 01',
    line: 'LINE 00',
    colour: '--cat-rust',
    description: 'd',
    firstRecorded: 'Jan 2026',
    range: 'r',
    disposition: 'Not yet observed',
    coordinates: 'c',
    photo: 'data:image/jpeg;base64,x',
  },
  center: CENTER,
  radiusM: RADIUS,
  shape: 'blocky',
}
assert.equal(isStored(base), true, 'a valid StoredCat with a real shape was rejected')
assert.equal(
  isStored({ ...base, shape: 'triangle' }),
  false,
  'isStored accepted a shape that is not one of the five templates'
)
assert.equal(isStored({ ...base, shape: undefined }), false, 'isStored accepted a missing shape')

console.log('localCats: ok')
