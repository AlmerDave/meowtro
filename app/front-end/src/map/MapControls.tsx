import { AnimatePresence, motion } from 'motion/react'
import { CloudLightning, CloudRain, CloudSun, Maximize, Moon, Sun } from 'lucide-react'
import { spring } from '@/motion/springs'
import { DEFAULT_ZOOM, useMap, WEATHERS, type Weather } from './MapCanvas'
import { BGC_CENTER, DEFAULT_PITCH, FLAT_PITCH, TOGGLE_THEMES } from './style'

/* Four independent controls: theme, weather, orientation, and a way back
   out to the whole map. Styled to the token system instead of MapLibre's
   default white/shadowed buttons.

   Weather is now a real reading (map/liveWeather.ts): the map lands on
   whatever is actually falling on BGC, and this button steps off that
   reading rather than out of nowhere. Clicking it is an override, and the
   override sticks -- MapCanvas stops applying the live sky the moment
   someone picks one. It lives in this capsule rather than getting a button
   of its own because it answers the same question the other two do -- what
   does the world look like right now -- and the capsule's whole job is
   being the one place that question gets asked.

   The 3D toggle is EXPERIMENTAL — a mockup control for the tilted-camera
   spike. It is also the only orientation control: every drag/touch/keyboard
   gesture that could pitch or rotate the camera is disabled in
   MapCanvas.tsx, so this button is the sole way in or out of the 3D view.
   Bearing never changes at all (no rotate gesture survives), so there is
   nothing for a compass to reset — a compass control was cut for exactly
   that reason.

   Both isFlat and theme live in MapContext rather than local state here:
   CatMarkers reads isFlat (to swap between the flat-mode DOM pin and the
   pitched-mode ground-plane dot), and Territories/CatMarkers/MapCanvas all
   read theme (to repaint canvas layers CSS can't reach). */

/* Day and night, TOGGLE_THEMES (style.ts). The paper theme is still fully
   built — it is just not on this button; see TOGGLE_THEMES' comment.
   Written as "step through the list" rather than a boolean flip so that
   putting paper back is a one-word edit there and nothing here. */
const THEME_ICON: Record<string, typeof Sun> = { paper: Sun, light: Moon, dark: Sun }
const THEME_LABEL: Record<string, string> = { paper: 'paper', light: 'light', dark: 'dark' }

/* Weather, WEATHERS (MapCanvas.tsx). The button became a cycle rather than
   a flip when storm landed, borrowing the theme button's arithmetic above
   wholesale. Record<Weather, ...> rather than Record<string, ...>: unlike
   the theme maps, which have to tolerate paper being off the cycle, every
   weather is on this one, so the compiler should refuse a new member that
   arrives without a glyph and a name. */
const WEATHER_ICON: Record<Weather, typeof Sun> = {
  clear: CloudSun,
  rain: CloudRain,
  storm: CloudLightning,
}
const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'Clear skies',
  rain: 'Rain',
  storm: 'Storm',
}

type Props = {
  /* Only to clear it. The capsule has no idea which cat is selected and
     does not want one: passing selectedId in would make this component
     re-render on every selection to render exactly the same three buttons. */
  onSelect: (id: string | null) => void
}

