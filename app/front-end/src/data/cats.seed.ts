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


/* The Bonifacio Global City / McKinley West field roster, generated from
   the uMap survey export by scripts/importUmap.ts. Regenerate with
   `npm run import:umap`; do not hand-edit this array, the next run
   overwrites it.

   Territories are estimated, not surveyed: each cat's survey pin is the
   centre of a ~100-170 m range. The survey is ~11 tight colonies in a few
   hundred metres, so these overlap heavily by design. Only the polygon
   and its centroid are kept here, never the pin. Every cat is now a real
   Taguig community cat, which is the exact condition spec §9's
   territory-only rule was written for: it is load-bearing from here, not a
   preference. */
export const CATS: Cat[] = [
  {
    id: 'bangsie',
    name: 'Bangsie',
    plate: 'PLATE 01',
    line: 'LINE 01 · JUSMAG GUARD POST',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Jusmag Guard Post',
    disposition: 'Not recorded',
    coordinates: '14.5356° N, 121.0451° E',
    photo: 'https://i.ibb.co/QjJTFrf9/No-name-yet-Mcdo-1.png',
  },
  {
    id: 'batgirl',
    name: 'Batgirl',
    plate: 'PLATE 02',
    line: 'LINE 02 · ROBINSONS CYBER SIGMA',
    colour: '--cat-slate',
    description: 'Black & White · female',
    firstRecorded: '2024',
    range: 'Robinsons Cyber Sigma',
    disposition: 'Not recorded',
    coordinates: '14.5355° N, 121.0432° E',
    photo: 'https://i.ibb.co/BVbZwXtY/Batgirl.png',
  },
  {
    id: 'bobbie',
    name: 'Bobbie',
    plate: 'PLATE 03',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-moss',
    description: 'Tabby & White · female',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5368° N, 121.0424° E',
    photo: 'https://i.ibb.co/HfwMjCZ5/Bobbie.png',
  },
  {
    id: 'bunny',
    name: 'Bunny',
    plate: 'PLATE 04',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5367° N, 121.0423° E',
    photo: 'https://i.ibb.co/6JrmMfTk/Bunny.png',
  },
  {
    id: 'callie',
    name: 'Callie',
    plate: 'PLATE 05',
    line: 'LINE 04 · PNB/LAWSON',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'PNB/Lawson',
    disposition: 'Not recorded',
    note: 'Also known as Peachy. One of the eyes seems blind.',
    coordinates: '14.5363° N, 121.0430° E',
    photo: 'https://i.ibb.co/4Z4S5RBc/No-name-yet-Asiatown.png',
  },
  {
    id: 'caramel',
    name: 'Caramel',
    plate: 'PLATE 06',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    coordinates: '14.5363° N, 121.0439° E',
    photo: 'https://i.ibb.co/ds6Z0g9G/Caramel-2.png',
  },
  {
    id: 'chinito',
    name: 'Chinito',
    plate: 'PLATE 07',
    line: 'LINE 02 · ROBINSONS CYBER SIGMA',
    colour: '--cat-ember',
    description: 'Orange & White · male',
    firstRecorded: '2024',
    range: 'Robinsons Cyber Sigma',
    disposition: 'Not recorded',
    coordinates: '14.5355° N, 121.0433° E',
    photo: 'https://i.postimg.cc/JhjKQxfM/Chinito.png',
  },
  {
    id: 'colby',
    name: 'Colby',
    plate: 'PLATE 08',
    line: 'LINE 06 · TELUS WEST',
    colour: '--cat-ember',
    description: 'Orange Tabby & White · male',
    firstRecorded: '2024',
    range: 'Telus West',
    disposition: 'Not recorded',
    coordinates: '14.5361° N, 121.0451° E',
    photo: 'https://i.ibb.co/5XkJnFdJ/Colby.png',
  },
  {
    id: 'damsel',
    name: 'Damsel',
    plate: 'PLATE 09',
    line: 'LINE 07 · 7-11/BPI',
    colour: '--cat-rust',
    description: 'Tortie · female',
    firstRecorded: '2024',
    range: '7-11/BPI',
    disposition: 'Not recorded',
    note: 'Also known as Martha. Allowed inside of 7-11.',
    coordinates: '14.5358° N, 121.0444° E',
    photo: 'https://i.ibb.co/9HC2n7W6/Damsel-Martha.png',
  },
  {
    id: 'ghost',
    name: 'Ghost',
    plate: 'PLATE 10',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-moss',
    description: 'Tabby & White · female',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    coordinates: '14.5363° N, 121.0441° E',
    photo: 'https://i.postimg.cc/XYz2pH6t/Ghost.png',
  },
  {
    id: 'havarti',
    name: 'Havarti',
    plate: 'PLATE 11',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-ember',
    description: 'Orange & White · male',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5366° N, 121.0423° E',
    photo: 'https://i.ibb.co/RpQT4DGz/Havarti.png',
  },
  {
    id: 'julie',
    name: 'Julie',
    plate: 'PLATE 12',
    line: 'LINE 04 · PNB/LAWSON',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'PNB/Lawson',
    disposition: 'Not recorded',
    note: 'Not seen since the survey.',
    coordinates: '14.5360° N, 121.0431° E',
    photo: 'https://i.ibb.co/0RR58XQ6/Julie.png',
  },
  {
    id: 'morris',
    name: 'Morris',
    plate: 'PLATE 13',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-ember',
    description: 'Orange & Tabby · male',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5370° N, 121.0425° E',
    photo: 'https://i.ibb.co/Dg48WBsp/Morris.png',
  },
  {
    id: 'mukbang',
    name: 'Mukbang',
    plate: 'PLATE 14',
    line: 'LINE 04 · PNB/LAWSON',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'PNB/Lawson',
    disposition: 'Not recorded',
    coordinates: '14.5361° N, 121.0429° E',
    photo: 'https://i.postimg.cc/0Q7pSFGG/Mukbang.png',
  },
  {
    id: 'muning',
    name: 'Muning',
    plate: 'PLATE 15',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-olive',
    description: 'Tabby · female',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    coordinates: '14.5361° N, 121.0440° E',
    photo: 'https://i.ibb.co/wZCG1tq7/Muning.png',
  },
  {
    id: 'nougat',
    name: 'Nougat',
    plate: 'PLATE 16',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-slate',
    description: 'Tuxedo · female',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    coordinates: '14.5363° N, 121.0438° E',
    photo: 'https://i.ibb.co/Z6sn5NBM/Nougat.png',
  },
  {
    id: 'oreo',
    name: 'Oreo',
    plate: 'PLATE 17',
    line: 'LINE 01 · JUSMAG GUARD POST',
    colour: '--cat-moss',
    description: 'White & Tabby · male',
    firstRecorded: '2024',
    range: 'Jusmag Guard Post',
    disposition: 'Not recorded',
    coordinates: '14.5357° N, 121.0449° E',
    photo: 'https://i.ibb.co/GfMjDshc/No-name-yet-Jusmag-post-1.png',
  },
  {
    id: 'pepper',
    name: 'Pepper',
    plate: 'PLATE 18',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-grey',
    description: 'Black · female',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    coordinates: '14.5361° N, 121.0437° E',
    photo: 'https://i.postimg.cc/k4xwY7Rd/Pepper.png',
  },
  {
    id: 'pia',
    name: 'Pia',
    plate: 'PLATE 19',
    line: 'LINE 01 · JUSMAG GUARD POST',
    colour: '--cat-ember',
    description: 'Orange & White · female',
    firstRecorded: '2024',
    range: 'Jusmag Guard Post',
    disposition: 'Not recorded',
    coordinates: '14.5357° N, 121.0450° E',
    photo: 'https://i.postimg.cc/fyJMsqc5/Pia.png',
  },
  {
    id: 'scar',
    name: 'Scar',
    plate: 'PLATE 20',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-ember',
    description: 'Tabby Orange · male',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    note: 'FIV positive.',
    coordinates: '14.5357° N, 121.0446° E',
    photo: 'https://i.ibb.co/zhG6xp8R/Scar.png',
  },
  {
    id: 'shadow',
    name: 'Shadow',
    plate: 'PLATE 21',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-grey',
    description: 'Black · male',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5368° N, 121.0426° E',
    photo: 'https://i.ibb.co/3mrH6046/Shadow.png',
  },
  {
    id: 'shiba',
    name: 'Shiba',
    plate: 'PLATE 22',
    line: 'LINE 08 · MCDONALD\'S MCKINLEY WEST',
    colour: '--cat-moss',
    description: 'Tabby & White (mix-breed) · male',
    firstRecorded: '2024',
    range: 'McDonald\'s Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5350° N, 121.0454° E',
    photo: 'https://i.postimg.cc/G2zfckdp/Shiba.png',
  },
  {
    id: 'stalker',
    name: 'Stalker',
    plate: 'PLATE 23',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-moss',
    description: 'Tabby & white · female',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5369° N, 121.0422° E',
    photo: 'https://i.ibb.co/CKFx3NGc/Stalker.png',
  },
  {
    id: 'titan',
    name: 'Titan',
    plate: 'PLATE 24',
    line: 'LINE 06 · TELUS WEST',
    colour: '--cat-moss',
    description: 'White & Tabby · male',
    firstRecorded: '2024',
    range: 'Telus West',
    disposition: 'Not recorded',
    note: 'Parvo positive. Now in foster care.',
    coordinates: '14.5361° N, 121.0453° E',
    photo: 'https://i.ibb.co/XnH6XBF/Titan.png',
  },
  {
    id: 'toothless',
    name: 'Toothless',
    plate: 'PLATE 25',
    line: 'LINE 09 · LE GRAND CONSTRUCTION BARRACK',
    colour: '--cat-ember',
    description: 'Orange & White · female',
    firstRecorded: '2024',
    range: 'Le Grand Construction Barrack',
    disposition: 'Friendly',
    note: 'No teeth.',
    coordinates: '14.5361° N, 121.0422° E',
    photo: 'https://i.postimg.cc/XNTBSW8k/IMG-20241118-112723.jpg',
  },
  {
    id: 'no-name-yet-jusmag-post-2',
    name: 'No name yet - Jusmag Post (2)',
    plate: 'PLATE 26',
    line: 'LINE 01 · JUSMAG GUARD POST',
    colour: '--cat-slate',
    description: 'Black & White',
    firstRecorded: '2024',
    range: 'Jusmag Guard Post',
    disposition: 'Skittish',
    note: 'One of the eyes seems blind.',
    coordinates: '14.5357° N, 121.0448° E',
    photo: 'https://i.ibb.co/wZxQYRDG/No-name-yet-Jusmag-Post-2.png',
  },
  {
    id: 'no-name-yet-jusmag-post-3',
    name: 'No name yet - Jusmag Post (3)',
    plate: 'PLATE 27',
    line: 'LINE 01 · JUSMAG GUARD POST',
    colour: '--cat-ember',
    description: 'Orange & White',
    firstRecorded: '2024',
    range: 'Jusmag Guard Post',
    disposition: 'Skittish',
    note: 'One of the eyes seems blind. TNR status not confirmed.',
    coordinates: '14.5356° N, 121.0449° E',
    photo: 'https://i.ibb.co/HfNGqQg8/No-name-yet-Jusmag-Post-3.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-1',
    name: 'No name yet - Le Grand Colony (1)',
    plate: 'PLATE 28',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5368° N, 121.0412° E',
    photo: 'https://i.ibb.co/Wv7SNPby/no-name-yet-le-grand-colony-1.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-2',
    name: 'No name yet - Le Grand Colony (2)',
    plate: 'PLATE 29',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-moss',
    description: 'Whilte and Tabby',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5368° N, 121.0414° E',
    photo: 'https://i.postimg.cc/1zW4GDx1/no-name-yet-le-grand-colony-2.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-3',
    name: 'No name yet - Le Grand Colony (3)',
    plate: 'PLATE 30',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5369° N, 121.0415° E',
    photo: 'https://i.ibb.co/TBpymS1v/no-name-yet-le-grand-colony-3.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-4',
    name: 'No name yet - Le Grand Colony (4)',
    plate: 'PLATE 31',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5369° N, 121.0417° E',
    photo: 'https://i.ibb.co/HfdSPKC8/no-name-yet-le-grand-colony-4.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-6',
    name: 'No name yet - Le Grand Colony (6)',
    plate: 'PLATE 32',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5366° N, 121.0413° E',
    photo: 'https://i.ibb.co/dw255xM0/no-name-yet-le-grand-colony-6.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-7',
    name: 'No name yet - Le Grand Colony (7)',
    plate: 'PLATE 33',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-rust',
    description: 'orange · male',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5366° N, 121.0415° E',
    photo: 'https://i.ibb.co/7NXZdYW3/no-name-yet-le-grand-colony-7.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-8',
    name: 'No name yet - Le Grand Colony (8)',
    plate: 'PLATE 34',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-ember',
    description: 'orange & white · male',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5367° N, 121.0416° E',
    photo: 'https://i.ibb.co/v6qP7KVg/no-name-yet-le-grand-colony-8.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-9',
    name: 'No name yet - Le Grand Colony (9)',
    plate: 'PLATE 35',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-ember',
    description: 'orange & tabby · male',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5368° N, 121.0418° E',
    photo: 'https://i.ibb.co/cKrwBtYn/no-name-yet-le-grand-colony-9.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-10',
    name: 'No name yet - Le Grand Colony (10)',
    plate: 'PLATE 36',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-grey',
    description: 'Black',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5369° N, 121.0413° E',
    photo: 'https://i.ibb.co/k2p3pGw6/no-name-yet-le-grand-colony-10.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-11',
    name: 'No name yet - Le Grand Colony (11)',
    plate: 'PLATE 37',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-moss',
    description: 'White & Tabby · female',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5370° N, 121.0415° E',
    photo: 'https://i.ibb.co/67Rk2G9v/no-name-yet-le-grand-colony-11.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-12',
    name: 'No name yet - Le Grand Colony (12)',
    plate: 'PLATE 38',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-rust',
    description: 'Orange · male',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5371° N, 121.0416° E',
    photo: 'https://i.ibb.co/230qZQh6/no-name-yet-le-grand-colony-12.png',
  },
  {
    id: 'no-name-yet-le-grand-colony-13',
    name: 'No name yet - Le Grand Colony (13)',
    plate: 'PLATE 39',
    line: 'LINE 10 · LE GRAND COLONY',
    colour: '--cat-clay',
    description: 'Calico · female',
    firstRecorded: '2024',
    range: 'Le Grand Colony',
    disposition: 'Not recorded',
    coordinates: '14.5367° N, 121.0412° E',
    photo: 'https://i.ibb.co/vCmbT0st/no-name-yet-le-grand-colony-13.png',
  },
  {
    id: 'no-name-yet-mcdo-1',
    name: 'No name yet - Mcdo (1)',
    plate: 'PLATE 40',
    line: 'LINE 08 · MCDONALD\'S MCKINLEY WEST',
    colour: '--cat-olive',
    description: 'Tabby',
    firstRecorded: '2024',
    range: 'McDonald\'s Mckinley West',
    disposition: 'Not recorded',
    note: 'TNR status not confirmed.',
    coordinates: '14.5347° N, 121.0453° E',
    photo: 'https://i.postimg.cc/LsKwv9xm/No-name-yet-Mcdo.png',
  },
  {
    id: 'no-name-yet-mcdo-2',
    name: 'No name yet - Mcdo (2)',
    plate: 'PLATE 41',
    line: 'LINE 08 · MCDONALD\'S MCKINLEY WEST',
    colour: '--cat-moss',
    description: 'White & Tabby · female',
    firstRecorded: '2024',
    range: 'McDonald\'s Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5349° N, 121.0452° E',
    photo: 'https://i.ibb.co/8n034HB5/No-name-yet-Mcdo-2.png',
  },
  {
    id: 'no-name-yet-mcdo-3',
    name: 'No name yet - Mcdo (3)',
    plate: 'PLATE 42',
    line: 'LINE 08 · MCDONALD\'S MCKINLEY WEST',
    colour: '--cat-slate',
    description: 'Black & White',
    firstRecorded: '2024',
    range: 'McDonald\'s Mckinley West',
    disposition: 'Not recorded',
    note: 'TNR status not confirmed.',
    coordinates: '14.5348° N, 121.0452° E',
    photo: 'https://i.ibb.co/bRDxV9f1/No-name-yet-Mcdo-3.png',
  },
  {
    id: 'no-name-yet-mcdo-4',
    name: 'No name yet - Mcdo (4)',
    plate: 'PLATE 43',
    line: 'LINE 08 · MCDONALD\'S MCKINLEY WEST',
    colour: '--cat-ember',
    description: 'Ginger and Tabby · male',
    firstRecorded: '2024',
    range: 'McDonald\'s Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5348° N, 121.0453° E',
    photo: 'https://i.postimg.cc/GpFN5WfG/No-name-yet-Mcdo-4.png',
  },
  {
    id: 'no-name-yet-steel-parking',
    name: 'No name yet - Steel Parking',
    plate: 'PLATE 44',
    line: 'LINE 03 · STEEL PARKING MCKINLEY WEST',
    colour: '--cat-moss',
    description: 'Tabby & White · male',
    firstRecorded: '2024',
    range: 'Steel Parking Mckinley West',
    disposition: 'Not recorded',
    coordinates: '14.5367° N, 121.0425° E',
    photo: 'https://i.ibb.co/WNtH3LRd/5.png',
  },
  {
    id: 'no-name-yet-whisky-park-1',
    name: 'No name yet - Whisky Park (1)',
    plate: 'PLATE 45',
    line: 'LINE 11 · WHISKY PARK',
    colour: '--cat-ember',
    description: 'ginger and white · female',
    firstRecorded: '2024',
    range: 'Whisky park',
    disposition: 'Not recorded',
    coordinates: '14.5367° N, 121.0440° E',
    photo: 'https://i.ibb.co/Xxq6WbRn/no-name-yet-whisky-park-1.png',
  },
  {
    id: 'no-name-yet-whisky-park-2',
    name: 'No name yet - Whisky Park (2)',
    plate: 'PLATE 46',
    line: 'LINE 11 · WHISKY PARK',
    colour: '--cat-slate',
    description: 'Black & White',
    firstRecorded: '2024',
    range: 'Whisky park',
    disposition: 'Not recorded',
    note: 'TNR status not confirmed.',
    coordinates: '14.5366° N, 121.0438° E',
    photo: 'https://i.ibb.co/JWxH9JsS/no-name-yet-whisky-park-2.png',
  },
  {
    id: 'no-name-yet-le-grand-construction-barrack-1',
    name: 'No name yet - Le Grand Construction Barrack (1)',
    plate: 'PLATE 47',
    line: 'LINE 09 · LE GRAND CONSTRUCTION BARRACK',
    colour: '--cat-moss',
    description: 'White & Tabby',
    firstRecorded: '2024',
    range: 'Le Grand Construction Barrack',
    disposition: 'Not recorded',
    coordinates: '14.5361° N, 121.0424° E',
    photo: 'https://i.postimg.cc/4xqL7gjL/No-name-yet-construction-gate-Barrack-1.png',
  },
  {
    id: 'sol',
    name: 'Sol',
    plate: 'PLATE 48',
    line: 'LINE 05 · ASIATOWN',
    colour: '--cat-olive',
    description: 'Tabby · male',
    firstRecorded: '2024',
    range: 'Asiatown',
    disposition: 'Not recorded',
    note: 'Long straight tail.',
    coordinates: '14.5361° N, 121.0439° E',
    photo: 'https://i.ibb.co/0PVxq18/Sol.png',
  },
]
