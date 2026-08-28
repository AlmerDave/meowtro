import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Map as MapLibreMap, addProtocol, prewarm, setWorkerUrl } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Polygon } from 'geojson'
import type { Cat } from '@/data/catsRepo'
import type { Sighting } from '@/data/sightings'
import type { Request } from '@/App'
import { ReportSighting } from '@/ui/ReportSighting'
import {
  buildStyle,
  BGC_BOUNDS,
  BGC_CENTER,
  DEFAULT_PITCH,
  FLAT_PITCH,
  applyMapTheme,
  animateSky,
  SKY_RENDERS_AT_DEFAULT,
  DEFAULT_THEME,
  type Theme,
} from './style'
import { Territories } from './Territories'
import { CatMarkers } from './CatMarkers'
import { MapLabels } from './MapLabels'
import { fetchWeather } from './liveWeather'
import { isFatalMapError } from './mapError'
import { Rain } from './Rain'
import { Storm } from './Storm'
import { MapControls } from './MapControls'
import { RecordCat } from '@/ui/RecordCat'

/* MapLibre 6 does not bundle its worker. With no worker URL the tiles never
   parse, the source never loads, and nothing throws: the map just spins.

   Served from public/, not imported with `?url`, because the worker file is
   not self-contained: it is a real ES module that statically imports a
   ~480KB sibling, maplibre-gl-shared.mjs, which carries the actual bulk of
   MapLibre's code. `?url` only copies the one file named in the import; it
   does not follow that file's own imports, so the worker landed at some
   hashed dist/assets/ URL with its sibling nowhere beside it, and its
   `import './maplibre-gl-shared.mjs'` 404'd the instant a browser tried to
   load it — silently, since that failure happens inside the worker's own
   module graph, not as a MapLibre-reported error. Dev never showed this:
   Vite's dev server serves node_modules with its real directory structure
   intact, so the relative import resolved by accident.

   public/ is a plain static folder Vite does not touch, the same reason
   bgc.pmtiles lives there, so copying both files there together keeps them
   exactly as adjacent as they are in node_modules/maplibre-gl/dist. This
   copy has to be redone by hand (`cp node_modules/maplibre-gl/dist/
   maplibre-gl-{worker,shared}.mjs public/`) whenever maplibre-gl is
   upgraded. */
setWorkerUrl('/maplibre-gl-worker.mjs')

/* Lets a style source say `pmtiles:///bgc.pmtiles`. */
addProtocol('pmtiles', new Protocol().tile)

/* The worker pool is global and dies with the last map. StrictMode mounts,
   unmounts and remounts, so without this the second map waits forever on
   workers the first one took down. */
prewarm()

/** The landing camera's zoom, and also its floor (minZoom below is the
    same number). Exported because MapControls' "whole map" button returns
    here, and a second copy of the number in that file would be one edit
    away from a home view that is not where the app actually starts. */
export const DEFAULT_ZOOM = 14.6

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
  /* True while the record panel is waiting for a click on the map to say
     where a cat's territory goes. Territories reads it to stand down: its
     own click handlers would otherwise select (or deselect) a cat with the
     same click that places the point, and the person would get a plate
     thrown over the map they are trying to aim at. */
  placing: boolean
  setPlacing: (placing: boolean) => void
  /* Seeded from the real sky over BGC (map/liveWeather.ts) and steppable by
     hand from there. Lives beside isFlat and theme rather than in its own
     file, for the same reason isFlat does: one small piece of view state,
     one consumer that sets it (MapControls) and two that read it (Rain,
     Storm), context buys nothing that prop-drilling wouldn't, except not
     having to thread it through a component that has no other reason to
     know about it.

     setWeather is the *person's* setter, not a generic one: calling it
     marks the sky as hand-picked and stops the live reading from landing on
     top of a choice someone just made. Nothing else may set the weather. */
  weather: Weather
  setWeather: (weather: Weather) => void
}

/** Union rather than a boolean, and this is the pass that cashed that in:
    `storm` landed without renaming or re-typing anything, which a boolean
    would have forced everywhere. Overcast is still open and is now cheaper
    still, one more member plus one row in Rain.tsx's table and Storm.tsx's
    veil with no strikes scheduled. */
