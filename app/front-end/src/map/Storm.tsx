import { useEffect, useRef } from 'react'
import { useMap } from './MapCanvas'

/* Storm, second weather pass (map/Rain.tsx was the first).

   Two fixed layers, and the split is the whole design:

   - the VEIL, a flat tint that says the light went out. This is the half
     that actually reads at a glance, and it is what gives the flash
     something to flash against. Its colour and alpha are one token per
     theme (--storm-veil), so light and dark each get the right kind of
     dark with no branch in here.
   - the FLASH, a radial gradient in --storm-flash on `mix-blend-mode:
     screen`, so a strike brightens the city underneath rather than laying
     a white sheet over it.

   The veil is why one blend mode works in both themes. Screening onto
   light's near-white ground would have almost no headroom to brighten
   into, so the flash would have been invisible in the app's DEFAULT theme;
   veiling the map down first is what gives it somewhere to go. It is also
   what film does with a night exterior: grade the scene down, then let the
   flash pop.

   Deliberately NOT a drawn bolt. Lightning at city scale is nearly always
   sheet lightning diffused through cloud, which is why a soft gradient is
   closer to the real thing than a line would be; a hand-drawn zigzag is
   the single most reliable way to make this read as a screensaver.

   Its own token rather than a tint derived from --paper, for the reason
   buildSky in style.ts carries: --paper is what the background and earth
   layers paint the ground with, so a veil mixed from it would tint the
   gloom in the exact colour of the thing it sits over and the layer would
   read as nothing at all.

   WAAPI (element.animate) rather than Motion, which owns every other
   moment in this app. A strike is PREDETERMINED motion, and it runs on a
   main thread that is already busy: MapLibre is uploading tiles and
   Rain.tsx has its own rAF loop. Handing the curve to the browser's
   animation engine means it is not another JS callback queueing behind
   those for exactly the 400ms that has to land. Note this does NOT claim
   compositor threading: mix-blend-mode below needs a rasterised backdrop, so the
   blend itself is unlikely to be free. The win is not owning the frame
   loop, not escaping the main thread. No library and nothing to install
   either: it is the platform. */

/** Milliseconds between strikes, as a range. Randomised per strike rather
    than fixed, because the tell that something is a special effect rather
    than weather is that it arrives on a metronome.

    Frequent by direction: the rain in this storm falls dead vertical
    (Rain.tsx's storm row is windless), so the lightning is now carrying
    the whole sense of something happening out there rather than
    punctuating wind that is already doing it.

    The floor is not arbitrary. WCAG 2.3.1 allows no MORE than three
    flashes in any one second for something this large on screen, and a
    strike is up to three pops inside its first ~200ms. At a 1.6s floor the
    envelopes cannot overlap, so a one-second window can only ever contain
    one strike's flashes, and three stays three. Do not drop this below
    ~1.2s without cutting the pop ceiling to match. */
const GAP_MS = [1600, 4800] as const

/** One strike's whole envelope, flicker and decay together. Well over the
    300ms ceiling this project holds its UI motion to, on purpose: that
    ceiling is for a control answering a person, and this is a thing
    happening in the world. A 200ms strike reads as a light switch. */
const DURATION_MS = [380, 520] as const

/** Where across the sky the strike sits, as a percentage. A strike that is
    always centred reads as a screen effect with no direction; one that
    lands somewhere different each time reads as being over there. */
const ORIGIN_PCT = [8, 92] as const

/** Peak brightness, as a range: some strikes are close and some are three
    districts away. Without this every strike is identically bright, which
    is its own kind of metronome. */
const PEAK = [0.45, 1] as const

/** tokens.css's --ease-out, inlined because WAAPI takes a string and
    cannot read a custom property. The one duplicated value in this file. */
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

function rand([lo, hi]: readonly [number, number]) {
  return lo + Math.random() * (hi - lo)
}

