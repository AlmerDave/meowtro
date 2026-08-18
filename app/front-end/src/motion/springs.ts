/* Motion presets. Springs, not durations: a duration says "take 320ms
   no matter what", a spring says "settle from wherever you are", which is the
   only reason an interrupted animation (click row A, change your mind, click
   row B mid-flight) looks deliberate instead of broken.

   Two of them, deliberately. Anything reaching for a third value should be
   asking whether it is a UI response or a shared-element morph first. */

/** UI response: taps, hovers, the sliding active marker, the segmented pill.
    Stiff and nearly critically damped — it arrives fast and does not wobble. */
export const spring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } as const

/** Shared-element morph and panel enter/exit. Softer and heavier: the photo
    travelling 900px across the screen needs to read as mass moving, not as a
    snap. Any faster and the eye loses it mid-flight, which defeats the whole
    point of moving it at all. */
export const springSoft = { type: 'spring', stiffness: 260, damping: 32, mass: 1 } as const
