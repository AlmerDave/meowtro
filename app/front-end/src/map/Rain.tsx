import { useEffect, useRef } from 'react'
import { useMap, type Weather } from './MapCanvas'

/* Rain, the falling half of the weather (backlog: overcast).

   Storm is this file turned up, not a second system: heavier and faster,
   and falling straight down. Everything that used to be a module constant
   is now one row of FALL per weather, which is why storm cost no new
   canvas and no new loop here. The dark and the lightning that make a
   storm read as one live in map/Storm.tsx.

   Screen space, not map space, and that is the physically correct choice
   rather than a shortcut. Rain falls in front of the camera, in the air
   the viewer is already standing in, so a full-viewport overlay is what
   real rain looks like from here regardless of whether the map underneath
   is flat or tilted: there is nothing to project onto a ground plane,
   because the thing being drawn was never on the ground. Anything that
   sat between the camera and the city would need the opposite treatment,
   which is the trap the deleted cloud deck fell into.

   Canvas 2D rather than WebGL: rain is a few hundred moving line segments,
   which is what the path API is for, and reaching for a fragment shader to
   draw lines would be the wrong tool for a job this simple.

   Density scales with the viewport's own area (see COUNT below) rather than
   a device-detection heuristic, which is a more honest kind of "adaptive":
   a phone screen is smaller, so it already asks for fewer drops with no
   guessing about the hardware behind it. */

const TOKEN = '--ink-soft'

/** How hard it is coming down, one row per weather.

    - density: drops per square CSS pixel, clamped by min/max. A phone in
      portrait lands near the floor, a wide desktop near the ceiling, and
      both read as the same rain, just more or less of the same sky's worth
      of it.
    - wind: prevailing slant in radians off straight down. Purely
      aesthetic: real rain is rarely perfectly vertical, and a constant
      slant reads as weather with a direction rather than a special effect
      with none.
    - gust: two sine waves at different frequencies rather than one, and
      rather than per-frame randomness. A single sine is a metronome, and
      per-frame noise jitters every drop independently, which reads as
      static rather than wind. Two waves summed drift in and out of phase,
      the cheapest thing that stops feeling mechanical. An empty list is a
      windless row, and costs nothing per frame rather than summing waves
      that resolve to zero.

    `clear` is a real row rather than a null, so nothing downstream has to
    branch on whether there is weather. It shares rain's row outright: the
    field is simply never drawn while it is the active one, so its values
    only ever matter for the seeding that happens at mount. Overcast, when
    it lands, is this same row again. */
type Fall = {
  readonly density: number
  readonly min: number
  readonly max: number
  readonly speed: readonly [number, number]
  readonly wind: number
  readonly gust: readonly { readonly freq: number; readonly amp: number }[]
}

const SHOWER = {
  density: 0.00014,
  min: 70,
  max: 260,
  speed: [480, 740],
  wind: Math.PI / 13,
  gust: [
    { freq: 0.00042, amp: 0.35 },
    { freq: 0.00097, amp: 0.18 },
  ],
} as const satisfies Fall

const FALL = {
  clear: SHOWER,
  rain: SHOWER,
  storm: {
    // Roughly double the drops, moving half again as fast. The ceiling
    // matters more than the density here: this is the number that decides
    // whether a phone stays at 60fps.
    density: 0.00026,
    min: 130,
    max: 480,
    speed: [640, 1020],
    /* Windless, by direction rather than by physics: this storm is a
       downpour, not a squall. It is the one row that opts out of the slant
       the notes above argue for, so the drops fall dead vertical and the
       whole sense of direction moves to the lightning, which strikes from
       somewhere different every time (map/Storm.tsx). Both zero together:
       a slant with no gust reads as a static hatch, which is worse than
       either. */
    wind: 0,
    gust: [],
  },
} as const satisfies Record<Weather, Fall>

type Drop = { x: number; y: number; len: number; speed: number }

function makeDrop(width: number, height: number, spawn: boolean, fall: Fall): Drop {
  const [lo, hi] = fall.speed
  const speed = lo + Math.random() * (hi - lo)
  return {
    // A margin past both edges, not just [0, width]: with the wind's slant,
    // a drop born at y=0 travels sideways as it falls, so starting the pool
    // flush with the canvas edges would leave a visible gap at the upwind
    // corner where nothing ever reaches in time.
    x: -60 + Math.random() * (width + 120),
    // On first build the whole field is seeded at a random height so rain
    // is already mid-fall on the first frame instead of every drop starting
    // at the top together and arriving as one visible wave. A respawn after
    // that always restarts above the top.
    y: spawn ? Math.random() * height : -20 - Math.random() * 40,
    // Streak length off the drop's own speed, so a storm's faster drops
    // draw longer streaks for free. Measured from the row's own floor
    // rather than a hardcoded 480, or storm's drops would all start long.
    len: 14 + (speed - lo) / 12,
    speed,
  }
}

