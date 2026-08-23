export type Cat = {
  id: string
  name: string
  /** Plate number, printed in the corner of the specimen plate. */
  plate: string
  /** The survey line this cat was recorded on. */
  line: string
  /** Which token paints this cat's territory. One of the five, never a new hex. */
  colour: '--rust' | '--sage' | '--ink-soft'
  description: string
  firstRecorded: string
  range: string
  disposition: string
  /** One observation that is not a measurement. Every other field here
      answers "what is this cat"; this one answers "what is this cat like",
      which is the only reason anyone reads a field guide twice.

      Optional, and the plate skips the row rather than printing an empty
      one. A cat recorded five minutes ago legitimately has nothing written
      under it yet, and that is a real state once cats can be added rather
      than seeded. */
  note?: string
  /** Derived at read time from the sighting log (data/sightings.ts), never
      stored on a cat and never written to this file. It is a fact about
      when somebody last reported seeing this cat, so it belongs to the
      observations, not to the animal. Absent means nobody has. */
  lastSeen?: string
  coordinates: string
  /** A URL, not a bundled asset, so v2 can point this at real hosted photos
      without touching anything but this file.

      Note the cost, deliberately taken: this is the one network dependency
      in an app that is otherwise a single offline pmtiles file, so every
      consumer must still render correctly when it fails to load. See
      CatRow's onError. Moving these into public/ later is a data-only edit
      here, which is the point of typing it as a URL. */
  photo: string
}

/* Three cats, not twelve. Three is what proves the overlap reads correctly;
   the other nine are a data-entry session, not a design question.
   Every cat here is fictional. See spec §9 before that changes. */
export const CATS: Cat[] = [
  {
    id: 'milo',
    name: 'MILO',
    plate: 'PLATE 01',
    line: 'LINE 03 · TRACK 30TH',
    colour: '--rust',
    description: 'Orange tabby · torn left ear · male, est. 3 yrs',
    firstRecorded: 'Mar 2024',
    range: 'Track 30th → Net Park loading dock',
    disposition: 'Approaches for food, not for touch',
    note: 'Holds the warm vent behind the loading dock every morning until the sun clears the tower opposite, then gives it up without argument.',
    coordinates: '14.5512° N, 121.0500° E',
    photo: 'https://placecats.com/millie/640/480',
  },
  {
    id: 'biscuit',
    name: 'BISCUIT',
    plate: 'PLATE 02',
    line: 'LINE 01 · NET PARK',
    colour: '--sage',
    description: 'Cream longhair · notched right ear · female, est. 5 yrs',
    firstRecorded: 'Aug 2023',
    range: 'Net Park lawn → 5th Avenue service road',
    disposition: 'Sleeps through everything',
    note: 'Has slept through two fun runs, a fire drill and one wedding photoshoot. Moves for the lawn sprinklers, and for nothing else.',
    coordinates: '14.5487° N, 121.0463° E',
    photo: 'https://placecats.com/neo/640/480',
  },
  {
    id: 'tala',
    name: 'TALA',
    plate: 'PLATE 03',
    line: 'LINE 02 · 32ND STREET',
    colour: '--ink-soft',
    description: 'Black shorthair · white chest flash · female, est. 2 yrs',
    firstRecorded: 'Jan 2025',
    range: '32nd Street underpass → the mid-block gardens',
    disposition: 'Watches from distance, never closes',
    note: 'Uses the underpass rather than the crossing above it, at the same two times each day, which is how the range was mapped at all.',
    coordinates: '14.5501° N, 121.0489° E',
    photo: 'https://placecats.com/bella/640/480',
  },
]
