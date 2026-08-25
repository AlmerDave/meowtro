import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { Grain } from '@/Grain'
import { MapCanvas } from '@/map/MapCanvas'
import { Plate } from '@/plate/Plate'
import { useLenis } from '@/motion/lenis'
import { springSoft } from '@/motion/springs'
import { Rail } from '@/ui/Rail'
import { CatDeck } from '@/ui/CatDeck'
import { Loading } from '@/ui/Loading'
import { listCats, listTerritories, type Cat } from '@/data/catsRepo'
import type { FeatureCollection, Polygon } from 'geojson'

/* 900px, rev 6 §4: the rail is 15rem and the plate 26.25rem, so with gutters
   the two collide somewhere just above 700px. 900 leaves margin rather than
   switching at the exact width where it breaks.

   Width alone, deliberately. `(pointer: coarse)` was added here and then
   taken back out: it does describe the input better, but it also overrode
   Chrome's "Desktop site" on a phone, which is a mode someone turns on
   precisely because they want the wide layout. Honouring the input device
   over an explicit request for the desktop layout is second-guessing the
   person using it, and the wide layout at that width is a real layout the
   app supports, not a mistake to be corrected.

   The practical consequence is worth knowing: Desktop site reports a ~980px
   layout viewport scaled down to the physical screen, so the desktop rail
   arrives correct but small. That is what the mode does to every site.

   Subscribed rather than read once, so rotating a tablet moves between the
   two presentations instead of stranding it in whichever one it loaded in. */
const MOBILE_QUERY = '(max-width: 900px)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

/* The selected cat lives in the address bar, so a cat can be linked to.

   Three things fall out of one small hook, which is why it is worth having
   at all: a reload keeps the plate you had open, the browser's Back button
   closes a cat instead of leaving the app (the behaviour that matters most
   on a phone, where Back is a system gesture), and the address is a link
   you can send someone.

   No router. This app has one page and one piece of navigable state; a
   router would bring a matcher, a link component and an outlet for a
   question that is answered by two native calls. `history.pushState` and
   the `popstate` event ARE the browser feature for this.

   ?cat= rather than #cat, deliberately. A hash is an in-page anchor by
   definition, and browsers act on one: a hash that happens to match an
   element id scrolls the document to it. A query is metadata about which
   page you asked for, which is what this is, and it needs no server config
   to work on static hosting because the query never reaches the router
   there is none of. */
/* The admin gate, phase 8. A stand-in for auth, and honest about it.

   ?role=admin, matching the ?cat= convention directly above for the same
   reason: a query is metadata about which page you asked for, and it needs
   no server config on static hosting. It is not a credential and does not
   pretend to be one. Anybody who reads this file knows the password, which
   is fine while the only thing behind the gate is a panel that writes to
   the reader's own localStorage. Phase 10 replaces this function and
   nothing else has to change, because everything downstream takes a
   boolean.

   Read once and held for the session, unlike ?cat= which is consumed and
   cleared. Clearing this one would log an admin out on their own refresh,
   and here the URL IS the credential: taking it out of the address bar
   would take the role with it. */
function useAdmin(): boolean {
  const [admin] = useState(
    () => new URLSearchParams(window.location.search).get('role') === 'admin'
  )
  return admin
}

