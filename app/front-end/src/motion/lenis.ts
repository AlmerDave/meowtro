import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/* Smooth scroll, spec §8.2. Lenis and GSAP's ScrollTrigger both want to own
   the RAF loop; running both independently desyncs scroll position from
   ScrollTrigger's idea of it (jitter that looks like a perf problem and is
   not). Fix: Lenis never starts its own loop, GSAP's ticker drives it, and
   every Lenis scroll tick pings ScrollTrigger directly rather than waiting
   on its own rAF-polled scroll listener — the standard Lenis+ScrollTrigger
   wiring, kept ready for the next ScrollTrigger. There is none right now:
   the scroll-driven camera was reverted in phase 4 and the page has no
   scrollable content, so this instance is wired but inert.

   Disabled entirely under reduced motion, per spec — native scroll returns
   untouched rather than being smoothed. */
export function useLenis() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({ autoRaf: false })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    // The canonical Lenis+GSAP pairing: without this, GSAP clamps its own
    // delta after any frame over 500ms (a backgrounded tab, a long task),
    // handing Lenis a smoothed clock and producing a visible scroll hiccup —
    // the "looks like a perf problem and isn't" class of bug spec §8.2 is
    // about.
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
    }
  }, [])
}
