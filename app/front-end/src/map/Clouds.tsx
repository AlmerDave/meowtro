import { useId } from 'react'
import { useMap } from './MapCanvas'

/* Backlog "Clouds" item, plan B — hand-drawn drifting shapes layered over
   the native sky (style.ts's buildSky/animateSky), added because the
   breathing atmosphere alone reads as a static haze, not "clouds". Same
   technique as the paper grain (Grain.tsx): an SVG filter, driven by CSS,
   no canvas and no rAF loop. Confined to the top band of the viewport,
   where a pitched camera actually shows sky (see DEFAULT_PITCH's comment
   in style.ts) — below that band there is nothing to sit in front of.

   Three rows, three read as a formation. Each row is a 200%-wide strip
   holding two copies of the same cluster; CSS animates it exactly -50% and
   loops, so the seam where the strip repeats is never visible. Purely
   decorative (no state it needs to convey) and gated behind isFlat both
   ways: opacity fades with the 3D toggle, and the animation itself pauses
   at opacity 0 rather than drifting off-screen forever. */

type Puff = { cx: number; cy: number; rx: number; ry: number }

// One loose cloud silhouette — four overlapping lobes, not a single ellipse.
// A lone blob reads as a blurred dot; overlap is what reads as "cloud".
const CLUSTER: Puff[] = [
  { cx: 14, cy: 12, rx: 9, ry: 5 },
  { cx: 22, cy: 9, rx: 11, ry: 6 },
  { cx: 32, cy: 12, rx: 8, ry: 4.5 },
  { cx: 24, cy: 15, rx: 13, ry: 5 },
]

function CloudStrip() {
  const filterId = useId()
  return (
    <svg className="cloud-strip" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <g fill="var(--ink-soft)" filter={`url(#${filterId})`}>
        {CLUSTER.map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} />
        ))}
        {/* Second cluster, offset and slightly smaller, fills the strip's
            back half so the row doesn't read as one shape on a metronome. */}
        <g transform="translate(56 3) scale(0.8)">
          {CLUSTER.map((p, i) => (
            <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} />
          ))}
        </g>
      </g>
    </svg>
  )
}

// top/height place each row inside the sky band; duration staggers their
// drift so three rows never line up; opacity is each row's own "depth" —
// separate from (and multiplied under) the container's isFlat fade below.
const ROWS = [
  { top: '2%', height: '14vh', duration: '150s', opacity: 0.24 },
  { top: '11%', height: '16vh', duration: '210s', opacity: 0.17 },
  { top: '19%', height: '12vh', duration: '270s', opacity: 0.12 },
]

export function Clouds() {
  const { isFlat } = useMap()

  return (
    <div className="clouds" data-visible={String(!isFlat)} aria-hidden="true">
      {ROWS.map((row) => (
        <div
          key={row.top}
          className="cloud-row"
          style={{
            top: row.top,
            height: row.height,
            opacity: row.opacity,
            animationDuration: row.duration,
          }}
        >
          <CloudStrip />
          <CloudStrip />
        </div>
      ))}
    </div>
  )
}
