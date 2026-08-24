import type { FeatureCollection, Polygon } from 'geojson'
import { CATS, type Cat } from './cats.seed'
import baseTerritories from './territories.geo.json'
import { circleFeature, readStored, slugify, writeStored, type CatDraft } from './localCats'
import { allSightings, describeWhen, latestByCat, translateToward, type Sighting } from './sightings'

/* The v1/v2 seam, spec §9. The entire abstraction is that these functions are
   async over local data, so every consumer already handles loading and
   swapping to a real API is an edit to this file only.
   Territories stay polygons here and in v2: never an exact point for a real
   cat (spec §9, safety constraint). Do not add a `location` to Cat.

   Two sources behind that seam now, not one: the seeded three, and whatever
   has been recorded into this browser (localCats.ts). They are concatenated
   here rather than merged anywhere downstream, so nothing in the app knows
   or cares which of the two a cat came from. That is the point of doing it
   at this file: when the recorded ones move to a server, this is again the
   only file that changes. */

export async function listCats(): Promise<Cat[]> {
  const seen = latestByCat()
  return [...CATS, ...readStored().map((entry) => entry.cat)].map((cat) => {
    const sighting = seen.get(cat.id)
    /* Spread rather than mutate: CATS is a module-level array shared by
       every call, and writing a derived field onto it would leave the last
       sighting stuck to the seed data for the life of the page. */
    return sighting ? { ...cat, lastSeen: describeWhen(sighting.at) } : cat
  })
}

export async function getCat(id: string): Promise<Cat | null> {
  return (await listCats()).find((cat) => cat.id === id) ?? null
}

/** One cat's observations, newest first.

    Per cat rather than all of them, because that is the request a server
    will actually be asked to serve: the plate is the only thing that reads
    these, and it is only ever open on one cat. Behind the same seam as the
    rest, so phase 3 replaces the body of this function with a fetch and
    changes nothing above it. */
export async function listSightings(catId: string): Promise<Sighting[]> {
  return allSightings()
    .filter((sighting) => sighting.catId === catId)
    .sort((a, b) => b.at - a.at)
}

/* The territory shapes, on the same seam and for the same reason. This used
   to be a static import in Territories.tsx and CatMarkers.tsx, which was
   correct while the only cats were the seeded three and wrong the moment one
   could be added at runtime: a JSON import is frozen at module evaluation,
   so a newly recorded cat would have had a marker, a rail row and a plate,
   and no territory under any of them. */
export async function listTerritories(): Promise<FeatureCollection<Polygon>> {
  const base = baseTerritories as FeatureCollection<Polygon>
  const seen = latestByCat()
  return {
    type: 'FeatureCollection',
    /* Sightings are applied here, at read time, rather than written back
       into the shapes. The recorded outline stays the recorded outline, and
       what the map draws is that outline plus whatever has been observed
       since, which is the same relationship a review queue will need: the
       submission never destroys what it proposes to change. */
    features: [...base.features, ...readStored().map(circleFeature)].map((feature) => {
      const sighting = seen.get(feature.properties?.id as string)
      return sighting ? translateToward(feature, sighting.point) : feature
    }),
  }
}

/** How many cats this browser has recorded. Sync, and the one place the
    local-only nature of the mock leaks into the UI on purpose: the panel
    offers to clear them, which is an affordance that exists because storage
    is a browser, and disappears when it is a server. */
export function countRecorded(): number {
  return readStored().length
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

/** Formatted the way the seeded cats' coordinates are, and derived from the
    territory's own centre rather than stored separately, so there is exactly
    one point associated with a cat and it is the middle of a drawn area. */
function formatCoordinates([lng, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${
    lng >= 0 ? 'E' : 'W'
  }`
}

/* Everything a Cat needs that the panel does not ask for. Asking would be
   asking someone to invent a filing convention: the plate number is a
   count, the date is today, and the coordinates and range are restatements
   of the circle that was just drawn. */
export async function addCat(draft: CatDraft): Promise<Cat | null> {
  const name = draft.name.trim()
  if (!name) return null

  const stored = readStored()
  const taken = new Set([...CATS, ...stored.map((entry) => entry.cat)].map((cat) => cat.id))

  /* -2, -3 and so on rather than a random suffix: two cats called Mingming
     should read as mingming and mingming-2, and the id shows up in the URL
     (App.tsx's ?cat=), which is a thing a person sees. */
  const base = slugify(name)
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const cat: Cat = {
    id,
    name: name.toUpperCase(),
    plate: `PLATE ${String(CATS.length + stored.length + 1).padStart(2, '0')}`,
    line: draft.line.trim() || 'LINE 00 · FIELD ENTRY',
    colour: draft.colour,
    description: draft.description.trim(),
    firstRecorded: MONTH.format(new Date()),
    range: `About ${Math.round(draft.radiusM * 2)} m across, centred on the recorded point`,
    disposition: 'Not yet observed',
    note: draft.note.trim() || undefined,
    coordinates: formatCoordinates(draft.center),
    photo: draft.photo.trim(),
  }

  if (!writeStored([...stored, { cat, center: draft.center, radiusM: draft.radiusM }])) return null
  return cat
}

/** Removes every recorded cat, not one. Deliberately blunt: this exists so a
    demo can be reset, and per-cat deletion is a real feature with real
    questions attached (who may delete whose) that belong to the version with
    accounts in it, not to this one. */
export function clearRecorded(): boolean {
  return writeStored([])
}

export type { Cat, CatDraft, Sighting }
