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
  /* Storage was started by emulators:exec from the first version of this
     file and never actually exercised, which meant storage.rules shipped
     with no coverage at all: the reason a blanket `allow write` (create,
     overwrite AND delete for any signed-in visitor, on a path printed
     inside every photo's own public URL) sat there unnoticed. */
  storage: { rules: readFileSync('storage.rules', 'utf8'), host: 'localhost', port: 9199 },
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
  // The published record: what a signed-out visitor is allowed to see.
  await db.doc('sightings/surveyed-1').set({
    catId: 'milo',
    status: 'surveyed',
    authorUid: VISITOR_UID,
    at: Date.now(),
    votes: { up: 0, down: 0 },
  })
  // Two turned-down reports with different authors, so "my own discarded"
  // and "somebody else's discarded" can be told apart below. They are the
  // whole reason the read rule needs four branches rather than two.
  await db.doc('sightings/discarded-1').set({
    catId: 'milo',
    status: 'discarded',
    authorUid: VISITOR_UID,
    at: Date.now(),
  })
  await db.doc('sightings/discarded-2').set({
    catId: 'milo',
    status: 'discarded',
    authorUid: OTHER_UID,
    at: Date.now(),
  })
})

const anon = testEnv.unauthenticatedContext().firestore()
const visitor = testEnv.authenticatedContext(VISITOR_UID).firestore()
const other = testEnv.authenticatedContext(OTHER_UID).firestore()
const admin = testEnv.authenticatedContext(ADMIN_UID).firestore()

// Cats are public outright, signed in or not.
await assertSucceeds(anon.doc('cats/milo').get())

/* --- Reading a sighting -------------------------------------------------
   Four branches in firestore.rules, exercised one reader at a time. */

// Surveyed is the public map: anyone, including signed out.
await assertSucceeds(anon.doc('sightings/surveyed-1').get())
await assertSucceeds(visitor.doc('sightings/surveyed-1').get())

// Pending is NOT public any more. A signed-out read of an open report used
// to succeed, which handed its exact point to anybody with the REST
// endpoint; this assertion is the one that changed from assertSucceeds.
await assertFails(anon.doc('sightings/pending-1').get())

// A signed-in stranger CAN read a pending report, and must be able to:
// that is corroboration voting, which is open to every visitor rather than
// to the author or an admin alone.
await assertSucceeds(other.doc('sightings/pending-1').get())
await assertSucceeds(visitor.doc('sightings/pending-1').get())

// Discarded belongs to the audit trail. Your own is readable (About's
// "yours" count needs it); somebody else's is admin-only.
await assertSucceeds(visitor.doc('sightings/discarded-1').get())
await assertFails(other.doc('sightings/discarded-1').get())
await assertFails(anon.doc('sightings/discarded-1').get())
await assertSucceeds(admin.doc('sightings/discarded-1').get())
await assertSucceeds(admin.doc('sightings/discarded-2').get())

/* --- Listing sightings --------------------------------------------------

   The four queries data/sightings.ts actually issues, asserted as queries
   rather than as per-document gets. That distinction is the whole point:
   Firestore refuses a list request outright when the result set could
   contain a document the rule denies, so a read rule can be correct
   document by document and still break every page load. These are the
   assertions that would catch that. */

const sightings = (ctx) => ctx.collection('sightings')

// listPublicSightings: surveyed only, open to a signed-out visitor.
await assertSucceeds(sightings(anon).where('status', '==', 'surveyed').get())

// listVisibleSightings, signed in: surveyed plus pending, whoever filed it.
await assertSucceeds(sightings(visitor).where('status', 'in', ['surveyed', 'pending']).get())
await assertSucceeds(sightings(other).where('status', 'in', ['surveyed', 'pending']).get())

// listMySightings: every status, but only your own.
await assertSucceeds(sightings(visitor).where('authorUid', '==', VISITOR_UID).get())
// The same query aimed at somebody else sweeps up their discarded report,
// which no non-admin may read, so the whole list is refused.
await assertFails(sightings(other).where('authorUid', '==', VISITOR_UID).get())

// listAllSightingsForAdmin: the unfiltered read, and only for an admin.
await assertFails(sightings(anon).get())
await assertFails(sightings(visitor).get())
await assertSucceeds(sightings(admin).get())

// Only an admin can write a cat...
await assertFails(visitor.doc('cats/milo').set({ name: 'MILO 2' }))
await assertSucceeds(admin.doc('cats/milo').set({ name: 'MILO 2' }))

// ...except pendingCount, which any signed-in visitor may nudge (the same
// trust the `votes` tally on a sighting already gets, so a signed-out
// visitor's plate can know a report exists without ever reading it).
await assertSucceeds(visitor.doc('cats/milo').update({ pendingCount: 1 }))
// Riding another field in on the same write is what the rule actually
// guards against: a visitor could otherwise smuggle any change through by
// pairing it with a legitimate pendingCount nudge.
await assertFails(other.doc('cats/milo').update({ pendingCount: 2, name: 'MILO 3' }))
// Signed out cannot touch it at all.
await assertFails(anon.doc('cats/milo').update({ pendingCount: 1 }))

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

// Any signed-in user may update the votes field alone on an OPEN report;
// not any other field.
await assertSucceeds(
  other.doc('sightings/pending-2').update({ votes: { up: 1, down: 0 } })
)
await assertFails(
  other.doc('sightings/pending-2').update({ status: 'surveyed' })
)

// A decided sighting has nothing left to corroborate, so the votes-only
// branch does not apply to one. voteSighting's own transaction refuses
// this too, but that check runs in a client, and a client can be skipped.
await assertFails(
  other.doc('sightings/surveyed-1').update({ votes: { up: 1, down: 0 } })
)
await assertFails(
  other.doc('sightings/discarded-1').update({ votes: { up: 1, down: 0 } })
)

