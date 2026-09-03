import assert from 'node:assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { SHAPES, shapeRing, slugify } from '../src/data/territoryShape'

/* One-off: turn the uMap survey export (docs/resources/cat.json) into the
   two seed files the app runs on, src/data/cats.seed.ts's CATS array and
   src/data/territories.geo.json. Run with `npm run import:umap`; it
   overwrites both wholesale, so do not hand-edit the CATS array or the
   geojson afterwards, re-run this instead.

   The export is points; Meowtro is polygons. Each cat's pin is taken as
   the centre of an estimated range: ~100-170 m across (radius 50-85 m,
   varied per cat by an id hash so they are not all identical). This
   survey is ~11 tight colonies packed within a few hundred metres, so
   territories overlap heavily on purpose, a colony reads as a stack of
   patches over the same block. The pin is never stored, only the polygon
   and its centroid, same §9 line as the old fictional seed: no exact
   point for a real cat.

   Fields the export does not carry are synthesised: plate is a count,
   firstRecorded is a constant "2024", line/range are the Spot name, and
   colour maps the free-text coat onto one of the eight --cat-* tokens
   (approximate on purpose, it tints a territory, it is not a coat label). */

const SRC = '../../docs/resources/cat.json'
const OUT_GEO = 'src/data/territories.geo.json'
const OUT_SEED = 'src/data/cats.seed.ts'

const VALID_COLOURS = new Set([
  '--cat-rust', '--cat-ember', '--cat-clay', '--cat-sage',
  '--cat-moss', '--cat-olive', '--cat-grey', '--cat-slate',
])

/* Coat text -> territory tint. Ordered: first hit wins, so "calico" is
   caught before "tabby" and "orange & white" before bare "orange". */
const COAT_RULES: [RegExp, string][] = [
  [/calico/, '--cat-clay'],
  [/tortie|tortoise/, '--cat-rust'],
  [/tuxedo/, '--cat-slate'],
  [/black\s*&?\s*(and\s*)?white/, '--cat-slate'],
  [/\bblack\b/, '--cat-grey'],
  [/(orange|ginger).*(white|tabby)|(white|tabby).*(orange|ginger)/, '--cat-ember'],
  [/orange|ginger/, '--cat-rust'],
  [/tabby.*white|white.*tabby/, '--cat-moss'],
  [/tabby/, '--cat-olive'],
]

function coatToColour(raw: string): string {
  const s = raw.toLowerCase().replace(/whilte/g, 'white')
  for (const [re, token] of COAT_RULES) if (re.test(s)) return token
  return '--cat-grey'
}

/* Stable 32-bit FNV-1a hash of the id, for the per-cat radius jitter. */
function hashN(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  const cased = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(cased) ? cased : cased + '.'
}

function tsStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Pull `**Key**: value` off the uMap description blob. Tolerates the
    doubled `**Spot**: **Spot**:` one record has. */
function field(desc: string, key: string): string {
  // [^\S\n]* not \s*: \s eats the newline and the capture then grabs the
  // next line (an empty **Behavior**: would return the **TNR**: value).
  const m = new RegExp(`\\*\\*${key}\\*\\*:[^\\S\\n]*(.*)`, 'i').exec(desc)
  if (!m) return ''
  return m[1].replace(/^\*\*[^*]+\*\*:\s*/, '').trim()
}

type Raw = {
  type: 'FeatureCollection'
  features: {
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { name: string; description: string }
  }[]
}

const raw = JSON.parse(readFileSync(SRC, 'utf8')) as Raw

type Parsed = {
  id: string
  name: string
  colour: string
  description: string
  disposition: string
  note?: string
  spot: string
  lng: number
  lat: number
  photo: string
}

const seen = new Set<string>()
const usedIds = new Set<string>()
const parsed: Parsed[] = []
let dupes = 0

