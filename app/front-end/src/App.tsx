import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { ShieldCheck } from 'lucide-react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { Grain } from '@/Grain'
import { MapCanvas, useMap } from '@/map/MapCanvas'
import { CatMarkers } from '@/map/CatMarkers'
import { MapControls } from '@/map/MapControls'
import { nearestPlaceName } from '@/map/landmark'
import { RecordCat } from '@/ui/RecordCat'
import { FeederRequests } from '@/ui/FeederRequests'
import { ReportSighting } from '@/ui/ReportSighting'
import { Plate } from '@/plate/Plate'
import { useLenis } from '@/motion/lenis'
import { springSoft } from '@/motion/springs'
import { Rail } from '@/ui/Rail'
import { CatDeck } from '@/ui/CatDeck'
import { Loading } from '@/ui/Loading'
import { AccountMenu } from '@/ui/AccountMenu'
import { listCats, listTerritories, type Cat } from '@/data/catsRepo'
import { isSurveyed, listVisibleSightings, type Sighting } from '@/data/sightings'
import { greetingName, isAdmin, signOutUser, subscribeAuth, type User } from '@/data/auth'
import { isFeeder } from '@/data/feeders'
import type { FeatureCollection, Polygon } from 'geojson'

/* The one legal way to reach the live MapLibre instance from Plate.tsx,
   which sits outside <MapCanvas>'s own tree (App.tsx renders it as a
   sibling) and so cannot call useMap() itself — that hook throws unless
   it is used somewhere MapCanvas actually rendered. MapCanvas's own
   `children` prop already exists for exactly this ("a child can drive
   isFlat, theme and weather through useMap()"); the landing's reel was
   the first caller, this the second, and CatMarkers/MapControls below
   (moved here from inside MapCanvas.tsx itself, see that file's note by
   <Storm>) the third and fourth.

   2026-08-26: used to mount only under `admin`, on the assumption that
   findNearestPlace below was "a feature only Approve uses" — wrong once
   the plate's own Range line and pending-sighting message started reading
   it for every visitor (Plate.tsx's nearbyPlace/pendingPlace). Gating this
   on admin silently broke both for a regular visitor: mapRef.current never
   got set, so findNearestPlace always returned null and neither line ever
   showed anything, with no error to notice. Unconditional now. */
function MapInstanceBridge({ onMap }: { onMap: (map: MapLibreMap | null) => void }) {
  const { map } = useMap()
  useEffect(() => {
    onMap(map)
    /* Handed back on the way out. Without this the ref keeps whatever
       instance was current when this unmounted, and MapCanvas' own cleanup
       has by then called instance.remove(): findNearestPlace would go on
       calling querySourceFeatures on a destroyed map rather than returning
       null the way it already does before one exists. StrictMode reaches
       exactly this state on every dev mount, and so does the real app if
       MapCanvas is ever remounted. */
    return () => onMap(null)
  }, [map, onMap])
  return null
}

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
/* The admin gate, phase 9. Real Firebase Auth now: signed in with Google
   AND listed in the `admins` collection (firestore.rules' isAdmin(),
   data/auth.ts's isAdmin(uid) mirrors it for the client). Unlike the old
   ?role=admin, this genuinely cannot be typed into the address bar: the
   Firestore rule is what actually enforces it either way, this hook only
   decides what the UI shows.

   No longer constant after mount, unlike the old useAdmin: sign-in
   resolves asynchronously (onAuthStateChanged fires once Firebase has
   checked for a persisted session, then again if the user signs in this
   visit), so `admin` can flip from false to true after first paint. The
   effect below that mirrors it onto `document.body.dataset.admin` already
   depends on `[admin]` and re-runs correctly either way, nothing else
   needed changing for that. */
function useAdmin(): boolean {
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    return subscribeAuth((user) => {
      if (!user) {
        setAdmin(false)
        return
      }
      isAdmin(user.uid).then(setAdmin)
    })
  }, [])
  return admin
}

/* Approved-feeder status, the second trust tier (spec
   2026-09-01-territory-visibility-decoy-design.md). Same shape as useAdmin,
   and flips false to true after first paint the same way: onAuthStateChanged
   fires once for a persisted session, then again on a fresh sign-in. An
   admin is privileged too, so callers use `canSeePrecise` (admin || feeder)
   rather than this alone. */
