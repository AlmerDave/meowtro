import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useMap } from './MapCanvas'

/* Labels, spec §6: "suppressed except parks and the three or four streets that
   orient you." A field survey is sparse; a basemap is not.

   These are DOM, not MapLibre symbol layers, for one reason: symbol layers
   need SDF glyphs from a font server, and the only stack the Protomaps asset
   server carries is Noto Sans. That would put a third typeface on a page whose
   whole rule is two (spec §4), and it would break the offline claim. At most
   ten absolutely-positioned spans, styled in shell.css, cost less than either:
   streets in tracked uppercase mono (a surveyor's annotation), parks and
   landmarks in `--font-display` (a written place-name, sage for parks, ink
   for landmarks) — reusing the app's existing two typefaces rather than
   adding a third, while still splitting built vs. natural. The display face
   is whatever the active theme resolves that token to (Fraunces on paper,
   the native stack on glass), which is exactly why these are DOM spans: an
   SDF glyph atlas could not have followed a theme switch. */

const STREET_COUNT = 4
const PARK_COUNT = 3
const LANDMARK_COUNT = 3

/* No `office` kind exists in this pmtiles extract (checked via a runtime
   dump of every POI kind in view — 45 distinct values, no "office"). These
   are what a passerby would actually use to orient near a mall or landmark;
   order is priority when more candidates exist than LANDMARK_COUNT. */
const LANDMARK_KINDS = ['mall', 'department_store', 'marketplace', 'hotel', 'theatre', 'station']

type Label = {
  text: string
  lngLat: [number, number]
  kind: 'street' | 'park' | 'landmark'
  // Street labels sit along the road; bearing is the two points bracketing
  // the label's anchor, projected to screen space and turned into an angle
  // at placement time (roads curve, so this is the local direction, not the
  // street's overall endpoints).
  bearing?: [[number, number], [number, number]]
}

/** Screen-space angle between two lngLat points, clamped to (-90, 90] so
    label text is never upside-down. */
function bearingAngle(map: MapLibreMap, [from, to]: [[number, number], [number, number]]) {
  const a = map.project(from)
  const b = map.project(to)
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  const normalized = ((deg % 180) + 180) % 180
  return normalized > 90 ? normalized - 180 : normalized
}

/** Rough planar length. Only used to rank streets against each other. */
function lineLength(coords: [number, number][]) {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1])
  }
  return total
}

/* The streets are picked by length rather than by name: the longest named
   roads *currently in view* are the ones that orient you, and nothing here
   has to know what BGC's streets are called.

   querySourceFeatures reads every tile the source has cached, not just what's
   on screen: at low zoom a single tile's footprint reaches well past BGC (a
   z8 road tile spans much of Metro Manila). Ranking must therefore be scoped
   to the current viewport, not the whole BGC extract — otherwise the winners
   are whatever's longest anywhere in the cached tiles, which may sit far off
   whatever the camera is looking at right now (this bit once already: see
   the build plan's decision log). Recomputed on every `moveend`, so panning
   toward a cat's territory brings that area's own streets/parks into view,
   the way a real map's labels behave, rather than a fixed set picked once. */
