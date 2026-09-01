import assert from 'node:assert/strict'
import type { Feature, Polygon } from 'geojson'
import { decoyPoint, decoyFeature } from './decoy'

/* Run: npm run check:decoy (no test runner in this project, see
   package.json). Pure geometry only: no Firestore, no DOM, no map/style
   import (that module needs maplibre-gl and a browser). */

const BGC_CENTER: [number, number] = [121.05, 14.5512]
/* Loose: the decoy box half-span is ~0.012 deg, plus a territory's own
   half-width. Anything inside 0.02 deg of centre is "somewhere in BGC",
   which is all this needs to prove. */
const MAX_OFFSET_DEG = 0.02

const SEED_IDS = ['milo', 'tala', 'mingming', 'ashes', 'biryani', 'zero', 'luna', 'pretzel']

// --- decoyPoint: inside the box, and stable ----------------------------
for (const id of SEED_IDS) {
  const [lng, lat] = decoyPoint(id)
  assert.ok(Math.abs(lng - BGC_CENTER[0]) < MAX_OFFSET_DEG, `${id} decoy lng near BGC`)
  assert.ok(Math.abs(lat - BGC_CENTER[1]) < MAX_OFFSET_DEG, `${id} decoy lat near BGC`)
  assert.deepEqual(decoyPoint(id), decoyPoint(id), `${id} decoy is stable across calls`)
}

// distinct ids get distinct points
const points = SEED_IDS.map((id) => decoyPoint(id).join(','))
assert.equal(new Set(points).size, SEED_IDS.length, 'decoy points are distinct per id')

// --- decoyFeature: shape and size preserved, centroid moved -----------
function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

const square: Feature<Polygon> = {
  type: 'Feature',
  properties: { id: 'milo' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [121.09, 14.58],
        [121.091, 14.58],
        [121.091, 14.581],
        [121.09, 14.581],
        [121.09, 14.58],
      ],
    ],
  },
}

const moved = decoyFeature(square, 'milo')
const src = square.geometry.coordinates[0] as [number, number][]
const dst = moved.geometry.coordinates[0] as [number, number][]

assert.equal(dst.length, src.length, 'vertex count preserved')
for (let i = 1; i < src.length; i++) {
  const a = dist(src[i - 1], src[i])
  const b = dist(dst[i - 1], dst[i])
  assert.ok(Math.abs(a - b) < 1e-9, `edge ${i} length preserved`)
}

// mean-of-vertices centroid of the moved ring lands near decoyPoint. This
// is a rough centroid, not translateToward's ringCentroid; the tolerance
// absorbs the difference for a near-regular ring. If this ever fails,
// loosen the tolerance, do not import the impl's centroid helper.
const cx = dst.reduce((s, p) => s + p[0], 0) / dst.length
const cy = dst.reduce((s, p) => s + p[1], 0) / dst.length
const [tx, ty] = decoyPoint('milo')
assert.ok(Math.abs(cx - tx) < 3e-3 && Math.abs(cy - ty) < 3e-3, 'moved centroid near decoy point')

// a different id moves the same shape somewhere else
const movedElsewhere = decoyFeature(square, 'tala')
const other = movedElsewhere.geometry.coordinates[0] as [number, number][]
assert.ok(dist(dst[0], other[0]) > 1e-4, 'different id places the decoy elsewhere')

console.log('decoy.check.ts OK')
