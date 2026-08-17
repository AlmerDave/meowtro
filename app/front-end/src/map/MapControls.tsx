import { Moon, Sun } from 'lucide-react'
import { useMap } from './MapCanvas'
import { DEFAULT_PITCH, FLAT_PITCH, TOGGLE_THEMES } from './style'

/* Two independent controls: theme and camera. Styled to the token system
   instead of MapLibre's default white/shadowed buttons.

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

export function MapControls() {
  const { map, isFlat, setIsFlat, theme, setTheme } = useMap()

  if (!map) return null

  // indexOf returns -1 for a theme that's off the cycle (paper, set by
  // hand), and -1 + 1 = 0 lands on the first toggle theme — so the button
  // still does something sensible from there instead of going nowhere.
  const nextTheme = TOGGLE_THEMES[(TOGGLE_THEMES.indexOf(theme) + 1) % TOGGLE_THEMES.length]
  const Icon = THEME_ICON[theme] ?? Moon

  return (
    <div className="map-controls">
      <button
        type="button"
        className="map-control"
        aria-label={`Switch to ${THEME_LABEL[nextTheme]} theme`}
        onClick={() => {
          // The attribute is the source of truth (tokens.css); setTheme only
          // exists so the canvas layers get a React dependency to re-run on.
          document.documentElement.dataset.theme = nextTheme
          setTheme(nextTheme)
        }}
      >
        <Icon size={16} />
      </button>
      <button
        type="button"
        className="map-control map-control-text"
        aria-label={isFlat ? 'Switch to 3D view' : 'Switch to flat view'}
        onClick={() => {
          const next = !isFlat
          setIsFlat(next)
          map.easeTo({ pitch: next ? FLAT_PITCH : DEFAULT_PITCH, duration: 500 })
        }}
      >
        {isFlat ? '3D' : '2D'}
      </button>
    </div>
  )
}