export function MapControls({ onSelect }: Props) {
  const { map, isFlat, setIsFlat, theme, setTheme, weather, setWeather } = useMap()

  if (!map) return null

  // indexOf returns -1 for a theme that's off the cycle (paper, set by
  // hand), and -1 + 1 = 0 lands on the first toggle theme — so the button
  // still does something sensible from there instead of going nowhere.
  const nextTheme = TOGGLE_THEMES[(TOGGLE_THEMES.indexOf(theme) + 1) % TOGGLE_THEMES.length]
  const Icon = THEME_ICON[theme] ?? Moon

  const nextWeather = WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length]
  const WeatherIcon = WEATHER_ICON[weather]

  /* One capsule with hairlines between the buttons, rather than detached
     squares. They are one cluster of view settings and were reading as
     unrelated buttons that happened to be stacked; grouping them is also
     what lets the material be paid for once instead of once per button,
     which matters when the material is a backdrop blur.

     data-tip is picked up by a CSS-only label that slides out on hover (see
     shell.css). Not a real tooltip component: these never move, never need
     a delay, and never need to escape a clipping ancestor, the three
     problems a tooltip library exists to solve. aria-label still carries the
     same words, so the label is decoration over an already-named button.

     The capsule also arrives with the rail and the plate rather than simply
     being there once the map loads. It was the one piece of chrome that
     popped in, which on a screen where everything else settles reads as
     having been forgotten. It rises from below, the edge it lives on. */
  return (
    <motion.div
      className="map-controls"
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: 0.15 }}
    >
      <motion.button
        type="button"
        className="map-control"
        data-tip={`${THEME_LABEL[nextTheme]} theme`}
        aria-label={`Switch to ${THEME_LABEL[nextTheme]} theme`}
        whileTap={{ scale: 0.92 }}
        transition={spring}
        onClick={() => {
          // The attribute is the source of truth (tokens.css); setTheme only
          // exists so the canvas layers get a React dependency to re-run on.
          document.documentElement.dataset.theme = nextTheme
          setTheme(nextTheme)
        }}
      >
        {/* The glyph swaps on a quarter turn rather than cutting. Keyed on
            the theme, so the outgoing sun and the incoming moon are two
            elements crossing, which is the movement the button is
            describing: one light source setting as another rises. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={theme}
            className="map-control-glyph"
            initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
            transition={spring}
          >
            <Icon size={16} />
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <span className="map-control-rule" aria-hidden />

      <motion.button
        type="button"
        className="map-control map-control-text"
        data-tip={isFlat ? '3D view' : 'Flat view'}
        aria-label={isFlat ? 'Switch to 3D view' : 'Switch to flat view'}
        whileTap={{ scale: 0.92 }}
        transition={spring}
        onClick={() => {
          const next = !isFlat
          setIsFlat(next)
          map.easeTo({ pitch: next ? FLAT_PITCH : DEFAULT_PITCH, duration: 500 })
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={String(isFlat)}
            className="map-control-glyph"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring}
          >
            {isFlat ? '3D' : '2D'}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <span className="map-control-rule" aria-hidden />

      <motion.button
        type="button"
        className="map-control"
        // Names the state the button moves TO, matching the theme button
        // beside it. A cycle has no "off", so "turn on rain" stopped being
        // true the moment there were three of these.
        data-tip={WEATHER_LABEL[nextWeather]}
        aria-label={`Change the weather to ${WEATHER_LABEL[nextWeather].toLowerCase()}`}
        whileTap={{ scale: 0.92 }}
        transition={spring}
        onClick={() => setWeather(nextWeather)}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={weather}
            className="map-control-glyph"
            initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
            transition={spring}
          >
            <WeatherIcon size={16} />
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <span className="map-control-rule" aria-hidden />

      <motion.button
        type="button"
        className="map-control"
        data-tip="Whole map"
        aria-label="Show the whole map"
        whileTap={{ scale: 0.92 }}
        transition={spring}
        onClick={() => {
          /* Clears the selection as well as moving the camera. "The whole
             map" is not only a viewport: with a cat selected, Territories
             dims every territory that is not it and the plate covers a
             third of the screen, so pulling the camera back from that would
             show the district greyed out under a card, which is not what
             the button says it does.

             Before the camera call, so the plate's exit and the pull-back
             run together rather than one after the other. There is no
             conflict between the two moves: Territories' own camera effect
             returns early when nothing is selected, so it has nothing to
             say here. */
          onSelect(null)
          map.easeTo({
            center: BGC_CENTER,
            zoom: DEFAULT_ZOOM,
            /* Pitch is deliberately left alone. The 2D/3D button owns
               orientation, and flattening someone's 3D view because they
               asked to see more of the map is a second decision they did
               not make. */
            duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700,
          })
        }}
      >
        {/* No AnimatePresence here, unlike its two neighbours: this glyph
            never changes, because the button is an action rather than a
            toggle and has no second state to cross to. */}
        <Maximize size={16} />
      </motion.button>
    </motion.div>
  )
}
