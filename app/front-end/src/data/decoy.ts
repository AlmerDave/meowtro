import type { Feature, Polygon } from 'geojson'
import { translateToward } from './sightings'

/* The middle of BGC. A copy of map/style.ts's BGC_CENTER rather than an
   import of it: this module is loaded by decoy.check.ts under plain node
   (npm run check:decoy), and map/style.ts pulls in maplibre-gl and DOM
   helpers that do not exist there. Two numbers, pointed back at their
   source; keep them in step if that constant ever moves. */
const BGC_CENTER: [number, number] = [121.05, 14.5512]

/* Decoy placement: an unprivileged viewer sees a cat's real territory
   outline moved to a fake point inside BGC. Real shape, real size, fake
   position. "Same experience, fake location" (spec
   docs/superpowers/specs/2026-09-01-territory-visibility-decoy-design.md).

   ponytail: this degrades the VIEW, not the DATA. The real polygon still
   ships to every browser inside cats/{id} (firestore.rules: read if true),
   so a determined viewer reads it off the network tab or the Firestore
   REST endpoint. A real boundary needs the data split (a public fuzzed
   polygon in cats/{id} and the precise ring in a gated cats/{id}/precise
   doc) and lands when cats are real. Recorded, deferred, on purpose. */

/* The decoy box is centred on BGC_CENTER with this half-span in degrees,
   NOT the full BGC_BOUNDS: that extract is padded ~4x past BGC proper (see
   its note in map/style.ts), so an id could otherwise be placed a couple
   of kilometres out in Makati or a cemetery rather than "somewhere in
   BGC". ~0.012 deg is ~1.3 km, which keeps every decoy inside the real
   district while still spreading them across it. A ~140 m territory
   dropped anywhere in this box stays well clear of the extract edge. */
const HALF_SPAN_DEG = 0.012

/* A stable 32-bit FNV-1a hash of the id. Deterministic and
   dependency-free: the decoy must be identical on every load, every
   session, every device, so a cat never appears to "jump" between page
   loads and averaging many loads reveals nothing but the centre of the
   box. */
function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A point inside the decoy box, stable forever for this cat. Two
    independent hash streams (the id, and the id reversed) give lng and lat
    their own spread, so ids that are similar as strings do not land in a
    diagonal line. */
export function decoyPoint(catId: string): [number, number] {
  const [cx, cy] = BGC_CENTER
  const fx = hash(catId) / 0xffffffff
  const fy = hash([...catId].reverse().join('')) / 0xffffffff
  return [cx + (fx * 2 - 1) * HALF_SPAN_DEG, cy + (fy * 2 - 1) * HALF_SPAN_DEG]
}

/** The feature's real polygon, moved so its centroid lands on
    decoyPoint(catId). Delegates to translateToward, which is a flat
    per-vertex offset (correct at this scale, see its own note in
    data/sightings.ts), so vertex count and every pairwise vertex distance
    are preserved: shape and size are unchanged, only position moves. */
export function decoyFeature(feature: Feature<Polygon>, catId: string): Feature<Polygon> {
  return translateToward(feature, decoyPoint(catId))
}