/** One strike as a keyframe list: an instant attack, one to three pops
    with dips between them, then a long decay.

    This shape is the part that decides real or fake. Real lightning has a
    one-frame attack and a slow exponential decay, never a symmetric fade,
    and it very often double-blinks. That flicker is what the eye reads as
    lightning rather than as a lamp being switched on. Both are front
    loaded here: every pop happens inside the first half of the envelope,
    and the whole back half is decay.

    Exported with no in-app consumer on purpose: WAAPI throws if offsets
    are not strictly increasing, and these are assembled from four random
    ranges, so the invariant cannot be read off the code by eye. Verified
    by transforming this file with esbuild and asserting over 200k strikes
    that offsets rise, that the envelope starts and ends dark, that opacity
    stays in [0,1], that the flicker finishes inside the first half, and
    that the first pop is always the brightest. Re-run it that way if these
    numbers are ever retuned; there is no test runner in this project to
    hang it on (see CLAUDE.md). */
export function strikeKeyframes(): Keyframe[] {
  const pops = 1 + Math.floor(Math.random() * 3)
  const peak = rand(PEAK)
  // `easing` on a keyframe governs the segment that STARTS at it, so the
  // opening frame's linear ramp is the attack and each pop's ease-out is
  // its own decay.
  const frames: Keyframe[] = [{ opacity: 0, offset: 0, easing: 'linear' }]
  let at = 0.03
  for (let i = 0; i < pops; i++) {
    // The first pop is the brightest. A later stroke outshining the initial
    // discharge is not a thing that happens.
    const amp = peak * (i === 0 ? 1 : 0.5 + Math.random() * 0.4)
    frames.push({ opacity: amp, offset: at, easing: EASE_OUT })
    at += 0.05 + Math.random() * 0.06
    if (i < pops - 1) {
      // The dip never reaches zero: the channel is still glowing between
      // strokes, and cutting to black between pops is what makes an effect
      // read as a strobe rather than as weather.
      frames.push({ opacity: amp * (0.12 + Math.random() * 0.18), offset: at, easing: 'linear' })
      at += 0.03 + Math.random() * 0.04
    }
  }
  frames.push({ opacity: 0, offset: 1, easing: EASE_OUT })
  return frames
}

export function Storm() {
  const { weather } = useMap()
  const flashRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = flashRef.current
    if (!el || weather !== 'storm') return

    /* The one hard branch in this file. A full-viewport strobe is precisely
       what prefers-reduced-motion exists to stop (photosensitivity
       overlaps heavily with the people who set it), so the flash is off
       entirely rather than gentler, the one place the usual "reduce, don't
       remove" rule does not apply. The veil is CSS and stays, and Rain.tsx
       already holds its drop field still under the same query, so a
       reduced-motion storm is a dark map under a frozen diagonal hatch:
       still unmistakably a storm, with nothing flashing. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let animation: Animation | null = null
    // The first strike lands shortly after the veil arrives rather than a
    // full gap later: a storm that waits to prove itself reads as a broken
    // toggle.
    let timer = window.setTimeout(function fire() {
      el.style.setProperty('--flash-x', `${rand(ORIGIN_PCT)}%`)
      // Cancelled rather than left to finish. Gaps are seconds and strikes
      // are under one, so this can only overlap if the tab was throttled,
      // in which case the stale strike should not composite over the new.
      animation?.cancel()
      animation = el.animate(strikeKeyframes(), {
        duration: rand(DURATION_MS),
        // The keyframes carry their own per-segment easing; a curve here
        // would apply on top of them and flatten the attack.
        easing: 'linear',
        fill: 'none',
      })
      timer = window.setTimeout(fire, rand(GAP_MS))
    }, 900)

    return () => {
      window.clearTimeout(timer)
      animation?.cancel()
    }
    /* Restarted on every weather change, unlike the deliberately mount-only
       effect in Rain.tsx. That one reads `weather` through a ref because
       restarting it would reseed a whole drop field; there is nothing here
       but a timer, so tearing it down is both the cheapest way to stop
       striking and the only way that does not leave a pending timeout
       behind. */
  }, [weather])

  /* Two siblings, not a wrapper with two children, and that is load
     bearing: an opacity below 1 on a parent creates a stacking context,
     which would trap `mix-blend-mode: screen` into blending against the
     veil alone instead of against the map and the labels beneath it. Both sit directly in .map's stacking context so a strike
     lights the whole scene. */
  return (
    <>
      <div className="storm-veil" data-active={String(weather === 'storm')} aria-hidden="true" />
      <div className="storm-flash" ref={flashRef} aria-hidden="true" />
    </>
  )
}
