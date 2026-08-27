import { useMemo } from 'react'
import { motion } from 'motion/react'
import { ringCentroid } from '@/map/centroid'

/* The territory, drawn.

   The plate could describe a cat's range in three sentences and never once
   show it, which is what it did until this, on a project whose entire
   thesis is that a cat is a polygon and not a pin. This is that thesis
   printed on the specimen card: the actual outer ring, normalised into a
   glyph and drawn in the cat's own colour.

   It is real data end to end. Nothing here is illustrative: the shape is the
   polygon, the dot is the same arithmetic centroid the map's marker and glow
   share (map/centroid.ts), and the span is measured off the ring's own
   bounding box. A cat with a wider range gets a visibly wider glyph.

   The ring itself is a prop now, not a lookup against a static import — see
   Props' own note on `ring`. That is what lets this stay "the same geometry
   the map fills" even after a sighting has moved a territory: the old
   version read straight from territories.geo.json, which is the shape as
   first surveyed and never the shape a later approval translated it to, so
   this diagram used to freeze at whatever the cat looked like on day one
   while the actual map moved on without it.

   Not a second map. No basemap, no north arrow, no interaction, the map is
   ten inches to the left and is the thing you pan. This is the diagram of
   one shape, at a size where the shape is all that survives.

   2026-08-26: phase 9 added a second mark here for an open report's point
   (dashed circle plus an orange "Reported here, awaiting review" caption),
   on the reasoning that it was the only safe way for a visitor to see a
   claim at all while the map's own ghost stayed admin-only. That gate is
   gone now — every visitor sees the real ghost on the map itself
   (map/Territories.tsx) — and the caption read as visual noise once it
   was one of two places making the same point. Removed on user feedback
   ("unappealing"); the plate's own lock message still says a report is
   pending in words, this glyph is back to just drawing the shape. */

/** Padding inside the 100x100 viewBox, so the stroke never clips its own box. */
const PAD = 8

/* Metres per degree of latitude. Longitude shrinks by cos(lat), at BGC's
   14.55°N that is a 3% correction, which is under a metre on a 200m range
   and still cheaper to apply than to justify leaving out. */
const M_PER_DEG = 111_320

type Glyph = {
  d: string
  /** ringCentroid(ring), projected to SVG space. */
  cx: number
  cy: number
  /** Widest span of the territory, in metres, rounded to something a person
      would actually say out loud. */
  span: number
}

function build(ring: [number, number][] | undefined): Glyph | null {
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
  const [centreLng, centreLat] = ringCentroid(ring)

  return {
    d,
    cx: x(centreLng),
    cy: y(centreLat),
    span: Math.round(Math.max(wideM, tallM) / 10) * 10,
  }
}

type Props = {
  /** This cat's current outer ring, resolved by the caller rather than
      looked up here — Plate.tsx already resolves the same feature out of
      the live (post-translateToward) territories for its own
      describeReach, and passing that exact ring down means the diagram,
      the "outside the known range" sentence and the actual map can never
      disagree about which polygon "the territory" currently means.
      Undefined the same way describeReach's own ring is: a cat with no
      entry in the live territories yet draws nothing rather than a stale
      shape. */
  ring: [number, number][] | undefined
  /** Delay before the outline starts drawing, so it lands with its field
      rather than racing the stagger above it. */
  delay?: number
}

export function TerritoryGlyph({ ring, delay = 0 }: Props) {
  const glyph = useMemo(() => build(ring), [ring])
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
