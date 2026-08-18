import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'

/* The specular sweep. A soft light that tracks the pointer across a glass
   panel, so the material reads as something with a surface rather than a
   rectangle with a blur behind it. The anti-slop checklist
   (spec §4) already demanded real glass, blur, a crisp edge, a tuned shadow.
   This is the fourth thing real glass does: it catches the light.

   Three decisions worth stating, because each of them is the reason a
   cheaper version of this feels wrong:

   1. Spring, not raw pointer coordinates. A highlight pinned exactly to the
      cursor reads as a texture stuck to the mouse. Lagged through a soft
      spring it reads as a light source with mass, which is the whole effect.
      Stiffness is low on purpose, this is the one thing in the app allowed
      to arrive late.

   2. It moves its own transform, never a custom property on the panel.
      Writing --mx/--my to the parent on every pointermove invalidates style
      for every descendant, and the rail has thirty of them. Translating one
      absolutely-positioned child touches one element and stays on the
      compositor.

   3. Its own clipping wrapper, rather than overflow on the panel. `.plate`
      must not clip, the hero photo spends most of its flight outside the
      card (see shell.css), so the sweep brings the rounded window it needs
      with it instead of imposing one on its host.

   Off entirely for reduced motion and for coarse pointers: it is decoration
   with no informational job, and there is no pointer to track on a phone. */

export function Specular() {
  const ref = useRef<HTMLSpanElement>(null)
  const [lit, setLit] = useState(false)
  const reduced = useReducedMotion()

  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const x = useSpring(rawX, { stiffness: 120, damping: 22, mass: 0.6 })
  const y = useSpring(rawY, { stiffness: 120, damping: 22, mass: 0.6 })

  useEffect(() => {
    if (reduced) return
    const host = ref.current?.parentElement
    if (!host) return
    // Coarse pointers have nothing to track, and the listener would fire on
    // every touch-drag of the sheet for a highlight nobody can see.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    /* The panel's top-left, measured on entry and cached for the hover.
       Deliberately not re-measured per move: getBoundingClientRect forces a
       synchronous layout, and the rail runs a Motion `layout` animation that
       dirties the DOM every frame, so a rect read inside pointermove would
       force a full reflow on every one of them.

       Safe to cache because only the origin is used, and nothing moves a
       panel's origin mid-hover: both are fixed to a viewport corner, so the
       rail's collapse changes its height and not its top-left. A window
       resize does move the plate (it is anchored right), hence that one
       listener and no other. */
    let box: DOMRect | null = null

    const measure = () => {
      box = host.getBoundingClientRect()
    }

    const onMove = (e: PointerEvent) => {
      if (!box) return
      rawX.set(e.clientX - box.left)
      rawY.set(e.clientY - box.top)
    }

    const onEnter = (e: PointerEvent) => {
      measure()
      /* Placed before it is lit, so entering from any edge finds the light
         already where the pointer is instead of watching it fly in from
         wherever it was parked when the pointer last left. */
      onMove(e)
      x.jump(rawX.get())
      y.jump(rawY.get())
      setLit(true)
    }

    const onLeave = () => setLit(false)

    host.addEventListener('pointerenter', onEnter)
    host.addEventListener('pointermove', onMove, { passive: true })
    host.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', measure)
    return () => {
      host.removeEventListener('pointerenter', onEnter)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', measure)
    }
  }, [reduced, rawX, rawY, x, y])

  if (reduced) return null

  return (
    /* Fading is a CSS transition rather than a Motion `animate`: opacity is
       the one property that composites for free, and it has no reason to
       share the main thread with the position spring that does not. */
    <span ref={ref} className="specular" data-lit={String(lit)} aria-hidden>
      <motion.span className="specular-light" style={{ x, y }} />
    </span>
  )
}
