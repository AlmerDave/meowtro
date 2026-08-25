import { useEffect, useState } from 'react'
import { useMap, type Weather } from '@/map/MapCanvas'
import type { Theme } from '@/map/style'

/* The reel: the front door demonstrating the map instead of describing it.

   This is deliberately NOT a slideshow of screenshots. Every beat sets the
   same three pieces of state a person sets by hand inside the app —
   `theme`, `isFlat`, `weather` — through the same context setters
   MapControls uses. So the landing page cannot show the visitor a look the
   app does not actually have, and nothing here has to be kept in step with
   the map's styling: change a token and the reel changes with it.

   That is also why this component lives *inside* <MapCanvas>. It needs
   useMap(), and MapCanvas takes children for exactly this one caller. */

type Beat = {
  theme: Theme
  isFlat: boolean
  weather: Weather
  /** Shown next to the ticks. Names the state, not the marketing. */
  label: string
}

/* Ordered so consecutive beats change ONE thing wherever possible: the
   camera tilts, then the sky goes dark, then it starts raining. The only
   hard cut is the wrap back to flat day, which reads as the reel starting
   over rather than as a beat that failed to land. */
const BEATS: Beat[] = [
  { theme: 'light', isFlat: false, weather: 'clear', label: '3D · day' },
  { theme: 'dark', isFlat: false, weather: 'clear', label: '3D · night' },
  { theme: 'dark', isFlat: false, weather: 'rain', label: '3D · night · rain' },
  { theme: 'light', isFlat: true, weather: 'clear', label: 'Flat · day' },
]

/* 3s per beat, user direction 2026-08-25 (2s, then 5s, then 3s).

   Worth knowing what it costs, because the transitions underneath are not
   instant: MapCanvas eases pitch over 500ms, the storm veil crossfades over
   --dur-plate (700ms), and the theme repaints across the whole HUD. At 3s a
   beat the map is settled for a little over two seconds before the next
   change starts — comfortably past those durations, with room left to read
   the label before it swaps. */
const BEAT_MS = 3000

export function Reel() {
  const { setTheme, setIsFlat, setWeather } = useMap()

  /* Start on the beat that matches the sky, not on beat 0.

     The head script (head.html) reads the hour in Taguig and paints the
     page dark at night before anything else resolves, which is the entire
     reason it is inline and synchronous. This component then wrote beat 0's
     `light` on mount and threw that away one frame later, so a visitor
     arriving at midnight watched the front door flip to daytime
     immediately: the exact flash the script exists to prevent, caused by
     the page's own demo.

     Reading the attribute rather than recomputing the hour keeps one
     source for that decision. Falls through to 0 for `paper` or anything
     unexpected, which is beat 0's light and is what used to happen
     regardless. */
  const [index, setIndex] = useState(() =>
    document.documentElement.dataset.theme === 'dark'
      ? BEATS.findIndex((b) => b.theme === 'dark')
      : 0
  )

  /* Never starts under reduced motion. This is the one condition that stops
     the reel outright, and it is a preference rather than an interaction. */
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  /* The beat is applied whenever the index changes, including on mount, so
     a reduced-motion visitor still gets the starting beat's look rather
     than whatever the map happened to boot with, and, since that starting
     beat now follows the clock, the right one for the time of day. */
  useEffect(() => {
    const beat = BEATS[index]
    document.documentElement.dataset.theme = beat.theme
    setTheme(beat.theme)
    setIsFlat(beat.isFlat)
    setWeather(beat.weather)
  }, [index, setTheme, setIsFlat, setWeather])

  /* No pause-while-held. There used to be one, tied to a window-level
     pointerdown/pointerup pair, on the theory that the reel should not
     tilt the city out from under someone dragging it. The map has been
     `interactive={false}` since — nothing on this page can be dragged —
     so that listener no longer had anything to protect, and it had a real
     cost: pointerdown fires on ANY click anywhere in the window (a roster
     chip, a nav link, a tick), so every incidental click was resetting the
     3s countdown, giving the reel a cadence that drifted rather than the
     steady one it is supposed to have. Removed rather than fixed, because
     there is no longer a reason for it to exist. */
  useEffect(() => {
    if (reduced) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % BEATS.length), BEAT_MS)
    return () => window.clearInterval(id)
  }, [reduced])

  const beat = BEATS[index]

  /* No pause button, user direction 2026-08-25. On WCAG 2.2.2: a
     reduced-motion preference stops the reel entirely and is the mechanism
     this relies on. The ticks below jump to a beat but deliberately do NOT
     stop the reel, because a control that can stop something with no
     control to start it again is the bug this file just had. If this ever
     needs a real pause, put the button back rather than making a tick
     stop it. */
  return (
    <div className="reel-bar">
      <div className="reel-ticks">
        {BEATS.map((b, i) => (
          <button
            key={b.label}
            type="button"
            className={`reel-tick${i === index ? ' on' : ''}`}
            aria-label={`Show ${b.label}`}
            aria-current={i === index}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      {/* aria-live so a screen reader hears the map changed without having
          to poll the ticks. Polite: it is ambient, never urgent. */}
      <span className="reel-label" aria-live="polite">
        {beat.label}
      </span>
    </div>
  )
}