export type Weather = 'clear' | 'rain' | 'storm'

/** The cycle the control steps through, in the order a sky actually
    deteriorates. Same shape as TOGGLE_THEMES in style.ts and stepped
    through by the same indexOf arithmetic in MapControls, so adding
    overcast is one edit here and none there. */
export const WEATHERS: Weather[] = ['clear', 'rain', 'storm']

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
  /** The territory shapes, from the repo rather than a static import: one
      of them may have been recorded a second ago. */
  territories: FeatureCollection<Polygon>
  /** The whole sightings log, fetched once by App.tsx alongside cats and
      territories and handed down as a plain array. Forwarded to both
      Territories (its "elsewhere" zones and ghost territory) and CatMarkers
      (its pending badge) so neither has to read data/sightings.ts's
      storage directly, which stopped being possible synchronously once
      that file's source of record became Firestore. */
  sightings: Sighting[]
  /** The signed-in visitor's own uid, or null while signed out. Forwarded
      to Territories only: it is the one place here that needs to tell
      "my own unreviewed sighting" apart from everybody else's (see
      isOwnPending in data/sightings.ts). CatMarkers' badge counts every
      pending sighting on a cat regardless of who filed it, so it has no
      ownership-dependent logic to feed. */
  uid: string | null
  /** A cat was recorded. App re-reads the repo. */
  onRecorded: () => void
  /** The scanner identified a cat and the person wants to read about it. */
  onOpenRecord: (id: string) => void
  /** A plate asked to start a sighting for a cat. */
  report: Request | null
  /** Fired once the map has actually painted, for ui/Loading.tsx to hold on.
      Deliberately NOT the same thing as isLoaded: that tracks the `load`
      event, which means the style parsed, and a style can be parsed while
      the viewport is still blank. `idle` is the first moment there is a map
      on screen worth revealing. */
  onReady?: () => void
  /** The basemap could not load at all, so there is no map and there is not
      going to be one. Told to the caller rather than only handled here
      because ui/Loading.tsx is otherwise still counting down its eight
      second ceiling with nothing left to wait for: the app should stop
      holding the curtain up the moment this is known. */
  onFailed?: () => void
  /** The app's own furniture: the control capsule, the sighting flow, and
      the street/park/landmark labels. The landing page (landing/Landing.tsx)
      mounts the same map with the same theme, weather and pitch machinery
      but none of this, because on the front door the reel drives the view
      and there is no person to orient with a street name yet — the point
      of that page is to earn a click through to the one that does. Labels
      travel with this flag rather than getting their own: they cost a real
      per-frame DOM reprojection (MapLabels.tsx) that only pays for itself
      while the map can be panned, and `interactive` below is what the
      landing turns off at the same time. Defaults to true, so every
      existing caller is unchanged. */
  chrome?: boolean
  /** Whether this visitor is holding the admin gate open (App.tsx's
      useAdmin, phase 8's ?role=admin). Two things hang off it: the record
      panel, which has been written and unmounted since phase 6 waiting for
      somebody able to review what it produces, and the review queue itself.
      A boolean rather than a role string, because there are two roles and
      one of them is "everybody". Defaults to false, so the public app is
      what you get by forgetting to pass it. */
  admin?: boolean
  /** Whether the map responds to mouse, touch or keyboard input at all —
      MapLibre's own top-level `interactive` option, so this is one flag
      rather than disabling drag, scroll-zoom, box-zoom and touch
      individually. The app wants all of it; the landing wants none: a map
      a visitor can drag away from BGC invites them to poke at the front
      door instead of clicking through it, and every handler MapLibre
      skips binding is one less thing computing on every frame. Defaults
      to true. */
  interactive?: boolean
  /** Rendered inside the map context, so a child can drive isFlat, theme
      and weather through useMap(). The landing's reel is the only caller;
      the app passes nothing. */
  children?: ReactNode
}

/* Hand-written rather than pulled from mapcn. See the decision log: mapcn's
   wrapper never got past requesting tiles under maplibre-gl 6, and phase 4
   needs the raw imperative instance to drive the camera from a GSAP timeline
   anyway. This is the whole wrapper: a ref, an instance, and a context. */
