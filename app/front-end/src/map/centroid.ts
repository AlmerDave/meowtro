import type { FeatureCollection, Polygon } from 'geojson'

/* Cat markers, backlog item ("3D cat markers on the map"). A marker's
   position is derived from the territory polygon, never stored: Cat must
   never get a `location` field (spec §9 safety constraint, catsRepo.ts).

   Arithmetic mean of the outer ring's vertices — not a true area centroid,
   but territories.geo.json's polygons are near-regular circles (see
   Territories.tsx), so the mean already lands within a metre or two of the
   real center. A real centroid algorithm (shoelace-weighted) is unjustified
   complexity for a shape this close to regular. */
/* Exported as well as used below: data/sightings.ts moves a territory by
   putting its centroid on a reported point, and it has to agree with this
   file about where that centroid is, or a moved shape would not sit under
   its own pin. */
export function ringCentroid(ring: [number, number][]): [number, number] {
  let lng = 0
  let lat = 0
  for (const [x, y] of ring) {
    lng += x
    lat += y
  }
  return [lng / ring.length, lat / ring.length]
}

/** Cat id -> [lng, lat], one entry per polygon feature that carries an id. */
export function centroidsById(territories: FeatureCollection<Polygon>): Map<string, [number, number]> {
  const byId = new Map<string, [number, number]>()
  for (const feature of territories.features) {
    const id = feature.properties?.id as string | undefined
    if (id) byId.set(id, ringCentroid(feature.geometry.coordinates[0] as [number, number][]))
  }
  return byId
}
