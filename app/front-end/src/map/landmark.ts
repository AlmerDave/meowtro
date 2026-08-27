import type { Map as MapLibreMap } from 'maplibre-gl'
import { distanceM } from '@/data/sightings'

/* Same list MapLabels.tsx ranks landmarks by, reused here so "nearest
   landmark" and "what the map itself calls a landmark" never disagree.
   No `office` kind exists in this pmtiles extract (MapLabels.tsx's own
   note, from a runtime dump of every POI kind in view). */
const LANDMARK_KINDS = ['mall', 'department_store', 'marketplace', 'hotel', 'theatre', 'station']

/* Past this, "nearest" stops being true: a POI or road half a kilometre
   away is not what oriented anyone to this point, it is just whatever
   happened to have a name. */
const SEARCH_RADIUS_M = 250

/** The named place closest to `point`, phrased the way the seeded cats'
    own `range` field already reads ("Near X"), or null when nothing named
    is close enough. Landmarks first (a mall orients better than a street),
    then the nearest named road.

    Same two source-layers MapLabels.tsx already draws from ('bgc' pois/
    roads), read the same way: querySourceFeatures over whatever tiles the
    map has already fetched, which is why this only works once the area
    around `point` has actually been in view. True in practice for an
    approval — selecting a cat already eases the camera to it
    (Territories.tsx's focus effect) before an admin can reach the Approve
    button at all.

    Roads are ranked by nearest vertex rather than a true point-to-segment
    distance: this app's other range maths (ringRadiusM) is vertex-based
    for the same reason — cheap, and correct enough at the ~10m coordinate
    precision these shapes are stored at. */
export function nearestPlaceName(map: MapLibreMap, point: [number, number]): string | null {
  let bestLandmark: { name: string; distance: number } | null = null
  for (const feature of map.querySourceFeatures('bgc', { sourceLayer: 'pois' })) {
    const name = feature.properties?.name as string | undefined
    const kind = feature.properties?.kind as string | undefined
    if (!name || !kind || feature.geometry.type !== 'Point' || !LANDMARK_KINDS.includes(kind)) continue
    const distance = distanceM(point, feature.geometry.coordinates as [number, number])
    if (distance <= SEARCH_RADIUS_M && (!bestLandmark || distance < bestLandmark.distance)) {
      bestLandmark = { name, distance }
    }
  }
  if (bestLandmark) return `Near ${bestLandmark.name}`

  let bestRoad: { name: string; distance: number } | null = null
  for (const feature of map.querySourceFeatures('bgc', { sourceLayer: 'roads' })) {
    const name = feature.properties?.name as string | undefined
    if (!name || feature.geometry.type !== 'LineString') continue
    for (const vertex of feature.geometry.coordinates as [number, number][]) {
      const distance = distanceM(point, vertex)
      if (distance <= SEARCH_RADIUS_M && (!bestRoad || distance < bestRoad.distance)) {
        bestRoad = { name, distance }
      }
    }
  }
  return bestRoad ? `Near ${bestRoad.name}` : null
}