function useUrlSelection() {
  /* The ?cat= this page was opened with, read once. A ref because it is a
     starting condition that gets consumed, not a source of truth: once the
     app is running, state owns the selection and the effect below owns the
     URL. App clears it when it applies or discards the link. */
  /* `|| null` is not tidiness. URLSearchParams.get returns '' for a
     present-but-empty parameter (?cat= or a bare ?cat), and an empty string
     is falsy enough for App to skip applying it but not null enough to
     release the guard below, which would leave the address bar frozen for
     the rest of the session. Same normalisation on the popstate read: ''
     as a selected id matches no cat, and Territories dims every territory
     that is not the selected one, so it would empty the map. */
  const linked = useRef(new URLSearchParams(window.location.search).get('cat') || null)

  /* Starts null even when the URL names a cat. Applying it here would set a
     selection while the loading curtain is still up and the rail, deck and
     plate are all unmounted, and the map camera would then frame that cat
     against a screen with no panels on it (map/Territories.tsx, the
     visibleOffset note). App applies the link at the reveal instead, once
     there is a real layout to frame against. */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Back and forward, which are the browser moving through selections we
  // pushed. The URL is the record; this just reads it back.
  useEffect(() => {
    const onPop = () =>
      setSelectedId(new URLSearchParams(window.location.search).get('cat') || null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /* Selection out to the URL. The equality check is the whole trick: a
     popstate sets state from the URL, which runs this, which would push the
     URL it just read and undo the Back the user pressed, one entry at a
     time, forever. Comparing first makes the two directions idempotent, and
     costs one string compare.

     Built through URLSearchParams rather than by concatenating, so a link
     that arrived with anything else on it (a utm tag, whatever a share
     sheet adds) keeps it, and so the id is escaped rather than trusted. */
  useEffect(() => {
    /* Nothing is written while a link is still waiting to be applied. State
       starts null by design (see above), so on a page opened with ?cat=tala
       this effect would otherwise compute a cat-less URL and push it,
       wiping the link out of the address bar before App has had a chance to
       read it at the reveal.

       A condition, not a skip-the-first-run counter, and that distinction
       is load-bearing here: StrictMode (main.tsx) mounts every component
       twice in development, refs survive that, and a counter would burn its
       one skip on the first pass and let the second pass do exactly the
       damage it was written to prevent. This guard is idempotent, so it
       does not care how many times it runs.

       It needs no dependency entry either. Clearing the ref is always
       accompanied by the setSelectedId that re-runs this effect, and by
       then the URL already says what state says, so the equality check
       below returns without pushing. */
    if (linked.current !== null) return

    const params = new URLSearchParams(window.location.search)
    if (selectedId) params.set('cat', selectedId)
    else params.delete('cat')
    const search = params.toString()
    const next = search ? `?${search}` : ''
    if (next === window.location.search) return
    /* push, not replace, including on close: the history is then a trail of
       the cats you looked at, and Back walks back through them. Replacing
       would make Back skip the whole visit and leave the app, which is the
       single most complained-about behaviour in map UIs. */
    window.history.pushState(null, '', window.location.pathname + next + window.location.hash)
  }, [selectedId])

  return [selectedId, setSelectedId, linked] as const
}

/** A one-shot instruction to another part of the tree. The token is what
    makes a repeat of the same instruction a new one. */
export type Request = { id: string; token: number }

/* Two pieces of state and props, spec §5: `selectedId`/`hoveredId`, click
   only. Scroll used to drive a per-cat camera pan and stay synced with
   selection, then a plain scroll-to-zoom — both removed: the page-scroll zoom
   fought MapLibre's own native scrollZoom for the same wheel gesture (jitter
   + center drift, since MapLibre folds an external jumpTo back into its own
   easing target). Dragging and scrolling the map are native MapLibre
   interactions now, nothing else touches them. Clicking a territory or a rail
   row is the only way to open a cat's plate. */

export default function App() {
  const [cats, setCats] = useState<Cat[]>([])
  /* The territory shapes, alongside the cats and from the same repo. Empty
     until the first load resolves, which every consumer already handles:
     Territories draws no layers for a collection with nothing in it. */
  const [territories, setTerritories] = useState<FeatureCollection<Polygon>>({
    type: 'FeatureCollection',
    features: [],
  })
  const [selectedId, setSelectedId, linked] = useUrlSelection()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  /* Two flags, not one. mapReady is a fact reported by MapLibre; opened is
     this component's decision that the loading sheet has finished leaving.
     Collapsing them would start the panels' entrance animations while the
     sheet was still covering them, and the whole point of the reveal is that
     it reveals something arriving. */
  const admin = useAdmin()
  const [mapReady, setMapReady] = useState(false)
  const [opened, setOpened] = useState(false)
  const isMobile = useIsMobile()

  /* Stable, so MapCanvas' one-shot `idle` listener is not torn down and
     re-subscribed on every render of this component. */
  const onMapReady = useCallback(() => setMapReady(true), [])

  /* The basemap will not load at all (map/mapError.ts decides that). The
     loading screen is waiting on a first paint that is never coming, and
     its eight second ceiling would hold a curtain over an app that already
     knows the answer, so this ends the wait early. MapCanvas draws the
     panel that explains it; all this does is get out of the way so it can
     be read. */
  const [mapFailed, setMapFailed] = useState(false)
  const onMapFailed = useCallback(() => setMapFailed(true), [])
  const onOpened = useCallback(() => setOpened(true), [])

  useLenis()

  /* Async from day one. See data/catsRepo.ts.

     Both halves are read together and set together, deliberately. A cat and
     its territory are one record split across two calls, and setting them in
     two passes would give the map a render where a cat has a marker with no
     shape under it, or a shape with no cat to name it. */
  const [loadToken, setLoadToken] = useState(0)
  useEffect(() => {
    let live = true
    Promise.all([listCats(), listTerritories()]).then(([loadedCats, loadedTerritories]) => {
      if (!live) return
      setCats(loadedCats)
      setTerritories(loadedTerritories)
    })
    return () => {
      live = false
    }
  }, [loadToken])

  /* Re-reads both after a cat has been recorded (ui/RecordCat.tsx). A
     counter rather than a callback that sets the data itself: the repo is
     the only thing that knows how seeded and recorded cats combine, so the
     answer has to come back through the same door it came through the first
     time. */
  const onRecorded = useCallback(() => setLoadToken((n) => n + 1), [])

  /* Two one-shot requests, each travelling from a component that cannot
     reach the one that has to act on it.

     `record` is "open this cat's record", which the scanner asks for and
     which only means something extra on mobile, where opening a plate is
     the deck's own local business (see CatDeck) rather than a consequence
     of selection.

     `report` is "start a sighting for this cat", which the plate asks for
     and which the sighting panel, living inside the map, has to carry out.

     A token beside the id, not a bare id, so asking twice for the SAME cat
     is two requests rather than one no-op: a person who opens MILO's
     record, closes it, and scans MILO again should get the record again.
     Same read-apply-clear shape as the ?cat= link above, and for the same
     reason: a request is an event, and events do not belong in state that
     is compared by value. */
  const [record, setRecord] = useState<Request | null>(null)
  const [report, setReport] = useState<Request | null>(null)

  const openRecord = useCallback((id: string) => {
    setSelectedId(id)
    setRecord((prev) => ({ id, token: (prev?.token ?? 0) + 1 }))
  }, [setSelectedId])

  const startReport = useCallback((id: string) => {
    setReport((prev) => ({ id, token: (prev?.token ?? 0) + 1 }))
  }, [])

  /* The cat an incoming link asked for, applied once, at the reveal.
     Clearing `linked` is also what releases the hook above to start writing
     the URL, so it happens on both paths, the good link and the dead one.

     Waits for BOTH the reveal and the data, and the second is not
     redundant. Loading.tsx has an 8 second ceiling and opens the app
     regardless of what has not arrived, so `opened` alone can mean "cats
     are still in flight", and validating a real id against an empty list
     would throw away a good link.

     An id that matches nothing gets cleaned out of the URL instead of
     applied. Left in place it would be worse than a no-op: Territories
     dims every territory whose id is not the selected one, so a stale link
     would hide all of them, show no glow and open no plate. An empty map
     with no error on it reads as a broken app rather than a dead link.
     replaceState, not push, so correcting the address is not a step Back
     can return to. */
  useEffect(() => {
    const id = linked.current
    if (!opened || !cats.length || !id) return
    linked.current = null
    if (cats.some((cat) => cat.id === id)) setSelectedId(id)
    else window.history.replaceState(null, '', window.location.pathname)
  }, [opened, cats, setSelectedId])

  /* A selection that no longer names a cat is cleared. Two paths reach
     here: clearing the recorded cats while one of them is open
     (ui/RecordCat.tsx), and a ?cat= link to a cat that has since gone.

     Left alone it is worse than a dangling id. Territories dims every
     territory that is not the selected one, so a selectedId matching
     nothing hides ALL of them and shows no glow and no plate: an empty map
     with no error on it. Guarded here, at the one place that owns the
     selection, rather than in the two places that can invalidate it.

     `cats.length` because an empty list means "not loaded yet", not "that
     cat is gone", and clearing on the first render would throw away every
     incoming link. */
  useEffect(() => {
    if (selectedId && cats.length && !cats.some((cat) => cat.id === selectedId)) setSelectedId(null)
  }, [cats, selectedId, setSelectedId])

  /* Closing returns focus to the row that opened the plate, not to the top of
     the document. Queried rather than threaded through a ref chain: the row
     may be in the rail or in the sheet, and the id is the one thing both
     presentations agree on. */
  const close = useCallback(() => {
    const id = selectedId
    setSelectedId(null)
    if (id) requestAnimationFrame(() => document.getElementById(`cat-row-${id}`)?.focus())
  }, [selectedId])

  const selected = cats.find((c) => c.id === selectedId) ?? null

  return (
    /* reducedMotion="user" drops transforms for everyone who asked, keeps
       opacity, and does it for every Motion component we ever add — including
       the layout animations, which is what makes the shared-element morph
       safe to use as the app's signature moment.

       One default transition for the whole tree, so a component that does not
       name a spring still gets the app's feel rather than Motion's stock
       ease. */
    <MotionConfig reducedMotion="user" transition={springSoft}>
      <MapCanvas
        cats={cats}
        selectedId={selectedId}
        onSelect={setSelectedId}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onReady={onMapReady}
        onFailed={onMapFailed}
        territories={territories}
        onRecorded={onRecorded}
        onOpenRecord={openRecord}
        report={report}
        admin={admin}
      />
      <Grain />

      {/* Above everything until the map has actually painted. A sibling of
          the map rather than a wrapper around it, deliberately: the map has
          to be mounted and rendering to ever become ready, so a loading
          screen that replaced it would be waiting on itself. */}
      {/* `|| mapFailed` reads as a lie and is not one: the prop is what the
          curtain waits on, and a map that has failed is done being waited
          for. Loading's own MIN_MS still applies, so this cuts the wait
          short without turning the reveal into a flicker. */}
      {!opened && <Loading cats={cats} mapReady={mapReady || mapFailed} onDone={onOpened} />}

      {/* A deck of cards on the map below the breakpoint, two floating
          panels above it. The same CatRow and the same Plate render in
          both, so this is a presentation switch, not a second
          implementation.

          CatDeck takes no onClose: opening a plate is a mobile-only state
          it keeps to itself (see the note there), so there is nothing here
          for it to close. */}
      {/* Gated on the reveal, not on the data. The rail, the deck and the
          plate all have entrance animations, and playing them underneath an
          opaque sheet spends them on nobody. Mounting after the curtain has
          gone means they arrive into the map it just uncovered. */}
      {opened && (isMobile ? (
        <CatDeck
          cats={cats}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          record={record}
          onReport={startReport}
        />
      ) : (
        <>
          <Rail
            cats={cats}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onHover={setHoveredId}
          />

          {/* mode="wait": the plates share one fixed slot, so switching cats
              plays A's exit before B enters instead of stacking them. It is
              also what lets Plate reuse a single layoutId for its view pill —
              two mounted plates would fight over it. */}
          <AnimatePresence mode="wait">
            {selected && (
              <Plate key={selected.id} cat={selected} onClose={close} onReport={startReport} />
            )}
          </AnimatePresence>
        </>
      ))}
    </MotionConfig>
  )
}
