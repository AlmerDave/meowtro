/* A localStorage-backed patch layer for frozen seed arrays.

   cats.seed.ts's CATS and sightings.ts's SEEDED are both plain module-level
   constants, imported once and never rewritten: that is what makes them
   "seed" data. An admin editing or deleting one of them has nowhere to
   write the change TO, so it is kept beside the source instead, and applied
   at read time, the same shape catsRepo already uses to move a territory
   toward its newest sighting (translateToward) rather than mutating the
   drawn outline.

   Two operations only, because that is everything an admin does to a
   record they do not own the storage for: PATCH a field, or HIDE the whole
   row. A recorded cat or a reported sighting is not frozen at all, so it
   never touches this file, it is rewritten directly where it already lives
   (data/localCats.ts, data/sightings.ts's own `write`). */

type OverlayState = {
  patch: Record<string, Record<string, unknown>>
  hidden: string[]
}

const EMPTY: OverlayState = { patch: {}, hidden: [] }

/* Same defensiveness as every other localStorage reader in this app
   (localCats.ts, sightings.ts): the value is a string a person can edit by
   hand, and a malformed shape here must fall back to "no overlay" rather
   than throw and take the read it is patching down with it. */
function isState(value: unknown): value is OverlayState {
  if (!value || typeof value !== 'object') return false
  const { patch, hidden } = value as Partial<OverlayState>
  return (
    !!patch &&
    typeof patch === 'object' &&
    !Array.isArray(patch) &&
    Array.isArray(hidden) &&
    hidden.every((id) => typeof id === 'string')
  )
}

export function readOverlay(key: string): OverlayState {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : EMPTY
    return isState(parsed) ? parsed : EMPTY
  } catch {
    return EMPTY
  }
}

function writeOverlay(key: string, state: OverlayState): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

/** Merges `fields` onto whatever is already patched for `id`. */
export function patchOverlay(key: string, id: string, fields: Record<string, unknown>): boolean {
  const state = readOverlay(key)
  return writeOverlay(key, {
    ...state,
    patch: { ...state.patch, [id]: { ...state.patch[id], ...fields } },
  })
}

/** Hides `id` from the frozen source it belongs to. Idempotent, since a
    second delete of an already-hidden row is not an error. */
export function hideOverlay(key: string, id: string): boolean {
  const state = readOverlay(key)
  if (state.hidden.includes(id)) return true
  return writeOverlay(key, { ...state, hidden: [...state.hidden, id] })
}

/** The read side: patch and hidden applied to a frozen list in one pass.
    `idOf` rather than assuming an `id` field, so this serves both Cat and
    Sighting without either needing to agree on a shape beyond having one. */
export function applyOverlay<T>(key: string, items: T[], idOf: (item: T) => string): T[] {
  const { patch, hidden } = readOverlay(key)
  return items
    .filter((item) => !hidden.includes(idOf(item)))
    .map((item) => {
      const fields = patch[idOf(item)]
      return fields ? { ...item, ...fields } : item
    })
}