export function MapCanvas({
  cats,
  territories,
  sightings,
  uid,
  selectedId,
  onSelect,
  hoveredId,
  onHover,
  onReady,
  onFailed,
  onRecorded,
  onOpenRecord,
  report,
  chrome = true,
  interactive = true,
  admin = false,
  children,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [placing, setPlacing] = useState(false)
  // Map lands flat (spec: 3D is opt-in, not the default view).
  const [isFlat, setIsFlat] = useState(true)
  // Lands clear and is corrected a moment later by the live reading below.
  // Clear rather than a spinner-ish "unknown": an empty sky is the honest
  // thing to show while we do not know, and the only one that costs nothing
  // to undo.
  const [weather, setWeatherState] = useState<Weather>('clear')
  // Flipped the first time a person touches the weather button. The live
  // reading arrives one network round-trip after mount, which is easily
  // long enough to click something in, and having it snap back would make
  // the control look broken. First human choice wins for the session.
  const weatherIsChosen = useRef(false)
  const setWeather = useCallback((next: Weather) => {
    weatherIsChosen.current = true
    setWeatherState(next)
  }, [])
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
      interactive,
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

    /* `compact: true` above does not mean "starts collapsed" — MapLibre's
       AttributionControl adds both `maplibregl-compact` and
       `maplibregl-compact-show` on init, so every visitor sees the full
       OSM/Protomaps/cat/weather credit line before ever touching the (i)
       button. There is no constructor option for the collapsed start state.

       It cannot be undone right here, though: onAdd runs before the source
       has any attribution to show, so `_updateCompact()` sees an empty
       control and skips adding the classes entirely (attribution_control.ts)
       — they only appear once the style/source data resolves, on whatever
       later tick that happens to land on. A MutationObserver catches that
       exact moment instead of guessing a delay, undoes it once, and gets out
       of the way — a visitor who taps the (i) button afterwards must still
       be able to open it and have it stay open. */
    const attrib = container.current.querySelector('.maplibregl-ctrl-attrib')
    const attribObserver = new MutationObserver(() => {
      if (attrib?.classList.contains('maplibregl-compact-show')) {
        attrib.classList.remove('maplibregl-compact-show')
        attribObserver.disconnect()
      }
    })
    if (attrib) attribObserver.observe(attrib, { attributes: true, attributeFilter: ['class'] })

    const onLoad = () => setIsLoaded(true)
    instance.on('load', onLoad)

    /* The failure nobody was listening for.

       MapLibre reports a source that will not resolve exactly the way it
       reports a tile that aborted on a pan, so map/mapError.ts is where the
       difference is decided and this is only the plumbing. `painted` is a
       ref rather than state because it is read inside a listener that must
       not be torn down and rebuilt every time it changes: one write, on the
       first idle, and every error after that is noise by definition.

       Note the whole effect stays mounted for the life of the map, so the
       listener is attached before the style has had any chance to resolve.
       Attaching it later, from an effect that waits for `load`, would miss
       the case this exists for entirely: the basemap that never loads never
       fires load, so an effect gated on load never runs. */
    const painted = { current: false }
    const onIdleOnce = () => {
      painted.current = true
    }
    const onError = (event: unknown) => {
      if (isFatalMapError(event as { sourceId?: string }, painted.current)) setFailed(true)
    }
    instance.once('idle', onIdleOnce)
    instance.on('error', onError)

    setMap(instance)

    return () => {
      attribObserver.disconnect()
      instance.off('load', onLoad)
      instance.off('idle', onIdleOnce)
      instance.off('error', onError)
      instance.remove()
      setMap(null)
      setIsLoaded(false)
      setFailed(false)
    }
  }, [])

  /* Told once, and only after the caller has handed us somewhere to tell.
     Separate from the listener above so `onFailed` changing identity does
     not rebuild the map instance. */
  useEffect(() => {
    if (failed) onFailed?.()
  }, [failed, onFailed])

  /* `idle` rather than `load`, and once. MapLibre fires idle every time it
     settles, so the listener is removed after the first one: the loading
     screen only cares about the first paint, and re-firing on every pan
     would keep waking a component that has already gone. */
  useEffect(() => {
    if (!map || !isLoaded || !onReady) return
    map.once('idle', onReady)
    return () => void map.off('idle', onReady)
  }, [map, isLoaded, onReady])

  // The toggle (MapControls) flips document.documentElement's data-theme
  // attribute directly, then calls setTheme — this effect is what turns that
  // state flip into an actual repaint of the basemap. The cat layers
  // (Territories, CatMarkers) re-theme themselves off the same state, since
  // their paint is per-cat expressions this function knows nothing about.
  useEffect(() => {
    if (!map || !isLoaded) return
    applyMapTheme(map, theme)
  }, [map, isLoaded, theme])

  /* The camera follows isFlat.

     This used to live in MapControls' onClick, next to setIsFlat, which
     meant the pitch was a side effect of pressing that particular button
     rather than a consequence of the state. The landing page sets isFlat
     from its reel and mounts no controls, so it flipped the flag and the
     city stayed flat. One effect here, and every caller that sets isFlat
     gets the camera that goes with it.

     No-op on mount: the map is constructed at FLAT_PITCH and isFlat starts
     true, so the first run eases to where it already is. */
  useEffect(() => {
    if (!map) return
    map.easeTo({ pitch: isFlat ? FLAT_PITCH : DEFAULT_PITCH, duration: 500 })
  }, [map, isFlat])

  // Sky is invisible until pitched (buildSky's comment in style.ts), so the
  // breathing animation only runs while isFlat is false — no point paying
  // for a rAF loop the flat/default view never renders.
  //
  // SKY_RENDERS_AT_DEFAULT is the second half of that same argument: with
  // DEFAULT_PITCH back at 55 the sky has no screen area at any camera this
  // app can reach, so the loop would be calling setSky every frame to paint
  // nothing. Derived from the pitch rather than hardcoded, so raising
  // DEFAULT_PITCH past the threshold switches this back on by itself.
  // The actual sky over BGC, once, on mount. Not polled: a second reading
  // would have to either overwrite a hand-picked sky or quietly do nothing,
  // and neither is worth a timer. Failure is silent by design -- the map
  // stays clear, which is where it already was.
  useEffect(() => {
    const abort = new AbortController()
    fetchWeather(abort.signal).then((live) => {
      if (live && !weatherIsChosen.current) setWeatherState(live)
    })
    return () => abort.abort()
  }, [])

  useEffect(() => {
    if (!map || !isLoaded || isFlat || !SKY_RENDERS_AT_DEFAULT) return
    return animateSky(map)
  }, [map, isLoaded, isFlat])

  /* Memoised, not an object literal at the JSX below. A context value that
     is a fresh object every render makes every consumer re-render every
     time THIS component does, whatever the value actually says, and this
     component re-renders on props it does not pass through the context at
     all: `hoveredId` changes on entering and leaving a territory, and
     `cats`/`selectedId` change on every selection. Territories, CatMarkers,
     MapLabels, Rain, Storm, MapControls and ReportSighting all call
     useMap(), so moving the pointer over a territory was re-rendering the
     whole map tree, including CatMarkers' twelve portals and its
     pendingByCat() pass over the sightings prop.

     setIsFlat/setTheme/setPlacing are React's own setters and setWeather is
     a useCallback, so every dependency here is either state or already
     stable: the value's identity now changes exactly when one of the ten
     things in it does. */
  const context = useMemo(
    () => ({
      map,
      isLoaded,
      isFlat,
      setIsFlat,
      theme,
      setTheme,
      placing,
      setPlacing,
      weather,
      setWeather,
    }),
    /* The three bare setters are React's own and stable by contract, and
       setWeather is a useCallback with no deps; they are listed anyway
       rather than relied on implicitly, so this array is a complete
       statement of the value's contents and nobody has to remember which
       entries were left out on purpose. */
    [map, isLoaded, isFlat, setIsFlat, theme, setTheme, placing, setPlacing, weather, setWeather]
  )

  return (
    <div className="map" ref={container}>
      <MapContext.Provider value={context}>
        {map && (
          <>
            <Territories
              cats={cats}
              territories={territories}
              sightings={sightings}
              uid={uid}
              selectedId={selectedId}
              onSelect={onSelect}
              hoveredId={hoveredId}
              onHover={onHover}
            />
            <CatMarkers
              cats={cats}
              territories={territories}
              sightings={sightings}
              selectedId={selectedId}
              onSelect={onSelect}
              hoveredId={hoveredId}
              onHover={onHover}
              uid={uid}
              admin={admin}
            />
            {/* Before <MapLabels> on purpose: the storm's veil shares the
                labels' z-index rung, so this order is what keeps the
                labels painting over it and out of the gloom. It is an AA
                constraint and the reasoning is written out in full in
                shell.css. The lightning half of this component sits a rung
                higher and is unaffected by where it mounts. */}
            <Storm />
            {chrome && <MapLabels />}
            {/* Above the map and labels, below every UI panel: see the
                z-index ladder note on .loading in shell.css, kept in step
                with this. Rendered unconditionally, like Storm: it decides
                for itself whether there is anything to draw. */}
            <Rain />
            {chrome && <MapControls onSelect={onSelect} />}
            {/* The visitor's one contribution, and as of phase 8 a proposal
                rather than an edit: it lands `pending` and moves nothing
                until an admin approves it. The admin's counterpart,
                ui/RecordCat.tsx, is mounted above behind `admin` now that
                there is somebody to do the reviewing. */}
            {/* The basemap is gone and the app is still usable: the rail
                still lists cats, a plate still opens, the panel just says
                what happened and offers the one thing that can fix it.
                Deliberately a card and not a full-screen overlay, and with
                no backdrop, so everything behind it stays reachable.

                Not rendered on the landing (`chrome`), by design. That page
                is a wordmark, a guide card and one button, all of which
                read perfectly well over blank paper, and an error card is a
                worse first impression than a plain background. */}
            {chrome && failed && (
              <div className="map-dead" role="alert">
                <p className="map-dead-title">The map did not load</p>
                <p className="map-dead-note">
                  Bonifacio Global City is drawn from a single map file served with this page. It
                  did not arrive, so there is nothing to draw. The cats are all still here.
                </p>
                <button type="button" className="map-dead-go" onClick={() => location.reload()}>
                  Try again
                </button>
              </div>
            )}

            {/* RecordCat is back on screen behind the role check, same as
                since phase 6. ui/ReviewQueue.tsx is not: phase 9 replaced
                its list-panel review with reviewing straight off the map
                (the pulsing pin badge above, the ghost territory below, and
                the plate's own "Pending review" section) at the admin's own
                request that the corner panel was "too crowded and
                unnecessary". The file itself is left alone, unimported,
                same as plate/CatFigure.tsx after the 3D view came out
                (Plate.tsx's own header explains that precedent) — nothing
                here says its list-plus-audit-trail view can never come
                back, only that nothing currently mounts it.

                Once briefly carried a second "you are admin" tell, a small
                badge beside the record button — replaced with the banner
                across the top of the app (App.tsx, shell.css's own note on
                it) once that existed, since two indicators for one fact is
                the kind of duplication this app argues against everywhere
                else, and the corner one was the one that had gone unnoticed
                to begin with.

                Wrapped rather than owning its own fixed position: the first
                version put the trigger at a hand-picked corner (top-left)
                without noticing the rail already lives there at full
                height, so it rendered directly underneath it and was,
                correctly, reported as "hidden": DOM order put Rail after
                MapCanvas, so Rail painted over it. .admin-controls (shell.
                css) fixes the position once, beside the map-controls
                capsule, a corner nothing else claims — kept as a wrapper
                rather than unwound to a single positioned button because a
                second admin tool is likely to want the same shelf again. */}
            {chrome && admin && (
              <div className="admin-controls">
                <RecordCat onRecorded={onRecorded} />
              </div>
            )}

            {chrome && (
              <ReportSighting
                cats={cats}
                territories={territories}
                onReported={onRecorded}
                onOpenRecord={onOpenRecord}
                report={report}
              />
            )}
            {children}
          </>
        )}
      </MapContext.Provider>
    </div>
  )
}
