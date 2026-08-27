import assert from 'node:assert/strict'
import { applyVote, pendingByCat, type Sighting } from './sightings'

/* Run: npm run check:sightings (no test runner in this project, see
   package.json). Phase 9 narrowed this file's scope: everything it
   checked that touched localStorage or the seeded history moved either
   to territoryShape.check.ts (the geometry) or out of node's reach
   entirely (scripts/migrateSeed.ts writes to a real/emulated Firestore,
   and Task 2's rules.test.mjs is what actually exercises Firestore
   writes under a check). What is left here is genuinely pure: no
   localStorage, no network, same as before. */

// --- pendingByCat --------------------------------------------------------
// The map's ghost (map/Territories.tsx) and pending badge (map/
// CatMarkers.tsx) both anchor to whichever sighting this function calls
// "oldest", and the plate's own count next to "Pending review" is this
// function's `count`. Get either one wrong and the map and the plate can
// point at different reports for the same cat.

const at = (id: string, catId: string, status: Sighting['status'], atMs: number): Sighting => ({
  id,
  catId,
  point: [121.05, 14.55],
  at: atMs,
  status,
  authorUid: 'test-uid',
})

const p1 = at('p1', 'milo', 'pending', 300)
const p2 = at('p2', 'milo', 'pending', 100) // oldest of the two on milo
const p3 = at('p3', 'milo', 'pending', 200)
const done = at('d1', 'milo', 'surveyed', 50)
const other = at('p4', 'biscuit', 'pending', 10)

const summary = pendingByCat([p1, p2, p3, done, other])

assert.equal(summary.get('milo')?.oldest.id, 'p2', 'the oldest pending sighting did not win the anchor')
assert.equal(summary.get('milo')?.count, 3, 'pendingByCat miscounted a cat with three open reports')
assert.equal(summary.get('biscuit')?.count, 1, 'a different cat’s own pending report was not counted')
assert.equal(summary.has('nobody'), false, 'a cat with nothing pending should not appear at all')

assert.equal(pendingByCat([done]).size, 0, 'a surveyed sighting was counted as pending')

console.log('pendingByCat: ok')

// --- applyVote -------------------------------------------------------------
// The pure half of voteSighting, checked directly because voteSighting
// itself needs a live/emulated Firestore transaction (Task 2 covers the
// rules; this stays a plain node check of the arithmetic alone).

const fresh = applyVote({}, 'up')
assert.deepEqual(fresh, { votes: { up: 1, down: 0 }, myVote: 'up' }, 'a first vote did not register')

const toggledOff = applyVote(fresh, 'up')
assert.deepEqual(
  toggledOff,
  { votes: { up: 0, down: 0 }, myVote: undefined },
  'pressing the same thumb twice should withdraw the vote, not double it'
)

const switched = applyVote(fresh, 'down')
assert.deepEqual(
  switched,
  { votes: { up: 0, down: 1 }, myVote: 'down' },
  'switching thumbs did not move the vote off the first one'
)

const corrupt = applyVote({ votes: { up: 0, down: 0 }, myVote: 'up' }, 'up')
assert.equal(corrupt.votes?.up, 0, 'withdrawing a vote from an already-zeroed tally went negative')

console.log('applyVote: ok')

console.log('sightings: ok')