function useFeeder(): boolean {
  const [feeder, setFeeder] = useState(false)
  useEffect(() => {
    return subscribeAuth((user) => {
      if (!user) {
        setFeeder(false)
        return
      }
      isFeeder(user.uid).then(setFeeder)
    })
  }, [])
  return feeder
}

/* The signed-in visitor's own uid, tracked alongside admin rather than
   folded into it: an admin is also a signed-in uid, but ordinary sighting
   business needs to know WHO is asking, not only whether they hold the
   admin gate. plate/Plate.tsx is the one component that actually calls the
   uid-taking functions (catsRepo's listSightings, listPendingForCat,
   withdrawSighting, voteSighting, addAdminPhoto): once directly, from this
   file's own <Plate> below, and once by pass-through through
   ui/CatDeck.tsx, which mounts its own <Plate> for the mobile layout and
   has no other use for the value itself. null while signed out, the same
   shape those functions already expect for an anonymous visitor. */
function useUid(): string | null {
  const [uid, setUid] = useState<string | null>(null)
  useEffect(() => subscribeAuth((user) => setUid(user?.uid ?? null)), [])
  return uid
}

/* The signed-in visitor's whole auth object, not just the uid useUid
   already tracks: the admin-banner greeting below needs a name to show,
   which lives on the User, so it gets its own small subscription rather
   than widening useUid's contract for every other caller of it. */
