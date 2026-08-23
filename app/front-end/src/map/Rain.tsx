import { useEffect, useRef } from 'react'
import { useMap } from './MapCanvas'

/* Rain, first weather pass (backlog: overcast, storm).

   Screen space, not map space, and that is the physically correct choice
   rather than a shortcut. A cloud deck (Clouds.tsx) sits BETWEEN the camera
   and the ground, so it has to live in the scene and repaint if the camera
   pitches. Rain falls in front of the camera, in the air the viewer is
   already standing in, so a full-viewport overlay is what real rain looks
   like from here regardless of whether the map underneath is flat or
   tilted: there is nothing to project onto a ground plane, because the
   thing being drawn was never on the ground.

   Its own 2D canvas rather than joining Clouds' WebGL one: rain is a few
   hundred moving line segments, which is what canvas 2D's path API is for,
   and reaching for a fragment shader to draw lines would be the wrong tool
   for a job this simple.

   Density scales with the viewport's own area (see COUNT below) rather than
   a device-detection heuristic, which is a more honest kind of "adaptive":
   a phone screen is smaller, so it already asks for fewer drops with no
   guessing about the hardware behind it. */

const TOKEN = '--ink-soft'

/** Drops per square CSS pixel, clamped. A phone in portrait lands near the
    floor, a wide desktop near the ceiling, and both read as the same rain,
    just more or less of the same sky's worth of it. */
const AREA_DENSITY = 0.00014
const MIN_DROPS = 70
const MAX_DROPS = 260

/** Prevailing wind, in radians off straight down. Purely aesthetic: real
    rain is rarely perfectly vertical, and a constant slant reads as weather
    with a direction rather than a special effect with none. */
const WIND_ANGLE = Math.PI / 13

/** Two sine waves at different frequencies rather than one, and rather than
    per-frame randomness: a single sine is a metronome, and per-frame noise
    jitters every drop independently, which reads as static rather than
    wind. Two waves summed drift in and out of phase with each other, which
    is the cheapest thing that stops feeling mechanical. */
const GUST = [
  { freq: 0.00042, amp: 0.35 },
  { freq: 0.00097, amp: 0.18 },
] as const

type Drop = { x: number; y: number; len: number; speed: number }

function makeDrop(width: number, height: number, spawn: boolean): Drop {
  const speed = 480 + Math.random() * 260
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
    len: 14 + (speed - 480) / 12,
    speed,
  }
}

export function Rain() {
  const { weather, theme } = useMap()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the loop rather than in dependencies, matching Clouds.tsx:
  // toggling weather should not tear down and reseed the whole drop field.
  const visibleRef = useRef(weather === 'rain')
  visibleRef.current = weather === 'rain'
  const colorRef = useRef('#888')

  // --ink-soft is a plain hex in every theme block (tokens.css), never a
  // color-mix() result, so this can go straight to canvas strokeStyle with
  // none of the resolved-color probe Clouds.tsx needs for its WebGL floats.
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

    // Capped at 1.5 for the same reason Clouds.tsx caps its own: full
    // native resolution on a 3x phone screen is triple the fill work for
    // hairline strokes nobody can resolve the extra sharpness of anyway.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let drops: Drop[] = []

    const resize = () => {
      const w = Math.floor(canvas.clientWidth * dpr)
      const h = Math.floor(canvas.clientHeight * dpr)
      const count = Math.round(
        Math.min(MAX_DROPS, Math.max(MIN_DROPS, canvas.clientWidth * canvas.clientHeight * AREA_DENSITY))
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
      drops = Array.from({ length: count }, () => makeDrop(canvas.width, canvas.height, true))
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
      // Costs only the callback itself while off, matching Clouds.tsx's own
      // reasoning: checked per frame so the toggle is instant either way,
      // never a teardown-and-rebuild of the drop field. Clouds gets away
      // with skipping ALL work here because its own invisibility is a CSS
      // opacity transition, so a stale WebGL frame underneath is hidden
      // regardless; this canvas has no such CSS toggle, so it has to leave
      // itself empty on the way out instead.
      if (!visibleRef.current) {
        if (wasVisible) ctx.clearRect(0, 0, canvas.width, canvas.height)
        wasVisible = false
        return
      }
      wasVisible = true
      resize()

      const gust = GUST.reduce((sum, g) => sum + Math.sin(now * g.freq) * g.amp, 0)
      const angle = WIND_ANGLE + gust * 0.12
      const dx = Math.sin(angle)
      const dy = Math.cos(angle)

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      for (const drop of drops) {
        if (!reduced) {
          const step = drop.speed * dt * (1 + gust * 0.4) * dpr
          drop.x += dx * step
          drop.y += dy * step
          if (drop.y - drop.len > canvas.height) Object.assign(drop, makeDrop(canvas.width, canvas.height, false))
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
    // Deliberately empty deps beyond mount, matching Clouds.tsx: weather and
    // theme are read through the refs above, not restarted on. Rebuilding
    // this effect on every weather toggle would reseed the whole drop field
    // and cost a resize + array allocation for what should be an instant
    // show/hide.
  }, [])

  return <canvas className="rain" ref={canvasRef} aria-hidden="true" />
}
