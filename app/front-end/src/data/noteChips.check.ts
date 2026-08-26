import assert from 'node:assert/strict'
import { BUILTIN_NOTE_CHIPS, mergeChip } from './noteChips'

/* Run: npm run check:notechips. readChips/addChip touch window.localStorage
   and degrade to a no-op under node with no window — same intended
   degradation data/sightings.ts's own check script relies on — so only
   the pure mergeChip is checked directly here. */

assert.deepEqual(mergeChip([], 'Follows the mail carrier'), ['Follows the mail carrier'])

assert.deepEqual(
  mergeChip(['Follows the mail carrier'], 'Follows the mail carrier'),
  ['Follows the mail carrier'],
  'an exact duplicate should not be added twice'
)

assert.deepEqual(
  mergeChip(['Follows the mail carrier'], 'follows the mail carrier'),
  ['Follows the mail carrier'],
  'a duplicate that only differs in case should still be rejected'
)

assert.deepEqual(mergeChip(['a'], '  b  '), ['a', 'b'], 'a phrase should be trimmed before storing')

assert.deepEqual(mergeChip(['a'], ''), ['a'], 'an empty phrase must not be added')
assert.deepEqual(mergeChip(['a'], '   '), ['a'], 'a whitespace-only phrase must not be added')

for (const builtin of BUILTIN_NOTE_CHIPS) {
  assert.deepEqual(
    mergeChip([], builtin),
    [],
    `"${builtin}" duplicates a built-in chip and should not become a personal one too`
  )
}

const long = Array.from({ length: 25 }, (_, i) => `phrase ${i}`)
assert.equal(mergeChip(long, 'newest').length, 20, 'the personal list should be capped, not grow without bound')
assert.ok(mergeChip(long, 'newest').includes('newest'), 'the newest phrase should survive the cap')
assert.ok(!mergeChip(long, 'newest').includes('phrase 0'), 'the cap should drop the oldest entries, not the newest')

console.log('noteChips: ok')
