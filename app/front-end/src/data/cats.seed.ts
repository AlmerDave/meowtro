/* The colours a cat can be, and the only list of them.

   ui/RecordCat.tsx renders its picker straight off this, the `Colour` type
   below is generated from it, and data/palette.check.ts asserts every entry
   exists in tokens.css and clears WCAG AA as text in all three themes. So
   adding a colour is two edits, this and the stylesheet, and forgetting the
   second one fails a check rather than rendering an invisible territory.

   Eight rather than the original three, because three is not a picker. The
   labels are what the record panel prints under each swatch; they are
   deliberately plain colour names rather than cat-ish ones, since the
   person using them is filing a specimen, not naming it. */
export const CAT_COLOURS = [
  { token: '--cat-rust', label: 'Rust' },
  { token: '--cat-ember', label: 'Ember' },
  { token: '--cat-clay', label: 'Clay' },
  { token: '--cat-sage', label: 'Sage' },
  { token: '--cat-moss', label: 'Moss' },
  { token: '--cat-olive', label: 'Olive' },
  { token: '--cat-grey', label: 'Grey' },
  { token: '--cat-slate', label: 'Slate' },
] as const

export type Colour = (typeof CAT_COLOURS)[number]['token']

/* The seeded photos, and the one string every seeded URL is built from.

   cataas.com by id, not by random: a field guide whose specimen photograph
   changes on every reload is not a field guide. The id makes each one
   stable, and the size is a query rather than a path segment, which is what
   photoAt below rewrites.

   Twelve distinct cats, which is why this is not placecats.com any more.
   That host has six stable images total, and two cats sharing a face in a
   guide to named individuals is a visible lie. */
const CATAAS = (id: string) => `https://cataas.com/cat/${id}?width=640&height=480`

/** The same photo at a smaller size, for callers that paint it small.

    The landing's roster chips are 52px and were downloading 640x480 to fill
    them. Rewrites the seeded URL shape and passes anything else through
    untouched, so the day these point at real hosted photos this quietly
    stops applying rather than mangling a URL it does not understand. */
export function photoAt(url: string, px: number): string {
  return url.replace(/width=\d+&height=\d+/, `width=${px}&height=${px}`)
}

/** The size every SMALL rendering of a cat's photo asks for: the rail and
    deck row's 2.75rem slot, and the map pin's 2.125rem head. 128 covers the
    larger of the two at 3x, which is the densest phone screen anyone will
    open this on.

    One constant rather than a number at each call site, because the two
    have to agree exactly. They are separate <img> elements pointing at the
    same host, so a row asking for 128 and a pin asking for 96 would be two
    downloads per cat instead of one, which is the opposite of what this
    exists for: twelve 640x480 photographs were being fetched to paint discs
    the size of a fingernail, roughly 600KB of page weight, and the same
    twelve at 128 square are about a fifth of that.

    The plate's hero is deliberately NOT on this. It is painted around 368px
    wide and genuinely wants the full-size file; it carries this one as a
    CSS background underneath itself instead (plate/Plate.tsx), so the
    shared-element morph out of a row lands on a picture that is already
    cached rather than on an empty frame while the large one arrives. */
export const THUMB_PX = 128

/** The picker grid's own size (ui/ReportSighting.tsx). Its cards are square
    and run to roughly 110 CSS px on a phone, so THUMB_PX would arrive
    visibly soft at 2x on the one screen in this app whose stated job is
    recognition: "photographs at a size you can actually match against an
    animal in front of you". 256 is that at 2x with room to spare, and still
    a fraction of the seeded 640x480 that the grid used to pull twelve of
    every time it opened.

    Two sizes and no more, deliberately. Every other photo in the app is
    painted under ~64px (the row slot, the pin, the sighting chip, the scan
    result's head, an admin's pending thumbnail) and takes THUMB_PX; the
    plate's hero is the only thing that takes the full file. A third size
    would be a third cache entry per cat for no visible gain. */
export const CARD_PX = 256

export type Cat = {
  id: string
  name: string
  /** Plate number, printed in the corner of the specimen plate. */
  plate: string
  /** The survey line this cat was recorded on. */
  line: string
  /** Which token paints this cat's territory. One of CAT_COLOURS below,
      which is one of the eight --cat-* tokens in tokens.css, every one of
      them a mix of the five base colours. Never a new hex. */
  colour: Colour
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
  /** How many pending sightings this cat currently has, kept in sync by
      catsRepo/sightings.ts wherever one is created, approved, discarded or
      withdrawn. Never sourced from the seed: absent here, like `lastSeen`,
      and present only once Firestore has written it (catsRepo.ts).

      Exists for exactly one reader: plate/Plate.tsx's signed-out lock,
      which cannot read the pending sighting itself (firestore.rules keeps
      an unreviewed report's point behind sign-in, spec §9) but still needs
      to know "is there one at all" to lock out a duplicate report and
      point a visitor at signing in to vote. A count rather than a boolean
      because a cat can collect more than one open report at once
      (sightings.ts's pendingByCat has the same note), and a boolean
      toggled on create/resolve would read "nothing pending" the moment the
      first of two was resolved, while a second one was still open. */
  pendingCount?: number
}

