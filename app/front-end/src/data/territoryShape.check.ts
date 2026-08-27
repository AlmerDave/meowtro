import assert from 'node:assert/strict'
import { distanceM } from './sightings'
import { shapeRing, type Shape } from './territoryShape'

const CENTER: [number, number] = [121.05, 14.55]
const RADIUS = 90

const round = shapeRing('round', CENTER, RADIUS)
for (const point of round) {
  const d = distanceM(CENTER, point)
  assert.ok(Math.abs(d - RADIUS) < 0.2, `round shape point drifted ${d}m from a ${RADIUS}m radius`)
}

for (const shape of ['round', 'elongated', 'notched', 'blocky', 'ragged'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  assert.deepEqual(ring[0], ring[ring.length - 1], `${shape} ring does not close`)
  assert.equal(ring.length, 49, `${shape} ring should have 48 steps plus the closing point`)
}

for (const shape of ['elongated', 'notched', 'blocky', 'ragged'] as Shape[]) {
  const ring = shapeRing(shape, CENTER, RADIUS)
  const distances = ring.map((point) => distanceM(CENTER, point))
  const spread = Math.max(...distances) - Math.min(...distances)
  assert.ok(spread > RADIUS * 0.15, `${shape} is too close to a plain circle (spread ${spread}m)`)
  assert.ok(Math.min(...distances) > 0, `${shape} produced a point on top of its own centre`)
}

assert.deepEqual(
  shapeRing('notched', CENTER, RADIUS),
  shapeRing('notched', CENTER, RADIUS),
  'shapeRing is not deterministic'
)

console.log('territoryShape: ok')
