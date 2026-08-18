import { useMemo } from 'react'
import { motion } from 'motion/react'
import type { FeatureCollection, Polygon } from 'geojson'
import territories from '@/data/territories.geo.json'

/* The territory, drawn.

   The plate could describe a cat's range in three sentences and never once
   show it, which is what it did until this, on a project whose entire
   thesis is that a cat is a polygon and not a pin. This is that thesis
   printed on the specimen card: the actual outer ring out of
   territories.geo.json, the same geometry the map fills, normalised into a
   glyph and drawn in the cat's own colour.

   It is real data end to end. Nothing here is illustrative: the shape is the
   polygon, the dot is the same arithmetic centroid the map's marker and glow
   share (map/centroid.ts), and the span is measured off the ring's own
   bounding box. A cat with a wider range gets a visibly wider glyph.

   Not a second map. No basemap, no north arrow, no interaction, the map is
   ten inches to the left and is the thing you pan. This is the diagram of
   one shape, at a size where the shape is all that survives. */

const FC = territories as FeatureCollection<Polygon>

/** Padding inside the 100x100 viewBox, so the stroke never clips its own box. */
const PAD = 8

/* Metres per degree of latitude. Longitude shrinks by cos(lat), at BGC's
   14.55°N that is a 3% correction, which is under a metre on a 200m range
   and still cheaper to apply than to justify leaving out. */
const M_PER_DEG = 111_320

type Glyph = {
  d: string
  cx: number
  cy: number
  /** Widest span of the territory, in metres, rounded to something a person
      would actually say out loud. */
  span: number
}

function build(catId: string): Glyph | null {
  const ring = FC.features.find((f) => f.properties?.id === catId)?.geometry.coordinates[0] as
    | [number, number][]
    | undefined
  if (!ring || ring.length < 3) return null

  const lngs = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)

  const midLat = (minLat + maxLat) / 2
  const wideM = (maxLng - minLng) * M_PER_DEG * Math.cos((midLat * Math.PI) / 180)
  const tallM = (maxLat - minLat) * M_PER_DEG

  /* One scale for both axes, off the longer one. Fitting each axis to the
     box independently would stretch a long thin territory into a circle and
     make every cat's range the same shape, which is the one thing this
     glyph exists to disprove. */
  const size = Math.max(maxLng - minLng, maxLat - minLat) || 1
  const scale = (100 - PAD * 2) / size
  // Centred in the box, and y flipped: latitude counts north, SVG counts down.
  const ox = 50 - ((minLng + maxLng) / 2) * scale
  const oy = 50 + ((minLat + maxLat) / 2) * scale
  const x = (lng: number) => ox + lng * scale
  const y = (lat: number) => oy - lat * scale

  const d = ring.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(2)} ${y(p[1]).toFixed(2)}`).join(' ') + ' Z'

  return {
    d,
    cx: x(lngs.reduce((a, b) => a + b, 0) / ring.length),
    cy: y(lats.reduce((a, b) => a + b, 0) / ring.length),
    span: Math.round(Math.max(wideM, tallM) / 10) * 10,
  }
}

type Props = {
  catId: string
  /** Delay before the outline starts drawing, so it lands with its field
      rather than racing the stagger above it. */
  delay?: number
}

export function TerritoryGlyph({ catId, delay = 0 }: Props) {
  const glyph = useMemo(() => build(catId), [catId])
  if (!glyph) return null

  return (
    <div className="territory-glyph">
      {/* aria-hidden and the span repeated as text below: an outline is not
          describable to a screen reader in any useful way, and the one fact
          it carries that words can carry too is how far across it is. */}
      <svg viewBox="0 0 100 100" aria-hidden>
        <motion.path
          d={glyph.d}
          className="territory-glyph-fill"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: delay + 0.35 }}
        />
        {/* pathLength is Motion's, not a hand-computed stroke-dasharray: it
            normalises the path to 0..1 so the same transition works whatever
            the polygon's real perimeter is. The line being drawn rather than
            faded in is the point, a survey boundary is walked. */}
        <motion.path
          d={glyph.d}
          className="territory-glyph-line"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, delay, ease: [0.23, 1, 0.32, 1] }}
        />
        <motion.circle
          cx={glyph.cx}
          cy={glyph.cy}
          r={3}
          className="territory-glyph-dot"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: delay + 0.55, type: 'spring', stiffness: 420, damping: 24 }}
        />
      </svg>
      <span className="territory-glyph-span">{glyph.span} m across</span>
    </div>
  )
}