/* Twelve cats. It was three, on the reasoning that three proves the overlap
   reads correctly and the other nine are a data-entry session rather than a
   design question. Half right: the typing was mechanical, and it still
   forced four decisions that three cats had been hiding. The palette had to
   grow from three colours to eight (CAT_COLOURS above). The landing's
   roster chips had to stop being a row of every cat. The photo host had to
   change, because the old one has six stable images total and two cats
   sharing a face in a guide to named individuals is a visible lie. And
   --sage turned out to have been under the AA floor as text since the day
   it was seeded, which one cat in three wearing it made easy to miss.

   Every cat here is fictional, including the ones whose habits sound too
   specific to be. See spec §9 before that changes: the day these become
   real animals is the day the territory-only rule stops being a design
   preference and starts being the only thing between this app and telling
   a stranger where to find one particular cat. */
export const CATS: Cat[] = [
  {
    id: 'milo',
    name: 'MILO',
    plate: 'PLATE 01',
    line: 'LINE 03 · TRACK 30TH',
    colour: '--cat-rust',
    description: 'Orange tabby · torn left ear · male, est. 3 yrs',
    firstRecorded: 'Mar 2024',
    range: 'Track 30th → Net Park loading dock',
    disposition: 'Approaches for food, not for touch',
    note: 'Holds the warm vent behind the loading dock every morning until the sun clears the tower opposite, then gives it up without argument.',
    coordinates: '14.5512° N, 121.0500° E',
    photo: CATAAS('04eEQhDfAL8l5nt3'),
  },
  {
    id: 'biscuit',
    name: 'BISCUIT',
    plate: 'PLATE 02',
    line: 'LINE 01 · NET PARK',
    colour: '--cat-sage',
    description: 'Cream longhair · notched right ear · female, est. 5 yrs',
    firstRecorded: 'Aug 2023',
    range: 'Net Park lawn → 5th Avenue service road',
    disposition: 'Sleeps through everything',
    note: 'Has slept through two fun runs, a fire drill and one wedding photoshoot. Moves for the lawn sprinklers, and for nothing else.',
    coordinates: '14.5487° N, 121.0463° E',
    photo: CATAAS('05Xd4JtN14983pns'),
  },
  {
    id: 'tala',
    name: 'TALA',
    plate: 'PLATE 03',
    line: 'LINE 02 · 32ND STREET',
    colour: '--cat-grey',
    description: 'Black shorthair · white chest flash · female, est. 2 yrs',
    firstRecorded: 'Jan 2025',
    range: '32nd Street underpass → the mid-block gardens',
    disposition: 'Watches from distance, never closes',
    note: 'Uses the underpass rather than the crossing above it, at the same two times each day, which is how the range was mapped at all.',
    coordinates: '14.5501° N, 121.0489° E',
    photo: CATAAS('09wFxpacQzvf9jfM'),
  },
  {
    id: 'pandan',
    name: 'PANDAN',
    plate: 'PLATE 04',
    line: 'LINE 01 · HIGH STREET',
    colour: '--cat-moss',
    description: 'Grey tabby · ear-tipped left · male, est. 4 yrs',
    firstRecorded: 'Jun 2024',
    range: 'High Street central lawn → the bookshop colonnade',
    disposition: 'Follows, at a fixed six paces',
    note: 'Walks the colonnade end to end most evenings, always in the same direction, and will follow a person the whole length of it at a distance that never changes.',
    coordinates: '14.5525° N, 121.0455° E',
    photo: CATAAS('0B2g7aTANObiqPJJ'),
  },
  {
    id: 'ube',
    name: 'UBE',
    plate: 'PLATE 05',
    line: 'LINE 04 · SERENDRA',
    colour: '--cat-clay',
    description: 'Tortoiseshell · ear-tipped right · female, est. 6 yrs',
    firstRecorded: 'Nov 2022',
    range: 'Serendra podium gardens → the market delivery bay',
    disposition: 'Tolerates the crowd, ignores the individual',
    note: 'The oldest record on the survey and the only cat seen in every quarter since. Sits out the weekend market in the open, which no other cat here does.',
    coordinates: '14.5468° N, 121.0532° E',
    photo: CATAAS('0BTTVEVWXNyOgXYd'),
  },
  {
    id: 'kidlat',
    name: 'KIDLAT',
    plate: 'PLATE 06',
    line: 'LINE 05 · 36TH STREET',
    colour: '--cat-ember',
    description: 'Orange and white · both ears intact · male, est. 1 yr',
    firstRecorded: 'Feb 2026',
    range: '36th Street planters → the Uptown service lane',
    disposition: 'Runs first, looks second',
    note: 'The newest record here and the only cat not yet ear-tipped, which makes that line on this plate a thing still to be done rather than a thing observed.',
    coordinates: '14.5551° N, 121.0468° E',
    photo: CATAAS('0C2bQ39x8kuhx31p'),
  },
  {
    id: 'bagyo',
    name: 'BAGYO',
    plate: 'PLATE 07',
    line: 'LINE 06 · 11TH AVENUE',
    colour: '--cat-slate',
    description: 'Grey and white · notched left ear · male, est. 5 yrs',
    firstRecorded: 'Sep 2023',
    range: '11th Avenue arcade → the Terra 28th car park roof',
    disposition: 'Under cover before the rain, every time',
    note: 'Reliably under cover twenty minutes before a downpour, and reliably wrong about once a month, which is still a better record than most forecasts of this city.',
    coordinates: '14.5545° N, 121.0512° E',
    photo: CATAAS('0DVs2d6bIVIt3ehk'),
  },
  {
    id: 'alon',
    name: 'ALON',
    plate: 'PLATE 08',
    line: 'LINE 07 · BURGOS CIRCLE',
    colour: '--cat-olive',
    description: 'Brown tabby · ear-tipped left · female, est. 3 yrs',
    firstRecorded: 'Apr 2024',
    range: 'Burgos Circle fountain → the Forbes Town back lane',
    disposition: 'Comes for the sound of a chair moving',
    note: 'Has worked out that cafe chairs scraping at closing time means the terrace is about to be swept, and that swept means whatever was under the tables.',
    coordinates: '14.5478° N, 121.0438° E',
    photo: CATAAS('0EsIYDG0at0TPpPD'),
  },
  {
    id: 'ligaya',
    name: 'LIGAYA',
    plate: 'PLATE 09',
    line: 'LINE 08 · RIZAL DRIVE',
    colour: '--cat-rust',
    description: 'Ginger longhair · ear-tipped right · female, est. 7 yrs',
    firstRecorded: 'Jul 2022',
    range: 'Rizal Drive median → the museum loading yard',
    disposition: 'Will sit near, never on',
    note: 'Chooses the bench beside the occupied one. Twenty-two records of that and not one of her sharing a bench with a person.',
    coordinates: '14.5512° N, 121.0555° E',
    photo: CATAAS('0F0IKAPOdWiE755P'),
  },
  {
    id: 'buko',
    name: 'BUKO',
    plate: 'PLATE 10',
    line: 'LINE 09 · 26TH STREET',
    colour: '--cat-sage',
    description: 'Cream and grey · ear-tipped left · male, est. 2 yrs',
    firstRecorded: 'Oct 2025',
    range: '26th Street kerb gardens → the Turf perimeter fence',
    disposition: 'Unbothered by dogs, wary of bicycles',
    note: 'Sits out the evening dog walk without moving, and clears the fence for a bicycle every time. That is the wrong way round and it has never once varied.',
    coordinates: '14.5442° N, 121.0495° E',
    photo: CATAAS('0GC9MRUAqxhBzPyA'),
  },
  {
    id: 'maya',
    name: 'MAYA',
    plate: 'PLATE 11',
    line: 'LINE 10 · 9TH AVENUE',
    colour: '--cat-grey',
    description: 'Black and white · notched right ear · female, est. 4 yrs',
    firstRecorded: 'Dec 2023',
    range: '9th Avenue verge → the west block fire stair',
    disposition: 'Keeps the stairwell, shares the verge',
    note: 'The fire stair is hers and the argument about it is brief and annual. The verge below it she has shared with three other cats without incident.',
    coordinates: '14.5535° N, 121.0421° E',
    photo: CATAAS('0M0Lo3dsYft79xNd'),
  },
  {
    id: 'nilad',
    name: 'NILAD',
    plate: 'PLATE 12',
    line: 'LINE 11 · KALAYAAN',
    colour: '--cat-moss',
    description: 'Grey shorthair · ear-tipped right · male, est. 8 yrs',
    firstRecorded: 'May 2022',
    range: 'Kalayaan underpass mouth → the north block planting',
    disposition: 'Will not cross open ground in daylight',
    note: 'Mapped almost entirely from records taken at dusk. Every daylight sighting is within a metre of cover, which is what makes the northern edge of this range a guess rather than a measurement.',
    coordinates: '14.5585° N, 121.0525° E',
    photo: CATAAS('0mstmOIucwiN80jb'),
  },
]