for (const f of raw.features) {
  const [lng, lat] = f.geometry.coordinates
  const desc = f.properties.description ?? ''

  const rawName = (f.properties.name ?? '').replace(/\s+/g, ' ').trim()
  const noName = /^no name yet/i.test(rawName)

  let name: string
  let aka = ''
  let missing = false
  let fostered = false
  if (noName) {
    const rest = rawName.replace(/^no name yet\s*[-,]?\s*/i, '')
    name = 'No name yet - ' + titleCase(rest)
  } else {
    const bare = rawName.replace(/^"+|"+$/g, '').trim()
    name = bare.split(' (')[0].replace(/^"+|"+$/g, '').trim()
    const paren = bare.slice(name.length)
    const akaM = /\(aka ([^)]+)\)/i.exec(paren)
    if (akaM) aka = akaM[1].trim()
    missing = /\(missing\)/i.test(paren)
    fostered = /\(fostered\)/i.test(paren)
  }

  // Dedupe: same name at the same spot is the same cat entered twice.
  const key = `${slugify(name)}|${lng.toFixed(6)},${lat.toFixed(6)}`
  if (seen.has(key)) {
    dupes++
    console.warn(`  skip duplicate: ${name}`)
    continue
  }
  seen.add(key)

  let id = slugify(name)
  for (let n = 2; usedIds.has(id); n++) id = `${slugify(name)}-${n}`
  usedIds.add(id)

  const coat = field(desc, 'Color')
  const sex = field(desc, 'Sex').toLowerCase()
  const knownSex = sex === 'male' || sex === 'female'
  let spot = field(desc, 'Spot') || 'Unrecorded'
  if (/^steel parking$/i.test(spot)) spot = 'Steel Parking Mckinley West'
  if (/^asiatown\//i.test(spot)) spot = 'Asiatown'
  const behavior = field(desc, 'Behavior')
  const tnr = field(desc, 'TNR')
  const noteText = field(desc, 'Note')

  const photoInner = (/\{\{(.+?)\}\}/.exec(desc)?.[1] ?? '').trim().replace(/^h+ttp/, 'http')
  assert(/^https?:\/\//.test(photoInner), `${id}: no photo URL in description`)

  const notes = [
    aka ? `Also known as ${aka}.` : '',
    sentence(noteText),
    missing ? 'Not seen since the survey.' : '',
    fostered ? 'Now in foster care.' : '',
    tnr.includes('✅') ? '' : 'TNR status not confirmed.',
  ].filter(Boolean)

  parsed.push({
    id,
    name,
    colour: coatToColour(coat),
    description: knownSex ? `${coat} · ${sex}` : coat || 'Unrecorded coat',
    disposition: behavior || 'Not recorded',
    note: notes.length ? notes.join(' ') : undefined,
    spot,
    lng,
    lat,
    photo: photoInner,
  })
}

// One LINE number per Spot, in first-seen order (a survey line is a route;
// cats on the same route share it, same as the old seed).
const lineNo = new Map<string, number>()
for (const p of parsed) if (!lineNo.has(p.spot)) lineNo.set(p.spot, lineNo.size + 1)

function pickShape(id: string): string {
  let h = 0
  for (const ch of id) h = (h + ch.charCodeAt(0)) % SHAPES.length
  return SHAPES[h].id
}

const cats: Record<string, string | undefined>[] = []
const features: unknown[] = []

parsed.forEach((p, i) => {
  const here: [number, number] = [p.lng, p.lat]
  // ~100-170 m across, jittered per cat so a colony is not a stack of
  // identical circles. Overlap is expected and fine at this density.
  const radiusM = 50 + (hashN(p.id) % 36)
  const shape = pickShape(p.id)
  const ring = shapeRing(shape as never, here, radiusM)

  const body = ring.slice(0, -1)
  const cx = body.reduce((s, pt) => s + pt[0], 0) / body.length
  const cy = body.reduce((s, pt) => s + pt[1], 0) / body.length

  cats.push({
    id: p.id,
    name: p.name,
    plate: `PLATE ${pad2(i + 1)}`,
    line: `LINE ${pad2(lineNo.get(p.spot)!)} · ${p.spot.toUpperCase()}`,
    colour: p.colour,
    description: p.description,
    firstRecorded: '2024',
    range: p.spot,
    disposition: p.disposition,
    note: p.note,
    coordinates: `${cy.toFixed(4)}° N, ${cx.toFixed(4)}° E`,
    photo: p.photo,
    _radiusM: String(radiusM),
  })

  features.push({
    type: 'Feature',
    properties: { id: p.id, name: p.name },
    geometry: { type: 'Polygon', coordinates: [ring] },
  })
})

// --- checks: nothing writes if the parse produced junk -----------------
assert(parsed.length === cats.length && cats.length === features.length)
assert(cats.length >= 46 && cats.length <= 49, `expected ~48 cats, got ${cats.length}`)
assert(new Set(cats.map((c) => c.id)).size === cats.length, 'duplicate ids')
for (const c of cats) {
  for (const k of ['id', 'name', 'plate', 'line', 'colour', 'description', 'firstRecorded', 'range', 'disposition', 'coordinates', 'photo']) {
    assert(c[k], `${c.id}: empty ${k}`)
  }
  assert(VALID_COLOURS.has(c.colour!), `${c.id}: bad colour ${c.colour}`)
  assert(/^PLATE \d\d$/.test(c.plate!), `${c.id}: bad plate ${c.plate}`)
  assert(/^LINE \d\d · \S/.test(c.line!), `${c.id}: bad line ${c.line}`)
  assert(/^https?:\/\//.test(c.photo!), `${c.id}: bad photo ${c.photo}`)
  const r = Number(c._radiusM)
  assert(r >= 50 && r <= 85, `${c.id}: radius ${r} out of range`)
}

// --- write territories.geo.json ---------------------------------------
writeFileSync(OUT_GEO, JSON.stringify({ type: 'FeatureCollection', features }, null, 2) + '\n')

// --- write cats.seed.ts: keep everything above the CATS array, replace
//     the array (and the stale comment block right before it) -----------
const src = readFileSync(OUT_SEED, 'utf8')
const marker = '\nexport const CATS: Cat[] = ['
const cut = src.indexOf(marker)
assert(cut > 0, `${OUT_SEED}: could not find the CATS array`)
// Keep everything above the array, minus the one comment block right before
// it (the old roster note). Walk back from the `*/`, not a greedy regex:
// an end-anchored /\/\*[\s\S]*?\*\//  matches from the FIRST /* in the file.
let h = src.slice(0, cut).replace(/\s+$/, '')
if (h.endsWith('*/')) h = h.slice(0, h.lastIndexOf('/*')).replace(/\s+$/, '')
const head = h + '\n'

const preamble = `/* The Bonifacio Global City / McKinley West field roster, generated from
   the uMap survey export by scripts/importUmap.ts. Regenerate with
   \`npm run import:umap\`; do not hand-edit this array, the next run
   overwrites it.

   Territories are estimated, not surveyed: each cat's survey pin is the
   centre of a ~100-170 m range. The survey is ~11 tight colonies in a few
   hundred metres, so these overlap heavily by design. Only the polygon
   and its centroid are kept here, never the pin. Every cat is now a real
   Taguig community cat, which is the exact condition spec §9's
   territory-only rule was written for: it is load-bearing from here, not a
   preference. */`

const emit = (c: Record<string, string | undefined>): string => {
  const rows = [
    `    id: ${tsStr(c.id!)},`,
    `    name: ${tsStr(c.name!)},`,
    `    plate: ${tsStr(c.plate!)},`,
    `    line: ${tsStr(c.line!)},`,
    `    colour: ${tsStr(c.colour!)},`,
    `    description: ${tsStr(c.description!)},`,
    `    firstRecorded: ${tsStr(c.firstRecorded!)},`,
    `    range: ${tsStr(c.range!)},`,
    `    disposition: ${tsStr(c.disposition!)},`,
  ]
  if (c.note) rows.push(`    note: ${tsStr(c.note)},`)
  rows.push(`    coordinates: ${tsStr(c.coordinates!)},`)
  rows.push(`    photo: ${tsStr(c.photo!)},`)
  return `  {\n${rows.join('\n')}\n  },`
}

writeFileSync(OUT_SEED, `${head}\n\n${preamble}\nexport const CATS: Cat[] = [\n${cats.map(emit).join('\n')}\n]\n`)

// --- summary ---------------------------------------------------------
const bySpot = new Map<string, number>()
for (const c of cats) bySpot.set(c.range!, (bySpot.get(c.range!) ?? 0) + 1)
const radii = cats.map((c) => Number(c._radiusM))
console.log(`\n${cats.length} cats, ${features.length} territories (${dupes} duplicates skipped)`)
console.log(`radius: min ${Math.min(...radii)} m, max ${Math.max(...radii)} m`)
console.log('territories per spot:')
for (const [spot, n] of [...bySpot].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(2)}  ${spot}`)
console.log(`\nwrote ${OUT_GEO}\nwrote ${OUT_SEED}`)
