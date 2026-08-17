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
  coordinates: string
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
    coordinates: '14.5512° N, 121.0500° E',
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
    coordinates: '14.5487° N, 121.0463° E',
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
    coordinates: '14.5501° N, 121.0489° E',
  },
]
