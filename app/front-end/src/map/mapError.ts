/* Which MapLibre errors mean "there is no map", and which are noise.

   MapLibre reports everything through one `error` event: a whole source
   failing to resolve, a single tile aborting mid-pan, a sprite that is not
   there. Treating all of them the same in either direction is wrong. Show a
   failure panel on every error and one aborted tile request covers a
   working map with an apology; show it on none and a corrupt or missing
   bgc.pmtiles is a blank screen with no explanation, which is what this app
   did until now and the last ungraceful failure left in it.

   The rule is two clauses, and the first one carries it:

   1. Nothing is fatal once the map has painted. If a first frame reached
      the screen the basemap resolved, so whatever failed afterwards cost at
      most one tile and the map is still a map. This is also the clause that
      makes the whole thing safe by default: the app spends nearly all of
      its life on this side of it.

   2. Before that first paint, only failures of the basemap source itself
      count, plus failures that name no source at all. That second half is
      the pmtiles case specifically: when the protocol handler rejects, the
      style never resolves and MapLibre reports it with nothing to blame it
      on. A tile inside a source that IS resolving is not that. */

/** The basemap source, `sources.bgc` in map/style.ts. */
export const BASEMAP_SOURCE = 'bgc'

/** The shape of a MapLibre ErrorEvent this rule actually reads. Structural
    on purpose: the check below can then build one without constructing a
    real map, and the real event satisfies it. */
export type MapErrorLike = {
  sourceId?: string
  error?: unknown
}

export function isFatalMapError(event: MapErrorLike, hasPainted: boolean): boolean {
  if (hasPainted) return false
  return event.sourceId === undefined || event.sourceId === BASEMAP_SOURCE
}
