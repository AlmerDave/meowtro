import assert from 'node:assert/strict'
import type { FeatureCollection, Polygon } from 'geojson'
import { allSightings, buildAdminSighting, latestByCat, translateToward } from './sightings'
import baseTerritories from './territories.geo.json'

/* The one runnable check behind the seeded observations.

   The property it defends is not obvious from reading either file on its
   own, which is exactly why it is written down. catsRepo.listTerritories
   applies the newest sighting for a cat by translating that cat's
   territory onto the reported point. Every cat now has seeded sightings,
   so that translation runs on first load, before anybody has done
   anything. It is only harmless because each seed sits on its own
   territory's centroid, which makes the offset exactly zero.

   Nothing throws if that stops being true. The hand-drawn outlines would
   simply be somewhere slightly other than where territories.geo.json puts
   them, on every load, and the way you would find out is by noticing that
   the map looks a bit wrong. Redrawing a polygon, or writing a seed point
   out by hand instead of deriving it, are both one-line changes that would
   do it.

   Run: npm run check:sightings (see package.json -- there is no test
   runner in this project, so this compiles itself and runs on node).

   Note that allSightings() returns the seeds alone here: it reads
   localStorage through readSightings, which is guarded, and node has no
   window for it to read. That is the intended degradation and it is what
   makes this file able to check the seeds in isolation. */

const territories = baseTerritories as FeatureCollection<Polygon>
const seeded = allSightings()

assert.ok(seeded.length > 0, 'no seeded sightings at all')
assert.ok(
  seeded.every((sighting) => sighting.id.startsWith('seed-')),
  'allSightings returned something that was not a seed, so localStorage leaked into node'
)

// The property the territories depend on.
const newest = latestByCat()
for (const feature of territories.features) {
  const id = feature.properties?.id as string
  const sighting = newest.get(id)
  /* A plain throw rather than assert.ok, which does narrow the type in
     principle but only when TypeScript can prove the assertion target's
     declaration, and an imported namespace member does not always qualify. */
  if (!sighting) throw new Error(`${id} has no seeded sighting, so the plate shows no "Last seen"`)
  assert.deepEqual(
    translateToward(feature, sighting.point).geometry.coordinates,
    feature.geometry.coordinates,
    `${id}'s territory moves on load: its newest seed is not on its own centroid`
  )
}

// Newest-wins, which is what makes the line above test the seed that
// actually gets applied rather than an arbitrary one.
for (const id of ['milo', 'biscuit', 'tala']) {
  const mine = seeded.filter((sighting) => sighting.catId === id)
  assert.ok(mine.length > 1, `${id} needs more than one seed for this to mean anything`)
  assert.equal(
    newest.get(id)?.at,
    Math.max(...mine.map((sighting) => sighting.at)),
    `latestByCat did not pick the newest sighting for ${id}`
  )
}

// The optional photo is genuinely optional. Every sighting a visitor can
// make today arrives without one, so a seed without one has to exist or
// the plate is only ever exercised on the easy case.
assert.ok(
  seeded.some((sighting) => sighting.photo === undefined),
  'every seed has a photo, so the photo-less path is never exercised'
)
assert.ok(
  seeded.every((sighting) => sighting.photo === undefined || sighting.photo.startsWith('https://')),
  'a seeded photo is not an https URL'
)

// --- buildAdminSighting, this redesign -----------------------------------
// The pure half of addAdminSighting, checked directly for the same reason
// applyVote is above: addAdminSighting itself degrades to a no-op under
// node (no window.localStorage to write to).

const built = buildAdminSighting('milo', [121.05, 14.55], 1000, 'data:image/jpeg;base64,xyz', 2)
assert.equal(built.catId, 'milo')
assert.deepEqual(built.point, [121.05, 14.55])
assert.equal(built.at, 1000)
assert.equal(built.photo, 'data:image/jpeg;base64,xyz')
assert.equal(built.order, 2)
assert.equal(
  built.status,
  'surveyed',
  'an admin-authored sighting must land surveyed: it is already at the trust level a new cat record itself skips review at, and it has to show in the photo pile immediately'
)
assert.ok(built.id.length > 0, 'buildAdminSighting produced an empty id')

const builtAgain = buildAdminSighting('milo', [121.05, 14.55], 1000, 'data:image/jpeg;base64,xyz', 2)
assert.notEqual(built.id, builtAgain.id, 'two calls with identical inputs collided on id')

console.log('buildAdminSighting: ok')

console.log('sightings: ok')