function collectLabels(map: MapLibreMap): Label[] {
  const bounds = map.getBounds()
  const inView = ([lng, lat]: [number, number]) => bounds.contains([lng, lat])

  const byName = new Map<
    string,
    { length: number; mid: [number, number]; bearing: [[number, number], [number, number]] }
  >()

  for (const feature of map.querySourceFeatures('bgc', { sourceLayer: 'roads' })) {
    const name = feature.properties?.name as string | undefined
    if (!name || feature.geometry.type !== 'LineString') continue
    const coords = feature.geometry.coordinates as [number, number][]
    const i = Math.floor(coords.length / 2)
    const mid = coords[i]
    if (!inView(mid)) continue
    const length = lineLength(coords)
    const existing = byName.get(name)
    if (existing && existing.length >= length) continue
    const bearing: [[number, number], [number, number]] = [
      coords[Math.max(0, i - 1)],
      coords[Math.min(coords.length - 1, i + 1)],
    ]
    byName.set(name, { length, mid, bearing })
  }

  const streets: Label[] = [...byName.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, STREET_COUNT)
    .map(([text, { mid, bearing }]) => ({
      text: text.toUpperCase(),
      lngLat: mid,
      kind: 'street',
      bearing,
    }))

  // Park names live on POIs: the landuse polygons carry no name field. Not
  // uppercased, unlike streets: parks read as a written place-name in the
  // --font-display face (see MapLabels' CSS), streets as a tracked technical
  // annotation in mono, and the case difference reinforces the same
  // built/natural split.
  const parks: Label[] = []
  const parksSeen = new Set<string>()
  // Landmarks share the pois source-layer with parks, so both are collected
  // in one pass. Ranked by LANDMARK_KINDS priority, not by count: a mall
  // matters more for orientation than three parking lots.
  const landmarkCandidates: { text: string; lngLat: [number, number]; priority: number }[] = []
  const landmarksSeen = new Set<string>()

  for (const feature of map.querySourceFeatures('bgc', { sourceLayer: 'pois' })) {
    const name = feature.properties?.name as string | undefined
    const kind = feature.properties?.kind as string | undefined
    if (!name || feature.geometry.type !== 'Point') continue
    const lngLat = feature.geometry.coordinates as [number, number]
    if (!inView(lngLat)) continue

    if ((kind === 'park' || kind === 'garden') && !parksSeen.has(name) && parks.length < PARK_COUNT) {
      parksSeen.add(name)
      parks.push({ text: name, lngLat, kind: 'park' })
      continue
    }

    const priority = kind ? LANDMARK_KINDS.indexOf(kind) : -1
    if (priority !== -1 && !landmarksSeen.has(name)) {
      landmarksSeen.add(name)
      landmarkCandidates.push({ text: name, lngLat, priority })
    }
  }

  const landmarks: Label[] = landmarkCandidates
    .sort((a, b) => a.priority - b.priority)
    .slice(0, LANDMARK_COUNT)
    .map(({ text, lngLat }) => ({ text, lngLat, kind: 'landmark' }))

  return [...streets, ...parks, ...landmarks]
}

export function MapLabels() {
  const { map, isLoaded } = useMap()
  const [labels, setLabels] = useState<Label[]>([])
  const layerRef = useRef<HTMLDivElement>(null)

  // Recomputed on every moveend (pan/zoom settled), plus once on the first
  // idle for the initial view: a fixed set computed once would go stale the
  // moment you pan toward a different part of BGC than whatever was on
  // screen at load.
  useEffect(() => {
    if (!map || !isLoaded) return
    const collect = () => setLabels(collectLabels(map))
    // Tiles for this exact viewport may not be parsed the instant `isLoaded`
    // flips, so the first run waits for idle; every viewport change after
    // that recomputes on moveend.
    map.once('idle', collect)
    map.on('moveend', collect)
    return () => {
      map.off('idle', collect)
      map.off('moveend', collect)
    }
  }, [map, isLoaded])

  // Reprojected on every move. Written straight to the DOM rather than through
  // state: this runs on each frame of a pan, and React does not need to know.
  useEffect(() => {
    if (!map || labels.length === 0) return
    const place = () => {
      const nodes = layerRef.current?.children
      if (!nodes) return
      labels.forEach((label, i) => {
        const point = map.project(label.lngLat)
        const node = nodes[i] as HTMLElement
        const rotate = label.bearing ? ` rotate(${bearingAngle(map, label.bearing)}deg)` : ''
        node.style.transform =
          `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` + rotate
      })
    }
    place()
    map.on('move', place)
    return () => void map.off('move', place)
  }, [map, labels])

  return (
    <div className="map-labels" ref={layerRef} aria-hidden="true">
      {labels.map((label) => (
        <span key={label.text} className="map-label" data-kind={label.kind}>
          {label.text}
        </span>
      ))}
    </div>
  )
}
