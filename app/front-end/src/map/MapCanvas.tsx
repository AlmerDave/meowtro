import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, addProtocol, prewarm, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Cat } from '@/data/catsRepo'
import {
  buildStyle,
  BGC_BOUNDS,
  BGC_CENTER,
  FLAT_PITCH,
  applyMapTheme,
  animateSky,
  DEFAULT_THEME,
  type Theme,
} from './style'
import { Territories } from './Territories'
import { CatMarkers } from './CatMarkers'
import { MapLabels } from './MapLabels'
import { Clouds } from './Clouds'
import { MapControls } from './MapControls'

/* MapLibre 6 does not bundle its worker. With no worker URL the tiles never
   parse, the source never loads, and nothing throws: the map just spins.
   Vite emits the worker out of node_modules as a local asset, so the basemap
   stays one static file with no CDN in front of it. */
setWorkerUrl(workerUrl)

/* Lets a style source say `pmtiles:///bgc.pmtiles`. */
addProtocol('pmtiles', new Protocol().tile)

/* The worker pool is global and dies with the last map. StrictMode mounts,
   unmounts and remounts, so without this the second map waits forever on
   workers the first one took down. */
prewarm()

const DEFAULT_ZOOM = 14.6

type MapContextValue = {
  map: MapLibreMap | null
  isLoaded: boolean
  // Lifted out of MapControls so CatMarkers can also read which
  // representation (DOM pin vs. native ground-plane dot) to render.
  isFlat: boolean
  setIsFlat: (isFlat: boolean) => void
  // Context rather than props for the same reason as isFlat: three children
  // need it (Territories, CatMarkers, MapControls) and only one sets it, so
  // prop-drilling it through MapCanvas' own signature buys nothing.
  //
  // This is deliberately NOT the source of truth for the theme — :root's
  // data-theme attribute is (tokens.css). Every CSS surface repaints off
  // that attribute for free; this state exists only to give the components
  // that own *canvas* paint (which CSS cannot reach) something to re-run on.
  theme: Theme
  setTheme: (theme: Theme) => void
}

const MapContext = createContext<MapContextValue | null>(null)

/** The map instance, for layer components rendered inside <MapCanvas>. */
export function useMap() {
  const context = useContext(MapContext)
  if (!context) throw new Error('useMap must be used inside <MapCanvas>')
  return context
}

type Props = {
  cats: Cat[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}

/* Hand-written rather than pulled from mapcn. See the decision log: mapcn's
   wrapper never got past requesting tiles under maplibre-gl 6, and phase 4
   needs the raw imperative instance to drive the camera from a GSAP timeline
   anyway. This is the whole wrapper: a ref, an instance, and a context. */
export function MapCanvas({ cats, selectedId, onSelect, hoveredId, onHover }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  // Map lands flat (spec: 3D is opt-in, not the default view).
  const [isFlat, setIsFlat] = useState(true)
  // Seeded from the attribute rather than hardcoded, so anything that sets
  // data-theme before React mounts (index.html's own `data-theme="light"`,
  // a hand-set "paper", a future persisted preference) is picked up instead
  // of overwritten. DEFAULT_THEME is only the fallback for a page that
  // somehow carries no attribute at all.
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? DEFAULT_THEME
  )

  useEffect(() => {
    if (!container.current) return

    const instance = new MapLibreMap({
      container: container.current,
      // buildStyle reads the tokens off :root, so it runs here, in the browser.
      style: buildStyle(),
      center: BGC_CENTER,
      zoom: DEFAULT_ZOOM,
      // Equal to the default zoom: the extract was sized (see style.ts's
      // BGC_BOUNDS comment) to comfortably fill a realistic viewport at
      // z14.6, not below it. Zooming out further shrinks the bounds
      // rectangle below the viewport, and MapLibre letterboxes it with flat
      // --paper on every side (the "extra cream at the edges" bug, not a
      // rendering error). Locking minZoom to the default sidesteps it
      // instead of chasing a per-viewport-width threshold.
      minZoom: DEFAULT_ZOOM,
      maxZoom: 17,
      maxBounds: BGC_BOUNDS,
      // EXPERIMENTAL — spike for the "tilted + extruded" mockup.
      // Starts flat: 3D is an opt-in reached through MapControls' button,
      // not the landing state. Every gesture that could pitch/rotate the
      // camera is disabled below — orientation only ever changes from a
      // button press, never a drag.
      pitch: FLAT_PITCH,
      // Must clear DEFAULT_PITCH (style.ts) — MapLibre clamps easeTo's pitch
      // to this ceiling, so a cap below the toggle's target silently pins
      // the camera short of it.
      maxPitch: 76,
      dragRotate: false,
      touchPitch: false,
      // Selecting cats is click-to-toggle (Territories.tsx) — two quick
      // clicks on different territories is normal use here, not a request
      // to zoom. MapLibre's default double-click-zoom otherwise fires on
      // exactly that pattern.
      doubleClickZoom: false,
      attributionControl: { compact: true },
    })
    instance.touchZoomRotate.disableRotation()
    instance.keyboard.disableRotation()

    const onLoad = () => setIsLoaded(true)
    instance.on('load', onLoad)
    setMap(instance)

    return () => {
      instance.off('load', onLoad)
      instance.remove()
      setMap(null)
      setIsLoaded(false)
    }
  }, [])

  // The toggle (MapControls) flips document.documentElement's data-theme
  // attribute directly, then calls setTheme — this effect is what turns that
  // state flip into an actual repaint of the basemap. The cat layers
  // (Territories, CatMarkers) re-theme themselves off the same state, since
  // their paint is per-cat expressions this function knows nothing about.
  useEffect(() => {
    if (!map || !isLoaded) return
    applyMapTheme(map)
  }, [map, isLoaded, theme])

  // Sky is invisible until pitched (buildSky's comment in style.ts), so the
  // breathing animation only runs while isFlat is false — no point paying
  // for a rAF loop the flat/default view never renders.
  useEffect(() => {
    if (!map || !isLoaded || isFlat) return
    return animateSky(map)
  }, [map, isLoaded, isFlat])

  return (
    <div className="map" ref={container}>
      <MapContext.Provider value={{ map, isLoaded, isFlat, setIsFlat, theme, setTheme }}>
        {map && (
          <>
            <Territories
              cats={cats}
              selectedId={selectedId}
              onSelect={onSelect}
              hoveredId={hoveredId}
              onHover={onHover}
            />
            <CatMarkers
              cats={cats}
              selectedId={selectedId}
              onSelect={onSelect}
              hoveredId={hoveredId}
              onHover={onHover}
            />
            <MapLabels />
            <Clouds />
            <MapControls />
          </>
        )}
      </MapContext.Provider>
    </div>
  )
}
