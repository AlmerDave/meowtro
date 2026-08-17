/* Paper grain, spec §4. One of the three things in this project that stays
   hand-authored. Fixed overlay, multiply blend, above the map and below the
   UI: it is what makes the whole page read as printed rather than rendered. */
export function Grain({ on = true }: { on?: boolean }) {
  return (
    <svg className="grain" data-on={String(on)} aria-hidden="true">
      <filter id="paper-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#paper-grain)" opacity="0.32" />
    </svg>
  )
}
