import { CATS, type Cat } from './cats.seed'

/* The v1/v2 seam, spec §9. The entire abstraction is that these two functions
   are async over a seeded array, so every consumer already handles loading and
   swapping to a real API is an edit to this file only.
   Territories stay polygons here and in v2: never an exact point for a real
   cat (spec §9, safety constraint). Do not add a `location` to Cat. */

export async function listCats(): Promise<Cat[]> {
  return CATS
}

export async function getCat(id: string): Promise<Cat | null> {
  return CATS.find((c) => c.id === id) ?? null
}

export type { Cat }