function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null)
  useEffect(() => subscribeAuth(setUser), [])
  return user
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
  /* The whole sightings log, fetched alongside cats/territories rather than
     read out of localStorage from inside map/Territories.tsx and
     map/CatMarkers.tsx as it used to be (data/sightings.ts's own note on
     why those two predicates cannot await). Handed down as a plain array so
     nothing downstream has to fetch or await anything of its own. */
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [selectedId, setSelectedId, linked] = useUrlSelection()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  /* Two flags, not one. mapReady is a fact reported by MapLibre; opened is
     this component's decision that the loading sheet has finished leaving.
     Collapsing them would start the panels' entrance animations while the
     sheet was still covering them, and the whole point of the reveal is that
     it reveals something arriving. */
  const admin = useAdmin()
  const feeder = useFeeder()
  const uid = useUid()
  const user = useUser()

  /* Who may see where a cat actually lives (spec
     2026-09-01-territory-visibility-decoy-design.md). Everyone else is
     shown each territory relocated to a stable fake BGC point by
     data/catsRepo.ts. An admin is implicitly trusted here too. */
  const canSeePrecise = admin || feeder

  /* Same reactive-attribute shape ui/ReportSighting.tsx already uses for
     `data-placing`: a body-level attribute is what lets shell.css reserve
     room for the admin banner below (.rail/.plate's `top`) without
     threading a boolean prop through components that have no other reason
     to know about it. Still depends on `[admin]`, which now matters for a
     real reason: this is the effect that re-runs when `admin` flips from
     false to true post-mount, once subscribeAuth/isAdmin (useAdmin's own
     note) resolve. Still an effect, not a bare assignment during render,
     for the same reason every other DOM side effect in this app is one. */
  useEffect(() => {
    document.body.dataset.admin = String(admin)
  }, [admin])

  /* Fed by MapInstanceBridge above, not state: the plate calling this on
     an Approve click needs today's instance, not a value captured at
     whatever render last passed it down, and a ref is exactly "read it
     when it's needed" without re-rendering Rail/Plate/CatDeck every time
     the map itself mounts or unmounts. setMapInstance is its own stable
     callback, not an inline arrow at the JSX below, so MapInstanceBridge's
     effect depends on an identity that never changes and only re-fires
     when `map` itself actually does — an inline arrow would give it a
     fresh identity on every App render (a cat hovered, a selection made)
     for no reason, since all it ever does is write one ref. */
  const mapRef = useRef<MapLibreMap | null>(null)
  const setMapInstance = useCallback((map: MapLibreMap | null) => {
    mapRef.current = map
  }, [])
  const findNearestPlace = useCallback((point: [number, number]) => {
    return mapRef.current ? nearestPlaceName(mapRef.current, point) : null
  }, [])

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

     Cats and territories are read together and set together, deliberately.
     A cat and its territory are one record split across two calls, and
     setting them in separate passes would give the map a render where a cat
     has a marker with no shape under it, or a shape with no cat to name it.
     Sightings joined this effect as of phase 9, and every existing trigger
     for it (approving or discarding a sighting, adding a cat, reporting
     one) already means the sightings log has changed too, so it refreshes
     for free rather than needing a second loadToken. Sightings landing a
     beat ahead of the other two is harmless where a split between cats and
     territories would not be: an early sightings array with no cats yet
     draws nothing, since both map layers key off a cat that has to exist
     first.

     Sightings are fetched FIRST and the surveyed subset handed down into
     listCats/listTerritories, rather than all three firing at once. Those
     two derive "last seen" and the territory shift from exactly that
     subset, and left to themselves each fetches it again: three reads of
     the same query per page load, for one answer. The two calls still work
     with no argument (landing/Landing.tsx calls listCats() bare), this is
     just the caller that already has the data saying so.

     `uid` is a dependency now, and has to be: listVisibleSightings returns
     surveyed-only while signed out and surveyed-plus-pending once signed
     in (firestore.rules opens pending reports to a signed-in caller for
     corroboration voting). Without it a visitor who signs in this session
     would keep the signed-out set until something else happened to bump
     loadToken, and the map's ghost territories would stay invisible to
     them. */
  const [loadToken, setLoadToken] = useState(0)
  useEffect(() => {
    let live = true
    listVisibleSightings(uid).then((visible) => {
      if (!live) return
      const publicSightings = visible.filter(isSurveyed)
      /* The full `visible` set into state, not the public subset:
         map/Territories.tsx's ghost outline and map/CatMarkers.tsx's
         pending badge both read pending sightings out of this array, and
         both are open to every signed-in visitor rather than admin alone
         (Territories.tsx's own 2026-08-26 note). Only the derived cats and
         territories are built from the surveyed half. */
      setSightings(visible)
      Promise.all([
        listCats(publicSightings, canSeePrecise),
        listTerritories(publicSightings, canSeePrecise),
      ]).then(([loadedCats, loadedTerritories]) => {
        if (!live) return
        setCats(loadedCats)
        setTerritories(loadedTerritories)
      })
    })
    return () => {
      live = false
    }
    /* canSeePrecise is a dependency for the same reason uid is: it flips
       from false to true a beat after mount once useFeeder/useAdmin
       resolve, and a viewer who turns out to be a feeder needs the
       accurate geometry refetched rather than staying on the decoys they
       were served first. */
  }, [loadToken, uid, canSeePrecise])

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
        sightings={sightings}
        uid={uid}
        canSeePrecise={canSeePrecise}
      >
        <MapInstanceBridge onMap={setMapInstance} />
        {/* Rendered here rather than inside MapCanvas.tsx so the landing
            entry (landing/Landing.tsx, which never imports App.tsx) never
            pulls in any of these four components' motion/react dependency.
            See MapCanvas.tsx's own comment by <Storm> for the full
            reasoning; same props each of these always took, MapCanvas
            itself just used to be the one forwarding them. */}
        <CatMarkers
          cats={cats}
          territories={territories}
          sightings={sightings}
          selectedId={selectedId}
          onSelect={setSelectedId}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          uid={uid}
          admin={admin}
          canSeePrecise={canSeePrecise}
        />
        <MapControls onSelect={setSelectedId} />

        {/* RecordCat is on screen behind the role check, same as since
            phase 6. ui/ReviewQueue.tsx is not: phase 9 replaced its
            list-panel review with reviewing straight off the map (the
            pulsing pin badge, the ghost territory, the plate's own
            "Pending review" section) at the admin's own request that the
            corner panel was "too crowded and unnecessary". The file itself
            is left alone, unimported, same as plate/CatFigure.tsx after
            the 3D view came out (Plate.tsx's own header explains that
            precedent) — nothing here says its list-plus-audit-trail view
            can never come back, only that nothing currently mounts it.

            Once briefly carried a second "you are admin" tell, a small
            badge beside the record button — replaced by the admin banner
            above once that existed, since two indicators for one fact is
            the kind of duplication this app argues against everywhere
            else, and the corner one was the one that had gone unnoticed to
            begin with.

            Wrapped rather than owning its own fixed position: the first
            version put the trigger at a hand-picked corner (top-left)
            without noticing the rail already lives there at full height,
            so it rendered directly underneath it and was, correctly,
            reported as "hidden": DOM order put Rail after MapCanvas, so
            Rail painted over it. .admin-controls (shell.css) fixes the
            position once, beside the map-controls capsule, a corner
            nothing else claims — kept as a wrapper rather than unwound to
            a single positioned button because a second admin tool is
            likely to want the same shelf again. */}
        {admin && (
          <div className="admin-controls">
            <RecordCat onRecorded={onRecorded} />
            {/* The feeder-approval queue, an ordinary flex child of the
                shelf beside the record trigger (see .admin-controls' own
                note on why nothing in here positions itself). It reuses
                ui/ReviewQueue.tsx's trigger-and-panel styling, whose panel
                slot is free: phase 9 unmounted that queue. */}
            <FeederRequests />
          </div>
        )}

        {/* The visitor's one contribution, and as of phase 8 a proposal
            rather than an edit: it lands `pending` and moves nothing until
            an admin approves it. RecordCat above is the admin's
            counterpart, now that there is somebody to do the reviewing.

            Gated on canSeePrecise (spec 2026-09-01): an unprivileged
            viewer sees a decoy map, so a point they tap on it is a real
            coordinate placed against a fake location, unusable data. The
            plate carries the "get approved as a feeder" line where the
            "I saw here" button would be. */}
        {canSeePrecise && (
          <ReportSighting
            cats={cats}
            territories={territories}
            onReported={onRecorded}
            onOpenRecord={openRecord}
            report={report}
          />
        )}
      </MapCanvas>
      <Grain />

      {/* The admin's tell that the gate is open, phase 9 — a corner pill
          went unnoticed (user report), this is the replacement: a strip
          nobody can land on the app and miss. z-index 7 (shell.css) puts
          it above every panel and below the loading curtain (10), so it
          is already true the moment the curtain lifts rather than a beat
          late; the curtain covering it until then is fine, nothing else
          is visible yet either. Unconditional on `admin` alone, not
          `opened`: .rail/.plate read the SAME `--admin-banner-h` this
          mounting drives (via body[data-admin], the effect above) to
          reserve their own room, and that reservation has to be in effect
          before they first paint, not after. */}
      {/* Sign out lives here, on the one surface that already says who you
          are. Until this existed there was no way back out of a session at
          all: signing in on a borrowed or shared machine left the admin
          gate open on it indefinitely, with the banner announcing as much
          to whoever picked it up next. `admin` flips itself false through
          useAdmin's own subscription once the sign-out lands, so this
          unmounts the strip it sits in and nothing else has to be told.

          Scoped to the admin strip on purpose. A signed-in NON-admin
          visitor still has no indicator and no way out, which is a real
          gap and a separate piece of work: it needs a home in the app's
          chrome that does not exist yet, whereas an admin already has
          one. */}
      {admin && (
        <div className="admin-banner" role="status">
          <ShieldCheck size={13} aria-hidden />
          Admin mode
          <button type="button" className="admin-banner-out" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </div>
      )}


      {/* The gap the admin banner's own comment names: a signed-in
          non-admin had no indicator and no way out. A small top-centre
          pill rather than a second full-width strip, on purpose: unlike
          the banner it doesn't reserve layout room (`admin` and this are
          mutually exclusive, so `.rail`/`.plate` never have to clear both
          at once), and top-centre is the one spot `.rail` (top-left) and
          `.plate` (top-right, desktop only, whenever a cat is selected)
          both leave alone at every width, including below 900px where
          neither is even mounted (CatDeck owns the bottom instead). */}
      {!admin && user && (
        <div className="user-chip" role="status">
          <span className="user-chip-name">Hi, {greetingName(user)}</span>
          <button type="button" className="user-chip-out" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </div>
      )}

      {/* The visitor's account surface: the sign-in prompt while signed
          out, the "Apply as a feeder" flow once signed in but not yet
          approved (spec 2026-09-01). Gone for an approved feeder or an
          admin, who already see accurate territories. A signed-in
          non-feeder sees this (bottom-left, an action) alongside the
          user-chip above (top-centre, an identity readout): different
          jobs, different corners. */}
      {!admin && !feeder && <AccountMenu user={user} />}

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
          admin={admin}
          uid={uid}
          canSeePrecise={canSeePrecise}
          onChanged={onRecorded}
          loadToken={loadToken}
          territories={territories}
          nearestPlaceName={findNearestPlace}
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
              <Plate
                key={selected.id}
                cat={selected}
                onClose={close}
                onReport={startReport}
                admin={admin}
                uid={uid}
                canSeePrecise={canSeePrecise}
                onChanged={onRecorded}
                loadToken={loadToken}
                territories={territories}
                nearestPlaceName={findNearestPlace}
              />
            )}
          </AnimatePresence>
        </>
      ))}
    </MotionConfig>
  )
}
