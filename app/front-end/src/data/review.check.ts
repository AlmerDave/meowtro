import assert from 'node:assert/strict'
import { isOwnPending, isSurveyed, type Sighting } from './sightings'

/* The one runnable check behind review, phase 8.

   These two predicates ARE the safety boundary. Every filter in the app is
   one of them: catsRepo applies them asynchronously to build what the
   public map is drawn from, and map/Territories.tsx applies them
   synchronously to decide which observation POINTS get drawn on the map.
   Get either one wrong in the permissive direction and the app publishes an
   unreviewed claim about where a real animal was, which is the single thing
   spec §9 exists to prevent, and it fails silently: the map just quietly
   shows more than it should.

   Updated phase 9: isOwnPending's signature changed from "is this sighting
   in this array of my own reports" (a browser-local readSightings() scan)
   to "does this sighting's authorUid match mine" (an account fact, now
   that everyone signs in to report). Same predicate, same safety boundary,
   different underlying source of "mine".

   Run: npm run check:review (there is no test runner in this project, so
   this compiles itself and runs on node). */

const at = (id: string, status: Sighting['status'], authorUid = 'me'): Sighting => ({
  id,
  catId: 'milo',
  point: [121.05, 14.55],
  at: 0,
  status,
  authorUid,
})

const surveyed = at('a', 'surveyed')
const pending = at('b', 'pending')
const discarded = at('c', 'discarded')

// --- What is published -------------------------------------------------

assert.equal(isSurveyed(surveyed), true, 'surveyed is published')
assert.equal(isSurveyed(pending), false, 'pending is NOT published')
assert.equal(isSurveyed(discarded), false, 'discarded is NOT published')

// --- The one exception, and its limits ---------------------------------

// Mine, and unreviewed: the plate shows it back to me with a withdraw.
assert.equal(isOwnPending(pending, 'me'), true, 'my own pending is visible to me')

// The clause that matters most. Somebody ELSE's pending sighting is not
// mine to see, no matter which surface is asking. If this ever returns true
// for a sighting whose authorUid does not match the asking uid, the
// exception has become the rule.
assert.equal(isOwnPending(pending, 'someone-else'), false, 'a pending sighting I do not own stays hidden')
assert.equal(isOwnPending(pending, null), false, 'a signed-out viewer owns nothing')

// Ownership does not resurrect a decided record. A discarded sighting of
// mine belongs to the audit trail, not to the cat's plate, and an approved
// one is already visible through isSurveyed rather than through this.
assert.equal(isOwnPending(at('d', 'discarded', 'me'), 'me'), false, 'my discarded report is not pending')
assert.equal(isOwnPending(at('e', 'surveyed', 'me'), 'me'), false, 'my approved report is not pending')

// --- The two together, which is how every caller actually uses them -----

// This is the exact composition in catsRepo.listSightings and in
// Territories' "seen elsewhere" zones, asserted as one thing so a change to
// either predicate that breaks the pair fails here.
const visible = (sighting: Sighting, uid: string | null) => isSurveyed(sighting) || isOwnPending(sighting, uid)

const log = [surveyed, pending, discarded, at('f', 'pending', 'someone-else')]
assert.deepEqual(
  log.filter((sighting) => visible(sighting, 'me')).map((s) => s.id),
  ['a', 'b'],
  'a visitor sees published records plus their own unreviewed one, and nothing else'
)
assert.deepEqual(
  log.filter((sighting) => visible(sighting, null)).map((s) => s.id),
  ['a'],
  'a signed-out visitor sees only what is published'
)

console.log('review: ok')
