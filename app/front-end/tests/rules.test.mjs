import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'

/* Run under the emulator only: `npm run test:rules` wraps this in
   `firebase emulators:exec`, which is what makes localhost:8080/9199
   exist for initializeTestEnvironment to connect to. Running this file
   directly with node against nothing listening fails at setup, loudly,
   not with a false pass. */

const testEnv = await initializeTestEnvironment({
  projectId: 'meowtro-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
})

const ADMIN_UID = 'admin-1'
const VISITOR_UID = 'visitor-1'
const OTHER_UID = 'visitor-2'

// Seed one cat and one admin marker as the environment owner, bypassing
// rules entirely: this is fixture setup, not something under test.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await db.doc('cats/milo').set({ name: 'MILO' })
  await db.doc('admins/' + ADMIN_UID).set({})
  await db.doc('sightings/pending-1').set({
    catId: 'milo',
    status: 'pending',
    authorUid: VISITOR_UID,
    at: Date.now(),
    votes: { up: 0, down: 0 },
  })
})

const anon = testEnv.unauthenticatedContext().firestore()
const visitor = testEnv.authenticatedContext(VISITOR_UID).firestore()
const other = testEnv.authenticatedContext(OTHER_UID).firestore()
const admin = testEnv.authenticatedContext(ADMIN_UID).firestore()

// Anyone can read cats and sightings, signed in or not.
await assertSucceeds(anon.doc('cats/milo').get())
await assertSucceeds(anon.doc('sightings/pending-1').get())

// Only an admin can write a cat.
await assertFails(visitor.doc('cats/milo').set({ name: 'MILO 2' }))
await assertSucceeds(admin.doc('cats/milo').set({ name: 'MILO 2' }))

// A signed-in visitor can create their own pending sighting; not one
// attributed to somebody else, and not one that skips review.
await assertSucceeds(
  visitor.doc('sightings/self-1').set({
    catId: 'milo',
    status: 'pending',
    authorUid: VISITOR_UID,
    at: Date.now(),
  })
)
await assertFails(
  visitor.doc('sightings/spoofed-1').set({
    catId: 'milo',
    status: 'pending',
    authorUid: OTHER_UID,
    at: Date.now(),
  })
)
await assertFails(
  visitor.doc('sightings/skip-review-1').set({
    catId: 'milo',
    status: 'surveyed',
    authorUid: VISITOR_UID,
    at: Date.now(),
  })
)

// An admin may create a surveyed sighting directly (addAdminPhoto).
await assertSucceeds(
  admin.doc('sightings/admin-photo-1').set({
    catId: 'milo',
    status: 'surveyed',
    authorUid: ADMIN_UID,
    at: Date.now(),
  })
)

// The report's own author can withdraw it while pending; a stranger cannot.
await assertFails(other.doc('sightings/pending-1').delete())
await assertSucceeds(visitor.doc('sightings/pending-1').delete())

// Re-seed for the vote/verdict checks below, since the withdraw above
// consumed pending-1.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().doc('sightings/pending-2').set({
    catId: 'milo',
    status: 'pending',
    authorUid: VISITOR_UID,
    at: Date.now(),
    votes: { up: 0, down: 0 },
  })
})

// Any signed-in user may update the votes field alone; not any other field.
await assertSucceeds(
  other.doc('sightings/pending-2').update({ votes: { up: 1, down: 0 } })
)
await assertFails(
  other.doc('sightings/pending-2').update({ status: 'surveyed' })
)

// Only an admin may set a verdict.
await assertFails(other.doc('sightings/pending-2').update({ status: 'discarded' }))
await assertSucceeds(admin.doc('sightings/pending-2').update({ status: 'discarded' }))

// A vote sub-document is writable only by the uid it is keyed on.
await assertFails(other.doc('sightings/pending-2/votes/' + VISITOR_UID).set({ direction: 'up' }))
await assertSucceeds(visitor.doc('sightings/pending-2/votes/' + VISITOR_UID).set({ direction: 'up' }))

await testEnv.cleanup()
console.log('rules: ok')