export function Rain() {
  const { weather, theme } = useMap()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the loop rather than in dependencies: toggling weather
  // should not tear down and reseed the whole drop field.
  const visibleRef = useRef(weather !== 'clear')
  visibleRef.current = weather !== 'clear'
  // The active row, same trick. rain -> storm changes the drop count, and
  // resize() below already reseeds whenever the count it computes stops
  // matching the field it has, so switching weather reseeds through the
  // path that was already there rather than through a new one.
  const fallRef = useRef<Fall>(FALL[weather])
  fallRef.current = FALL[weather]
  const colorRef = useRef('#888')

  // --ink-soft is a plain hex in every theme block (tokens.css), never a
  // color-mix() result, so this can go straight to canvas strokeStyle with
  // none of the color-resolving probe a color-mix() token would need.
  useEffect(() => {
    colorRef.current = getComputedStyle(document.documentElement).getPropertyValue(TOKEN).trim()
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    /* Reduced motion freezes the field rather than clearing it: a still
       diagonal hatch over the map still reads as "it is raining", and that
       is the fact worth keeping. The falling is the part somebody asked not
       to be shown, so the position update below is skipped entirely rather
       than run and simply not drawn. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Capped at 1.5 rather than devicePixelRatio: full native resolution
    // on a 3x phone screen is triple the fill work for hairline strokes
    // nobody can resolve the extra sharpness of anyway.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let drops: Drop[] = []

    const resize = () => {
      const fall = fallRef.current
      const w = Math.floor(canvas.clientWidth * dpr)
      const h = Math.floor(canvas.clientHeight * dpr)
      const count = Math.round(
        Math.min(fall.max, Math.max(fall.min, canvas.clientWidth * canvas.clientHeight * fall.density))
      )
      /* The canvas ELEMENT's width/height attributes are not enough to
         decide "is there nothing to do here": under StrictMode, this effect
         runs, is torn down, and runs again on the same persistent <canvas>
         DOM node. The first run sizes the canvas and seeds `drops`; its
         cleanup cancels the animation frame but does not (and should not)
         reset the element's width/height. The second run's `drops` is a
         fresh closure-local array, but its resize() then saw a canvas that
         was ALREADY the right size and returned before ever populating it,
         leaving the surviving effect animating an empty array forever, real
         bug, caught by reproducing it outside the browser and confirmed
         against the live report of "rain shows once, a reload stops
         showing it at all." drops.length is checked alongside the pixel
         dimensions so a second invocation that inherits a correctly-sized
         but unseeded canvas still seeds. */
      if (canvas.width === w && canvas.height === h && drops.length === count) return
      canvas.width = w
      canvas.height = h
      // Rebuilt at the new count on every resize rather than resized in
      // place: a phone rotating from portrait to landscape changes how much
      // sky is on screen, and the drop count should change with it exactly
      // as it would on first load at that size.
      drops = Array.from({ length: count }, () => makeDrop(canvas.width, canvas.height, true, fall))
    }
    resize()
    window.addEventListener('resize', resize)

    let lastTime = performance.now()
    // Tracks the visible -> invisible EDGE, not the level, so the canvas is
    // cleared exactly once when weather turns off rather than never (the
    // bug: turning rain off left the last drawn frame's streaks painted on
    // screen forever, since nothing downstream of the early return below
    // ever touched the canvas again) or every idle frame (wasteful, and
    // unnecessary once it is already empty).
    let wasVisible = false
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick)
      /* Real elapsed time, not an assumed 60fps. Advancing drops by a fixed
         per-frame amount was a genuine bug caught in review: on a 120Hz
         display rAF fires twice as often, so the same "per frame" step
         would have made rain fall visibly faster there than on a 60Hz
         screen for no reason connected to the rain itself. Capped at 50ms
         so a tab returning from being backgrounded (rAF paused, `now` jumps
         by seconds) advances drops one bounded step rather than teleporting
         the whole field to wherever a real elapsed multiplication would
         have sent it. */
      const dt = Math.min(now - lastTime, 50) / 1000
      lastTime = now
      // Costs only the callback itself while off: checked per frame so the
      // toggle is instant either way, never a teardown-and-rebuild of the
      // drop field. Note this cannot simply skip all work and leave the
      // last frame sitting there, the way a layer with a CSS opacity
      // transition over it could: nothing hides this canvas, so it has to
      // clear itself on the way out. That is what the edge below is for.
      if (!visibleRef.current) {
        if (wasVisible) ctx.clearRect(0, 0, canvas.width, canvas.height)
        wasVisible = false
        return
      }
      wasVisible = true
      resize()

      const fall = fallRef.current
      const gust = fall.gust.reduce((sum, g) => sum + Math.sin(now * g.freq) * g.amp, 0)
      const angle = fall.wind + gust * 0.12
      const dx = Math.sin(angle)
      const dy = Math.cos(angle)

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      for (const drop of drops) {
        if (!reduced) {
          const step = drop.speed * dt * (1 + gust * 0.4) * dpr
          drop.x += dx * step
          drop.y += dy * step
          if (drop.y - drop.len > canvas.height)
            Object.assign(drop, makeDrop(canvas.width, canvas.height, false, fall))
        }
        ctx.moveTo(drop.x, drop.y)
        ctx.lineTo(drop.x + dx * drop.len * dpr, drop.y + dy * drop.len * dpr)
      }
      // One path, one stroke, for every drop: canvas call overhead is what
      // scales badly here, not segment count, so batching into a single
      // draw call is what keeps a few hundred drops cheap.
      ctx.strokeStyle = colorRef.current
      ctx.globalAlpha = 0.4
      ctx.lineWidth = Math.max(1, 1.1 * dpr)
      ctx.stroke()
    })

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
    // Deliberately empty deps beyond mount: weather and theme are read
    // through the refs above, not restarted on. Rebuilding
    // this effect on every weather toggle would reseed the whole drop field
    // and cost a resize + array allocation for what should be an instant
    // show/hide.
  }, [])

  return <canvas className="rain" ref={canvasRef} aria-hidden="true" />
}
