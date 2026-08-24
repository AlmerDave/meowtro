import { BGC_CENTER } from './style'

/* The one place the sky stops being a switch and starts being a reading.

   Open-Meteo rather than OpenWeather or WeatherAPI: no key, no signup, no
   proxy to hide a key behind, and CORS is open, so this is a fetch from the
   browser and nothing else. A keyed provider would have meant a backend the
   spec does not have yet.

   BGC_CENTER (style.ts) rather than a second pair of literals: the reading
   should be for whatever patch of ground the map is actually looking at, so
   if the extract ever moves, the forecast follows it. */
const [lon, lat] = BGC_CENTER

const ENDPOINT =
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
  `&current=weather_code&timezone=Asia%2FManila`

/** WMO weather code -> the three skies we can actually paint.

    The union is coarser than WMO is, deliberately (MapCanvas.tsx's note on
    the Weather type): the map has one rain effect and one storm effect, so
    every code has to land on clear, rain, or storm.

    Thunderstorm (95/96/99) is a storm by any reading. Heavy rain (65),
    heavy freezing rain (67) and violent showers (82) join it because that
    is what the ask called stormy -- BGC under a habagat downpour is Storm's
    look, not Rain's, even with no lightning in the code. Everything from
    drizzle (51) up through snow showers (86) is rain; the snow codes will
    never fire over Manila, but mapping them costs one comparison and
    beats a hole in the range.

    Returns the union members literally rather than importing Weather from
    MapCanvas.tsx: that import would drag the whole map component graph into
    this file for a three-word type, and it costs no safety -- MapCanvas
    feeds the result straight into setWeather, so the compiler checks the
    two agree there. It also keeps this module free of anything browser-only,
    which is what lets liveWeather.check.ts run on plain node. */
export function toWeather(code: number): 'clear' | 'rain' | 'storm' {
  if (code >= 95 || code === 65 || code === 67 || code === 82) return 'storm'
  if (code >= 51 && code <= 86) return 'rain'
  return 'clear'
}

/** The current sky over BGC, or null if we could not tell.

    Null rather than a thrown error or a 'clear' fallback baked in here: the
    caller already has a default it landed on, and "the network is down"
    should leave that default alone rather than assert fair weather. */
export async function fetchWeather(signal?: AbortSignal) {
  try {
    const response = await fetch(ENDPOINT, { signal })
    if (!response.ok) return null
    const code = (await response.json())?.current?.weather_code
    return typeof code === 'number' ? toWeather(code) : null
  } catch {
    // Includes the abort on unmount, which is not a failure worth logging.
    return null
  }
}
