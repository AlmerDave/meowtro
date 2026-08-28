import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { CATS } from '../src/data/cats.seed'
import { flattenRing } from '../src/data/territoryShape'

/* One-time push of the twelve seed cats and their sighting history into a
   real Firestore project. Run once, by hand, after Task 2's rules are
   deployed: `npm run seed:firebase`.

   Needs a service account key: Firebase console, Project settings,
   Service accounts, Generate new private key. Save it outside the repo
   (it is a real credential) and point GOOGLE_APPLICATION_CREDENTIALS at
   it:

     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run seed:firebase

   firebase-admin is a devDependency, not a dependency: it never ships to
   the browser bundle, only runs here under node. */

/* A plain cwd-relative path, not import.meta.url: this compiles to
   commonjs (package.json's seed:firebase script, --module commonjs), and
   TypeScript rejects import.meta under that module target outright. A
   path built off the compiled file's own location would also resolve
   wrong once compiled (it would land under node_modules/.tmp/seed/,
   where this JSON was never copied); a plain relative path works because
   the brief's own run instructions are "cd app/front-end", so this is
   always read against that cwd, source or compiled alike. */
const territories = JSON.parse(
  readFileSync('src/data/territories.geo.json', 'utf8')
) as { features: { properties: { id: string }; geometry: { coordinates: [number, number][][] } }[] }

const DAY = 24 * 60 * 60 * 1000
const CAT_PHOTO = (id: string, w: number, h: number) => `https://cataas.com/cat/${id}?width=${w}&height=${h}`

/* Same seeded observation history the old data/sightings.ts SEEDS array
   held, carried over here since that array's only remaining purpose is
   this one-time write: sightings.ts itself has no seed data any more
   after Task 6. */
const SEED_SIGHTINGS: { catId: string; daysAgo: number; photo?: string }[] = [
  { catId: 'milo', daysAgo: 0.3, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 640, 480) },
  { catId: 'milo', daysAgo: 2, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 600, 450) },
  { catId: 'milo', daysAgo: 9, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 560, 420) },
  { catId: 'milo', daysAgo: 26, photo: CAT_PHOTO('04eEQhDfAL8l5nt3', 520, 390) },
  { catId: 'biscuit', daysAgo: 1.5, photo: CAT_PHOTO('05Xd4JtN14983pns', 640, 480) },
  { catId: 'biscuit', daysAgo: 6 },
  { catId: 'biscuit', daysAgo: 20, photo: CAT_PHOTO('05Xd4JtN14983pns', 560, 420) },
  { catId: 'tala', daysAgo: 0.8, photo: CAT_PHOTO('09wFxpacQzvf9jfM', 640, 480) },
  { catId: 'tala', daysAgo: 4, photo: CAT_PHOTO('09wFxpacQzvf9jfM', 600, 450) },
  { catId: 'tala', daysAgo: 15, photo: CAT_PHOTO('09wFxpacQzvf9jfM', 520, 390) },
  { catId: 'pandan', daysAgo: 1.1, photo: CAT_PHOTO('0B2g7aTANObiqPJJ', 640, 480) },
  { catId: 'pandan', daysAgo: 12, photo: CAT_PHOTO('0B2g7aTANObiqPJJ', 560, 420) },
  { catId: 'ube', daysAgo: 0.6, photo: CAT_PHOTO('0BTTVEVWXNyOgXYd', 640, 480) },
  { catId: 'ube', daysAgo: 7, photo: CAT_PHOTO('0BTTVEVWXNyOgXYd', 600, 450) },
  { catId: 'ube', daysAgo: 33, photo: CAT_PHOTO('0BTTVEVWXNyOgXYd', 520, 390) },
  { catId: 'kidlat', daysAgo: 2.4, photo: CAT_PHOTO('0C2bQ39x8kuhx31p', 640, 480) },
  { catId: 'bagyo', daysAgo: 3.2, photo: CAT_PHOTO('0DVs2d6bIVIt3ehk', 640, 480) },
  { catId: 'bagyo', daysAgo: 18, photo: CAT_PHOTO('0DVs2d6bIVIt3ehk', 560, 420) },
  { catId: 'alon', daysAgo: 0.9, photo: CAT_PHOTO('0EsIYDG0at0TPpPD', 640, 480) },
  { catId: 'alon', daysAgo: 11, photo: CAT_PHOTO('0EsIYDG0at0TPpPD', 600, 450) },
  { catId: 'ligaya', daysAgo: 1.8, photo: CAT_PHOTO('0F0IKAPOdWiE755P', 640, 480) },
  { catId: 'ligaya', daysAgo: 5, photo: CAT_PHOTO('0F0IKAPOdWiE755P', 560, 420) },
  { catId: 'ligaya', daysAgo: 29, photo: CAT_PHOTO('0F0IKAPOdWiE755P', 520, 390) },
  { catId: 'buko', daysAgo: 4.5, photo: CAT_PHOTO('0GC9MRUAqxhBzPyA', 640, 480) },
  { catId: 'buko', daysAgo: 16 },
  { catId: 'maya', daysAgo: 2.7, photo: CAT_PHOTO('0M0Lo3dsYft79xNd', 640, 480) },
  { catId: 'maya', daysAgo: 22, photo: CAT_PHOTO('0M0Lo3dsYft79xNd', 600, 450) },
  { catId: 'nilad', daysAgo: 6.3, photo: CAT_PHOTO('0mstmOIucwiN80jb', 640, 480) },
  { catId: 'nilad', daysAgo: 14, photo: CAT_PHOTO('0mstmOIucwiN80jb', 560, 420) },
  { catId: 'nilad', daysAgo: 41, photo: CAT_PHOTO('0mstmOIucwiN80jb', 520, 390) },
]

async function main() {
  const app = initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!, 'utf8'))) })
  const db = getFirestore(app)

  for (const cat of CATS) {
    const feature = territories.features.find((f) => f.properties.id === cat.id)
    if (!feature) {
      console.warn(`Skipping ${cat.id}: no territory in territories.geo.json`)
      continue
    }
    const { id, lastSeen: _lastSeen, ...rest } = cat
    /* source: 'seed' distinguishes this migrated survey data from anything
       an admin records later through catsRepo.ts's addCat, which stamps
       'recorded' instead. countRecorded/clearRecorded (catsRepo.ts) filter
       on this field, so a document written here without it would be
       invisible to that split rather than merely uncounted. */
    await db.doc(`cats/${id}`).set({
      ...rest,
      territory: flattenRing(feature.geometry.coordinates[0] as [number, number][]),
      source: 'seed',
    })
    console.log(`cats/${id} written`)
  }

  const now = Date.now()
  for (const seed of SEED_SIGHTINGS) {
    const feature = territories.features.find((f) => f.properties.id === seed.catId)
    if (!feature) continue
    const ring = feature.geometry.coordinates[0] as [number, number][]
    const cx = ring.slice(0, -1).reduce((s, p) => s + p[0], 0) / (ring.length - 1)
    const cy = ring.slice(0, -1).reduce((s, p) => s + p[1], 0) / (ring.length - 1)
    await db.collection('sightings').add({
      catId: seed.catId,
      point: [cx, cy],
      status: 'surveyed',
      at: now - seed.daysAgo * DAY,
      authorUid: 'seed',
      ...(seed.photo ? { photo: seed.photo } : {}),
    })
  }
  console.log(`${SEED_SIGHTINGS.length} seed sightings written`)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
