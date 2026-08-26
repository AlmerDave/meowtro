/* Field-note quick phrases for Step 3 of ui/RecordCat.tsx: tap one and it
   inserts into the note text box (still freely editable after — this is a
   head start, not a replacement for typing; see the design spec's own
   pushback on why the note stays free text).

   Two lists. BUILTIN_NOTE_CHIPS never changes at runtime. The personal
   list is this browser's own, saved the same way data/localCats.ts and
   data/sightings.ts already persist their own local lists: read, validate,
   write, degrade to empty on anything wrong rather than throwing. */

export const BUILTIN_NOTE_CHIPS: string[] = [
  'Friendly with people',
  'Shy, keeps distance',
  'Vocal, meows a lot',
  'Food-motivated',
  'Territorial with other cats',
  'Follows joggers / people',
  'Sleeps in the same spot',
  'Grooms itself often',
]

const KEY = 'meowtro.noteChips.v1'

/** A personal list capped well short of anything that would make the chip
    row itself the long-form problem this whole redesign exists to fix. */
const MAX_CHIPS = 20

/** The pure half: given the current personal list and a freshly typed
    phrase, returns the list it should become. Trims, drops anything empty,
    rejects a case-insensitive duplicate of either list (a built-in phrase
    typed out by hand should tap the existing chip, not grow a second one
    beside it), and caps the length by dropping the oldest entries — newest
    phrases are the ones an admin is most likely to reach for again. */
export function mergeChip(list: string[], phrase: string): string[] {
  const trimmed = phrase.trim()
  if (!trimmed) return list
  const seen = new Set([...BUILTIN_NOTE_CHIPS, ...list].map((entry) => entry.toLowerCase()))
  if (seen.has(trimmed.toLowerCase())) return list
  const next = [...list, trimmed]
  return next.length > MAX_CHIPS ? next.slice(next.length - MAX_CHIPS) : next
}

function isChipList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** This browser's saved phrases. Same defensive read every other
    localStorage-backed list in this app uses: a hand-edited or truncated
    value degrades to "no personal phrases" rather than throwing. */
export function readChips(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return isChipList(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Saves a new phrase and returns the resulting list, or null if the write
    failed (quota, private mode) — same shape data/localCats.ts's
    writeStored gives its caller, so the panel can say saving failed
    instead of pretending it worked. */
export function addChip(phrase: string): string[] | null {
  const next = mergeChip(readChips(), phrase)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}
