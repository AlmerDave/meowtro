/* The loading screen's mark. Two cat animations were tried in its place
   (a hand-drawn SVG, then a real illustrated Lottie) and both were reverted
   on user direction, 2026-08-23: "I like the cube better." Both attempts'
   leftovers (public/cat-loading.json, public/dotlottie-player.wasm) are
   unused but left in place rather than deleted, since they predate this
   session and were not mine to remove.

   Adapted from "Cube Loader" by @daiv09 on 21st.dev. The rotation lives on
   .cube, each .cube-side carries only its facing rotation, and .cube-face
   animates translateZ along that side's own outward axis. Splitting those
   two is what stops a CSS cube fighting itself. */

export function LoadingCube() {
  return (
    <div className="cube-stage" aria-hidden>
      <div className="cube">
        <span className="cube-core" />
        {(['front', 'back', 'right', 'left', 'top', 'bottom'] as const).map((side) => (
          <span key={side} className={`cube-side cube-side-${side}`}>
            <span className="cube-face" />
          </span>
        ))}
      </div>
      <span className="cube-shadow" />
    </div>
  )
}