// Only an admin may set a verdict.
await assertFails(other.doc('sightings/pending-2').update({ status: 'discarded' }))
await assertSucceeds(admin.doc('sightings/pending-2').update({ status: 'discarded' }))

// A vote sub-document is writable only by the uid it is keyed on.
await assertFails(other.doc('sightings/pending-2/votes/' + VISITOR_UID).set({ direction: 'up' }))
await assertSucceeds(visitor.doc('sightings/pending-2/votes/' + VISITOR_UID).set({ direction: 'up' }))

/* --- Feeder tier (spec 2026-09-01) ------------------------------------

   feeders/{uid} is an admin-written marker, mirroring admins/{uid}.
   feederRequests/{uid} is a visitor's application: theirs to create and
   withdraw, an admin's to read and clear, never updated in place. */

const VALID_REQUEST = { name: 'Vee', email: 'vee@example.com', reason: 'I feed the 30th St colony', at: Date.now() }

// A signed-in visitor may file their own request; not one at another uid's
// path, not one with an extra field, not one with an oversized reason.
await assertSucceeds(visitor.doc('feederRequests/' + VISITOR_UID).set(VALID_REQUEST))
await assertFails(visitor.doc('feederRequests/' + OTHER_UID).set(VALID_REQUEST))
await assertFails(
  other.doc('feederRequests/' + OTHER_UID).set({ ...VALID_REQUEST, role: 'admin' })
)
await assertFails(
  other.doc('feederRequests/' + OTHER_UID).set({ ...VALID_REQUEST, reason: 'x'.repeat(501) })
)
await assertFails(anon.doc('feederRequests/anon-1').set(VALID_REQUEST))

// Readable by its author and by an admin; not by another visitor.
await assertSucceeds(visitor.doc('feederRequests/' + VISITOR_UID).get())
await assertSucceeds(admin.doc('feederRequests/' + VISITOR_UID).get())
await assertFails(other.doc('feederRequests/' + VISITOR_UID).get())

// Never updated in place, by anyone.
await assertFails(visitor.doc('feederRequests/' + VISITOR_UID).update({ reason: 'changed' }))
await assertFails(admin.doc('feederRequests/' + VISITOR_UID).update({ reason: 'changed' }))

// The marker: only an admin writes it.
await assertFails(visitor.doc('feeders/' + VISITOR_UID).set({ at: Date.now() }))
await assertSucceeds(admin.doc('feeders/' + VISITOR_UID).set({ at: Date.now() }))
// Any signed-in caller may read a marker (the map tier check); signed out
// may not.
await assertSucceeds(other.doc('feeders/' + VISITOR_UID).get())
await assertFails(anon.doc('feeders/' + VISITOR_UID).get())

// A visitor withdraws their own request; a stranger cannot.
await assertFails(other.doc('feederRequests/' + VISITOR_UID).delete())
await assertSucceeds(visitor.doc('feederRequests/' + VISITOR_UID).delete())

/* --- Storage ------------------------------------------------------------

   RulesTestContext.storage() hands back a compat (v8-shaped) Storage
   instance, per @firebase/rules-unit-testing's own public types, so these
   go through `ref(path).put(data, metadata)` rather than the modular
   uploadBytes the app itself uses. A Uint8Array payload because node has
   no File and does not need one: `put` takes Blob | Uint8Array |
   ArrayBuffer, and the rules only ever look at size and contentType. */

const IMAGE_BYTES = new Uint8Array(1024)
const OVERSIZED_BYTES = new Uint8Array(6 * 1024 * 1024)
const JPEG = { contentType: 'image/jpeg' }

const anonStorage = testEnv.unauthenticatedContext().storage()
const visitorStorage = testEnv.authenticatedContext(VISITOR_UID).storage()
const otherStorage = testEnv.authenticatedContext(OTHER_UID).storage()

// A signed-in visitor may add a photo; an anonymous one may not.
await assertSucceeds(visitorStorage.ref('sightings/new-1.jpg').put(IMAGE_BYTES, JPEG))
await assertFails(anonStorage.ref('sightings/anon-1.jpg').put(IMAGE_BYTES, JPEG))

// Size and type are still bounded: this uploader accepts images, not an
// arbitrary file store, and not one 6MB object at a time.
await assertFails(visitorStorage.ref('sightings/huge-1.jpg').put(OVERSIZED_BYTES, JPEG))
await assertFails(
  visitorStorage.ref('sightings/not-an-image.pdf').put(IMAGE_BYTES, { contentType: 'application/pdf' })
)

/* Nobody overwrites or deletes an existing object, their own included.
   Every photo's path is printed inside its own public download URL, so
   `allow write` was a standing invitation to replace or erase any cat's
   photograph; data/photoUpload.ts mints a fresh random path every time and
   has never needed either verb. A put to a path that already holds an
   object is an `update` to Storage rules, which is what makes the first
   two of these the overwrite case. */
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.storage().ref('cats/existing-1.jpg').put(IMAGE_BYTES, JPEG)
})
await assertFails(otherStorage.ref('cats/existing-1.jpg').put(IMAGE_BYTES, JPEG))
await assertFails(visitorStorage.ref('cats/existing-1.jpg').put(IMAGE_BYTES, JPEG))
await assertFails(visitorStorage.ref('cats/existing-1.jpg').delete())
await assertFails(visitorStorage.ref('sightings/new-1.jpg').delete())

// Reading a photo is public, the same way the map that shows it is.
await assertSucceeds(anonStorage.ref('cats/existing-1.jpg').getDownloadURL())

await testEnv.cleanup()
console.log('rules: ok')
