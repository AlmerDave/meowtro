import { useEffect, useMemo, useRef, useState } from 'react'
import { photoAt, CARD_PX, THUMB_PX } from '@/data/cats.seed'
import { AnimatePresence, motion } from 'motion/react'
import type { FeatureCollection, Polygon } from 'geojson'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { ArrowLeft, Camera, Cat as CatGlyph, Check, MapPin, Menu, Search, X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { ringCentroid } from '@/map/centroid'
import { addSighting, distanceM, removeSighting, ringRadiusM, translateToward } from '@/data/sightings'
import type { Cat } from '@/data/catsRepo'
import type { Request } from '@/App'
import { ScanCat } from '@/ui/ScanCat'
import { useEscape } from '@/ui/escape'
import { spring, springSoft } from '@/motion/springs'
import { compressImage, PHOTO_MAX_DIM, PHOTO_QUALITY } from './imageToDataUrl'

/* "I saw a cat": the one thing a visitor can contribute to the survey.

   ## One flow, not two buttons

   The obvious split is a button for "which cat is this?" and another for "I
   want to say where I saw it". They are not two features. They are step one
   and step two of the same errand, and splitting them means somebody who
   identifies a cat and then wants to report it has to close one panel, open
   another, and identify the same cat a second time.

   Identification is therefore the first step of reporting, and it is a grid
   of photographs rather than a list of names. Recognition beats recall:
   somebody standing in front of an animal matches a face to a photo far
   faster than a name to a memory. The rail is the app's index and stays the
   index; this is a picker, and it exists inside a task.

   ## The grid at fifty cats

   A photo grid stops being an identification tool and starts being a
   scroll the moment the survey outgrows one screen, so three things carry
   it instead of one:

     nearest first  the strongest signal available, and the only one this
                    app has that a list of names does not. Somebody
                    reporting a sighting is standing somewhere, and the cat
                    they are looking at almost certainly lives nearby, so
                    the answer is usually in the first row. Sorted against
                    a SNAPSHOT of the map centre taken when the picker
                    opens, not live: re-sorting under a thumb mid-scroll
                    because the map drifted is worse than a slightly stale
                    order.
     search         over the name AND the description, which is where coat
                    and markings live. Typing "orange", "tabby", "torn"
                    narrows by what somebody can actually see from a metre
                    away. Focused on open, and Enter takes the top match,
                    so a keyboard user never touches the grid.
     off-screen     content-visibility on the cards, so a hundred of them
                    cost about what a screenful costs. Native, and it
                    replaces the virtual-list dependency this would
                    otherwise want.

   ## What a visitor may and may not do

   Report a sighting. Not add a cat, not edit a record. Adding is an admin's
   job (ui/RecordCat.tsx, mounted behind ?role=admin as of phase 8): an open
   "add a cat" on a public map is unreviewed data about real animals, which
   is the one thing this project has a written rule against.

   And as of phase 8 a sighting is a PROPOSAL. It lands `pending`, it moves
   nothing, and a reviewer approving it is what applies it — from the
   plate's own "Pending review" section as of phase 9 (plate/Plate.tsx),
   not the corner panel that used to own this (map/MapCanvas.tsx has the
   note on why). That is the sentence at the 'done' step below, and it used
   to say the opposite.

   Phase 9 also means this flow can hand back a cat that already has an
   open report on it: ReportSighting itself does not check for that (only
   the plate's own "I saw here" button does, see plate/Plate.tsx), so
   picking a cat here via the floating menu still lands a second,
   independent report rather than routing to a vote. Known, not fixed —
   the request that shipped phase 9 was scoped to the plate's button.

   Why a sighting rather than "move the cat" is argued in data/sightings.ts,
   where the consequences live.

   ## Three steps, and why each one exists

     pick     the grid. The whole Pokedex moment.
     place    tap the map. The chosen cat rides along as a chip, so it is
              never ambiguous which cat is being reported, and the panel
              says how far the tap is from that cat's known range, which
              turns a blind tap into a judgement.
     confirm  photo, name, point, when. Nothing commits before this.

   Then an undo, because a mis-tap on a map is the easiest mistake in the
   whole app and the cheapest one to make reversible. */

const PREVIEW = 'sighting-preview'
const PREVIEW_LINE = 'sighting-preview-line'
const PREVIEW_DOT = 'sighting-preview-dot'

type Step = 'closed' | 'pick' | 'scan' | 'place' | 'confirm' | 'done'

/** The three answers anyone can give accurately about when they saw a cat.
    A datetime picker would be asking for a precision nobody has and most
    people would fight with one-handed, outdoors. */
const WHEN = [
  { key: 'now', label: 'Just now', minutesAgo: 0 },
  { key: 'today', label: 'Earlier today', minutesAgo: 5 * 60 },
  { key: 'yesterday', label: 'Yesterday', minutesAgo: 24 * 60 },
] as const

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Whether typing is likely to be faster than looking. Read once: it is a
    property of the device, and a person does not swap mouse for touch
    mid-report. */
const PRECISE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches

/** How many cards the picker draws at once.

    This grid is already sorted nearest-first to where the map was pointed,
    and reporting a sighting means reporting a cat you are looking at, which
    is by definition one of the near ones. So the twelfth-nearest card is
    doing almost nothing for almost everybody, and the fiftieth is drawing a
    160px photograph from a third-party host to be scrolled past.

    A cap rather than virtualisation, which is the usual reflex here and
    would be the wrong tool: a windowed list is a scroll container, a
    measurement pass and a dependency, to save drawing a few dozen buttons.
    A cap is one `slice`, and it only has to be honest about what it hid.

    Nothing is unreachable behind it. The search field above the grid reads
    name and description together, so a cat outside the nearest twelve is
    one word away, and the line under the grid says how many are waiting
    there rather than letting the list quietly end. */
const SHOW_NEAREST = 12

/** Below this many cats the grid IS the interface and the search field is
    a courtesy, so stealing focus into it would be taking the interface
    away. Above it, typing is the fast path and the field earns the focus. */
const AUTOFOCUS_ABOVE = 8

type Props = {
  cats: Cat[]
  territories: FeatureCollection<Polygon>
  onReported: () => void
  /** Opens a cat's record. The scanner offers it: having identified a cat,
      reading about it is at least as likely to be what somebody wanted as
      reporting where it was. */
  onOpenRecord: (id: string) => void
  /** A plate asked to start a sighting. Arrives as a fresh object each time
      so that asking twice for the same cat works. */
  report: Request | null
}

export function ReportSighting({
  cats,
  territories,
  onReported,
  onOpenRecord,
  report,
}: Props) {
  const { map, isLoaded, placing, setPlacing } = useMap()
  const [step, setStep] = useState<Step>('closed')
  const [catId, setCatId] = useState<string | null>(null)
  const [point, setPoint] = useState<[number, number] | null>(null)
  const [when, setWhen] = useState<(typeof WHEN)[number]['key']>('now')
  /* Optional: the field this panel's own header comment used to describe as
     "nowhere to upload a photograph to" (data/sightings.ts's note on
     Sighting.photo). Empty string, not null, so it can sit directly in
     addSighting's optional `photo` param without a null check at the call
     site. */
  const [photo, setPhoto] = useState('')
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /* Where the map was looking when the picker opened. See the header: this
     is deliberately a snapshot rather than the live centre. */
  const [origin, setOrigin] = useState<[number, number] | null>(null)
  const [undoId, setUndoId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  /* The front door. Pressing the trigger no longer commits to a step; it
     asks how, and the two answers are the two ways somebody actually knows
     which cat they are looking at. A boolean rather than folding this into
     `step` because it is a decision about a decision -- neither of its
     options is itself a stage of the report, and giving it its own state
     keeps `step`'s machinery (the effects keyed on 'pick'/'scan'/'place'/
     'confirm') exactly as it was: choosing an item here only ever calls
     setStep with a value that machinery already understands. */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const cat = cats.find((c) => c.id === catId) ?? null

  /* Every cat, with how far its territory sits from where the map was
     pointed, nearest first. Cats whose shape has not loaded sort last
     rather than first, which is what Infinity buys over a 0 default. */
  const ranked = useMemo(() => {
    const centres = new Map<string, [number, number]>()
    for (const feature of territories.features) {
      const id = feature.properties?.id as string | undefined
      if (id) centres.set(id, ringCentroid(feature.geometry.coordinates[0] as [number, number][]))
    }
    return cats
      .map((c) => {
        const centre = centres.get(c.id)
        return { cat: c, away: origin && centre ? distanceM(origin, centre) : Infinity }
      })
      .sort((a, b) => a.away - b.away)
  }, [cats, territories, origin])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return ranked
    /* Name and description together, because the description is where the
       coat is: "orange tabby", "torn left ear". Those are the words
       somebody looking at a cat actually has. */
    return ranked.filter(
      ({ cat: c }) =>
        c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
    )
  }, [ranked, query])
  const feature = useMemo(
    () => territories.features.find((f) => f.properties?.id === catId) ?? null,
    [territories, catId],
  )

  /* How far the tap is from the middle of the cat's known patch, and
     whether that is inside it. Both come off the same shape the map is
     drawing, so the sentence cannot disagree with the picture. */
  const reach = useMemo(() => {
    if (!feature || !point) return null
    const ring = feature.geometry.coordinates[0] as [number, number][]
    const centre = ringCentroid(ring)
    const distance = distanceM(centre, point)
    const radius = ringRadiusM(ring, centre)
    return { distance, outside: Math.max(0, distance - radius) }
  }, [feature, point])

  const close = () => {
    /* Read before the state changes that unmount the panel, because after
       them there is no panel left to ask.

       Conditional, and that condition is the whole point rather than
       caution: close() is also what the 'done' step's nine-second timer
       calls, and a panel that grabs focus nine seconds after somebody
       finished with it would be pulling the caret out of whatever they had
       moved on to. Focus only goes home when this panel is about to
       destroy the element that currently holds it. */
    const holdsFocus = !!panelRef.current?.contains(document.activeElement)

    setStep('closed')
    setCatId(null)
    setPoint(null)
    setWhen('now')
    setPhoto('')
    setPhotoError(null)
    setQuery('')
    setPlacing(false)

    if (holdsFocus) requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  /* Taken on entering the picker, including on the way back from a later
     step, so a person who panned the map to look for the cat gets an order
     that reflects where they ended up. */
  useEffect(() => {
    if (step !== 'pick' || !map) return
    const { lng, lat } = map.getCenter()
    setOrigin([lng, lat])
  }, [step, map])

  /* Aiming is the innermost state, so Escape leaves that first rather than
     throwing away the whole report.

     On the shared stack (ui/escape.ts) rather than a window listener,
     because a plate is usually still open underneath this panel: it was
     started from one. Two window listeners on the same key meant Escape
     stepped this panel back and closed that record in the same press. */
  useEscape(step !== 'closed', () => {
    if (placing) setPlacing(false)
    else close()
  })

  /* The menu closes on its own Escape entry, never the panel's. The two
     are mutually exclusive -- the menu only ever shows while `step` is
     'closed' -- so there is no ordering question between them, only two
     independent registrations on the same stack.

     Focus goes home with it. Without this the menu unmounts out from under
     whichever item was focused, focus falls to <body>, and the next Tab
     starts again from the top of the document -- the exact thing the
     plate's own close() already guards against. */
  useEscape(menuOpen, () => {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  })

  /* Roving focus, because role="menu" is a promise.

     Declaring a menu tells a screen reader to enter menu mode, where the
     arrow keys are how you move and Tab is how you leave. Announcing that
     and then handling neither is worse than not declaring it at all: the
     keys a user is told to press do nothing. The items carry tabIndex={-1}
     for the same reason -- in a menu, Tab exits rather than walking the
     items one at a time. */
  const focusItem = (to: number | 'first' | 'last') => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    )
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      to === 'first'
        ? 0
        : to === 'last'
          ? items.length - 1
          : current < 0
            ? 0
            : (current + to + items.length) % items.length
    items[next]?.focus()
  }

  /* Into the menu when it opens. A frame later because AnimatePresence has
     not put it in the DOM until this render commits. */
  useEffect(() => {
    if (!menuOpen) return
    const frame = requestAnimationFrame(() => focusItem('first'))
    return () => cancelAnimationFrame(frame)
  }, [menuOpen])

  /* Picking an entry hands focus to the panel that just opened, so it does
     not fall to <body> in the gap between the menu unmounting and the panel
     appearing. Guarded, because the picker's search field autofocuses
     itself on a precise pointer: if something inside the panel has already
     claimed focus, taking it back would undo that. */
  const openStep = (next: Step) => {
    setMenuOpen(false)
    setStep(next)
    requestAnimationFrame(() => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
        panelRef.current.focus({ preventScroll: true })
      }
    })
  }

  // A press anywhere that is not the menu or the button that opened it.
  // Not on the panel's own AnimatePresence exit, because the menu is not
  // that panel -- it is a separate, much smaller popover with nothing else
  // above it to catch this for it.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  // The map takes one click while placing. Territories stands down for it
  // (MapCanvas' `placing`), so the tap cannot also select a cat.
  useEffect(() => {
    if (!map || !placing) return
    document.body.dataset.placing = 'true'
    const onClick = (e: MapMouseEvent) => {
      e.preventDefault()
      setPoint([e.lngLat.lng, e.lngLat.lat])
      setPlacing(false)
    }
    map.once('click', onClick)
    return () => {
      delete document.body.dataset.placing
      map.off('click', onClick)
    }
  }, [map, placing, setPlacing])

  /* The preview: where the territory would move to, dashed, plus a dot on
     the reported point. Showing the destination shape rather than only the
     point is what makes the consequence of the tap legible before it is
     committed. */
  useEffect(() => {
    if (!map || !isLoaded || step === 'closed' || step === 'pick' || step === 'scan') return
    if (!map.getSource(PREVIEW)) {
      map.addSource(PREVIEW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: PREVIEW_LINE,
        type: 'line',
        source: PREVIEW,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': token('--rust'), 'line-width': 1.5, 'line-dasharray': [2, 2] },
      })
      map.addLayer({
        id: PREVIEW_DOT,
        type: 'circle',
        source: PREVIEW,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': token('--rust'),
          'circle-stroke-width': 2,
          'circle-stroke-color': token('--paper'),
        },
      })
    }
    return () => {
      for (const id of [PREVIEW_DOT, PREVIEW_LINE]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(PREVIEW)) map.removeSource(PREVIEW)
    }
  }, [map, isLoaded, step])

  useEffect(() => {
    if (!map) return
    const source = map.getSource(PREVIEW) as GeoJSONSource | undefined
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features:
        point && feature
          ? [
              translateToward(feature, point),
              { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } },
            ]
          : [],
    })
  }, [map, point, feature])

  /* A plate said "I saw this one". Straight to placing: which cat it is was
     answered by the record the button was pressed on, so asking again in
     the picker would be asking a question the person has already answered.

     Keyed on the whole request object rather than its id, so pressing the
     same button twice reopens the panel instead of doing nothing the second
     time. */
  useEffect(() => {
    if (!report) return
    setCatId(report.id)
    setPoint(null)
    setStep('place')
    setPlacing(true)
    /* Focus follows the request. This is the one entrance where the control
       that was pressed does not survive the press: the plate's button is
       either scrolled away behind the panel or, on mobile, unmounted with
       the sheet it lived in, so focus would otherwise fall to <body> and the
       next Tab would start again from the top of the document. Deferred a
       frame because the panel is not in the DOM until this render commits.

       The same courtesy CatDeck already gives its own panel, for the same
       reason. Cancelled on cleanup, unlike the two rAFs in event handlers
       above: this one is scheduled from an effect that re-runs on every new
       request, so without it a second report queued behind a first would
       leave the earlier frame still due to fire and steal focus back off
       whatever the newer one had just given it to. */
    const frame = requestAnimationFrame(() =>
      panelRef.current?.focus({ preventScroll: true })
    )
    return () => cancelAnimationFrame(frame)
  }, [report, setPlacing])

  const choose = (id: string) => {
    setCatId(id)
    setStep('place')
    setPlacing(true)
  }

  const commit = () => {
    if (!cat || !point) return
    const minutes = WHEN.find((w) => w.key === when)?.minutesAgo ?? 0
    const sighting = addSighting(cat.id, point, Date.now() - minutes * 60_000, photo || undefined)
    if (!sighting) return
    setUndoId(sighting.id)
    setStep('done')
    onReported()
  }

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    setPhotoError(null)
    try {
      setPhoto(await compressImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY))
    } catch {
      setPhotoError('Could not read that photo. Try a different file.')
    }
  }

  // The undo window closes itself. A confirmation that waits forever is a
  // panel the person has to dismiss, which is one more thing to do after
  // they have already finished.
  useEffect(() => {
    if (step !== 'done') return
    const timer = setTimeout(close, 9000)
    return () => clearTimeout(timer)
  }, [step])

  const open = step !== 'closed'

  return (
    <>
      <motion.button
        ref={menuButtonRef}
        type="button"
        className="sight-open"
        data-open={String(open || menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        /* The only accessible name this control has ever had. It used to
           be visible text too; now the icon alone carries it on screen,
           but the name itself does not change with the icon (Menu vs X) or
           with state, which is the standard menu-button pattern: what the
           control IS stays constant, aria-expanded says what it is doing. */
        aria-label="I saw a cat"
        onClick={() => (open ? close() : setMenuOpen((v) => !v))}
        whileTap={{ scale: 0.94 }}
        transition={spring}
      >
        {/* Hamburger crossfades to a close glyph and back, so opening the
            choice below is a thing that visibly happens to this button
            rather than a panel that silently appears near it. Both icons
            occupy the same cell (.sight-open-icon is sized to the icon,
            not to either child) so the button never resizes as they cross,
            the same trick .map-control uses for its own two-state glyph. */}
        <span className="sight-open-icon">
          <AnimatePresence mode="wait" initial={false}>
            {open || menuOpen ? (
              <motion.span
                key="close"
                className="sight-open-icon-frame"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={spring}
              >
                <X size={15} />
              </motion.span>
            ) : (
              <motion.span
                key="menu"
                className="sight-open-icon-frame"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={spring}
              >
                <Menu size={15} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.button>

      {/* The two ways anyone actually knows which cat they are looking at.
          Not a step of its own (see the state comment above): picking
          either just calls setStep with a value the rest of this component
          already handles as the entry into 'scan' or 'pick'. */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            ref={menuRef}
            className="sight-menu"
            role="menu"
            aria-label="How do you know which cat?"
            /* Scale and opacity only, no y.

               A y offset has a direction, and this popover's direction is
               not constant: above 900px it sits above a trigger in the
               bottom-left corner, below 900px it sits below a trigger in
               the top-left one. A single y that reads as "growing out of
               the button" on the desktop reads as "sliding toward the
               button" on a phone, which is backwards.

               transform-origin already carries that information, and
               shell.css flips it at the same breakpoint that moves the
               trigger. Scaling from the corner nearest the button says
               "this came from there" in both layouts without this file
               needing to know which layout it is in. */
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            /* Out faster than in, and without the spring: an exit is the
               system responding to a decision already made, so it should
               get out of the way rather than settle. */
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
            transition={springSoft}
            onKeyDown={(e) => {
              /* Tab leaves the menu rather than walking it, which is what
                 menu mode means. Not prevented: the browser's own focus
                 move is the correct one, this only closes the thing being
                 left behind. */
              if (e.key === 'Tab') {
                setMenuOpen(false)
                return
              }
              if (e.key === 'ArrowDown') focusItem(1)
              else if (e.key === 'ArrowUp') focusItem(-1)
              else if (e.key === 'Home') focusItem('first')
              else if (e.key === 'End') focusItem('last')
              else return
              // Only for the keys actually handled, so Escape still reaches
              // the shared stack and typing is never swallowed.
              e.preventDefault()
            }}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="sight-menu-item"
              onClick={() => openStep('scan')}
            >
              <Camera size={14} />
              {/* Catdex: the file's own name for this move (see the header
                  note above) is "the whole Pokedex moment", and this is
                  where that becomes a proper noun rather than a comment.
                  The panel's own heading picks it back up below when this
                  step is actually open (step === 'scan'). */}
              <span>Catdex Scan</span>
            </button>
            <button
              type="button"
              role="menuitem"
              /* Same visible words as the trigger above it, on purpose: this
                 is the literal answer to "how do you know which cat" when
                 the answer is "I already saw it, I know which one" -- the
                 trigger's label restated as the specific choice it names.
                 aria-label carries the distinction a sighted person gets
                 from the different role and position, so the two do not
                 read as one dead control to a screen reader. */
              aria-label="I saw a cat — pick it from the list"
              tabIndex={-1}
              className="sight-menu-item"
              onClick={() => openStep('pick')}
            >
              <CatGlyph size={14} />
              <span>I saw a cat</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.section
            ref={panelRef}
            className="sight"
            /* Programmatically focusable, never a tab stop: -1 means "I can
               be focused by script" and not "put me in the tab order",
               which is exactly the distinction wanted here. */
            tabIndex={-1}
            aria-label="Report a sighting"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={springSoft}
          >
            <div className="sight-head">
              {step === 'place' || step === 'confirm' || step === 'scan' ? (
                <button
                  type="button"
                  className="sight-back"
                  aria-label="Back"
                  onClick={() => {
                    setPlacing(false)
                    setStep(step === 'confirm' ? 'place' : 'pick')
                  }}
                >
                  <ArrowLeft size={14} />
                </button>
              ) : (
                <span className="sight-back" aria-hidden />
              )}

              <h2>
                {step === 'pick' && 'Which cat did you see?'}
                {/* A name rather than a task description, which is what
                    lets it stay put across all four of the scanner's
                    states -- "point it at the cat" goes stale the moment
                    there is a photo on screen, but a name never has to
                    describe what is currently happening under it. */}
                {step === 'scan' && 'Catdex'}
                {step === 'place' && 'Where did you see it?'}
                {step === 'confirm' && 'Check this over'}
                {step === 'done' && 'Thank you'}
              </h2>

              <button type="button" className="sight-close" aria-label="Cancel" onClick={close}>
                <X size={15} />
              </button>
            </div>

            {step === 'pick' && (
              <>
                <div className="sight-search">
                  <Search size={13} aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      /* Enter takes the top match. With the field focused on
                         open, identifying a cat by name never requires
                         reaching the grid at all. */
                      if (e.key === 'Enter' && matches[0]) {
                        e.preventDefault()
                        choose(matches[0].cat.id)
                      }
                    }}
                    placeholder="Name, colour, markings…"
                    aria-label="Search cats by name, colour or markings"
                    /* Never on touch: autofocus there raises the on-screen
                       keyboard over the photo grid, which is precisely the
                       thing this step exists to show. */
                    autoFocus={PRECISE_POINTER && cats.length > AUTOFOCUS_ABOVE}
                  />
                  {/* Announced, because filtering as you type changes what is
                      on screen without moving focus, and a screen reader user
                      would otherwise have no idea the list had narrowed. */}
                  <span className="sight-count" aria-live="polite">
                    {matches.length}
                    <span className="sr-only"> cats match</span>
                  </span>
                </div>

                {matches.length > 0 ? (
                  /* No role="list"/"listitem" here, deliberately. Putting
                     listitem on a <button> REPLACES its button role, so a
                     screen reader announces "list item" and drops the one
                     fact that matters: that it can be pressed. A group of
                     buttons is already a comprehensible thing. */
                  <div className="sight-grid">
                    {matches.slice(0, SHOW_NEAREST).map(({ cat: c, away }) => (
                      <button
                        key={c.id}
                        type="button"
                        className="sight-card"
                        style={{ '--accent': `var(${c.colour})` } as React.CSSProperties}
                        onClick={() => choose(c.id)}
                      >
                        {/* alt is empty and the name is real text underneath:
                            a screen reader that read "photo of MILO, MILO"
                            would be reading the same thing twice.
                            width/height so the browser reserves the square
                            before the photo lands and a long grid does not
                            reflow as you scroll it. */}
                        {/* CARD_PX, not the seeded 640x480: this grid
                            paints twelve photographs at once and was the
                            single heaviest thing this panel did on open.
                            See data/cats.seed.ts for why this one alone
                            does not take THUMB_PX. */}
                        <img
                          src={photoAt(c.photo, CARD_PX)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={160}
                          height={160}
                        />
                        <span className="sight-card-name">{c.name}</span>
                        <span className="sight-card-away">
                          {Number.isFinite(away) ? `${Math.round(away)} m away` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* What the cap hid, said out loud. A grid that just stops
                    at twelve looks like the whole survey to somebody whose
                    cat is the thirteenth; a line saying so points at the
                    field that reaches it. Not a "show all" button on
                    purpose: pressing it would draw exactly the cards this
                    exists to not draw, and searching is faster than
                    scrolling a wall of photographs anyway. */}
                {matches.length > SHOW_NEAREST && (
                  <p className="sight-more">
                    Nearest {SHOW_NEAREST} shown · {matches.length - SHOW_NEAREST} more{' '}
                    {query.trim() ? 'match above' : 'in the survey'}. Search by name or marking.
                  </p>
                )}

                {matches.length === 0 && (
                  <p className="sight-empty">
                    No cat here matches “{query.trim()}”. Try a colour or a marking, or an admin
                    can add a cat the survey has not recorded yet.
                  </p>
                )}

                {/* The scan escape hatch that used to live here moved up
                    to the menu that opens this step (see the trigger
                    button): "which one" is now asked before the grid
                    renders, not partway through it, so a second way to ask
                    it from inside the grid was a leftover, not a safety
                    net. */}
                <div className="sight-foot">
                  <p className="sight-hint">Nearest to the middle of the map first.</p>
                </div>
              </>
            )}

            {step === 'scan' && (
              <ScanCat
                cats={cats}
                onOpenRecord={(id) => {
                  /* Straight to the record and out of the way. The panel has
                     done its job at that point, and leaving it open would
                     put it over the plate it just opened. */
                  onOpenRecord(id)
                  close()
                }}
                onBack={() => setStep('pick')}
              />
            )}

            {(step === 'place' || step === 'confirm') && cat && (
              <div className="sight-body">
                {/* The chosen cat rides along through both remaining steps,
                    so it is never ambiguous which record is about to change. */}
                <div className="sight-chip">
                  {/* 1.75rem in the chip, so the shared thumbnail size,
                      which the rail and the map pin have already put in
                      cache by the time anyone reaches this step. */}
                  <img src={photoAt(cat.photo, THUMB_PX)} alt="" />
                  <span>{cat.name}</span>
                </div>

                {step === 'place' && (
                  <>
                    <button
                      type="button"
                      className="sight-place"
                      data-on={String(placing)}
                      onClick={() => setPlacing(!placing)}
                    >
                      <MapPin size={13} />
                      {placing ? 'Tap the map…' : point ? 'Tap again to move it' : 'Tap the map'}
                    </button>

                    {reach && (
                      <p className="sight-reach">
                        {reach.outside > 0
                          ? `${Math.round(reach.outside)} m outside ${cat.name}'s usual range.`
                          : `Inside ${cat.name}'s usual range.`}
                      </p>
                    )}

                    <button
                      type="button"
                      className="sight-go"
                      disabled={!point}
                      onClick={() => setStep('confirm')}
                    >
                      Next
                    </button>
                  </>
                )}

                {step === 'confirm' && point && (
                  <>
                    <label className="sight-photo-field">
                      <span className="sight-label">Photo (optional)</span>
                      <div className="sight-photo-row">
                        {photo && <img className="sight-photo-thumb" src={photo} alt="" />}
                        <input
                          className="sight-photo-file"
                          type="file"
                          accept="image/*"
                          onChange={(e) => void pickPhoto(e.target.files?.[0])}
                        />
                      </div>
                      {photoError && (
                        <p className="record-error" role="alert" aria-live="polite">
                          {photoError}
                        </p>
                      )}
                    </label>

                    <fieldset className="sight-when">
                      <legend>When?</legend>
                      {WHEN.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          data-on={String(when === option.key)}
                          aria-pressed={when === option.key}
                          onClick={() => setWhen(option.key)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </fieldset>

                    {/* Conditional, not "would move": if the reported point
                        is already inside the cat's patch, approving it moves
                        nothing much, and saying so is more useful than a
                        number. Both halves are now about what a REVIEWER
                        would cause, which is the whole change phase 8 makes
                        to this panel. */}
                    <p className="sight-summary">
                      {cat.name} at {point[1].toFixed(4)}, {point[0].toFixed(4)}.{' '}
                      {reach && reach.outside > 0
                        ? `If approved, its territory moves ${Math.round(reach.distance)} m.`
                        : 'If approved, its territory shifts slightly.'}
                    </p>

                    <button type="button" className="sight-go" onClick={commit}>
                      <Check size={14} />
                      Report sighting
                    </button>
                  </>
                )}
              </div>
            )}

            {step === 'done' && (
              <div className="sight-body sight-done">
                <CatGlyph size={20} aria-hidden />
                {/* The copy this panel has carried since phase 6 said the
                    opposite: that the territory had moved, because nobody
                    reviewed sightings yet. That was true and is not any
                    more, and it is the sentence that most needed to change
                    with review, because it is the only place the app tells
                    somebody what their contribution just did. */}
                <p>
                  Recorded, and waiting for review. Nothing on the map has moved yet.{' '}
                  {cat?.name}&apos;s territory shifts once a reviewer approves it, and you can take
                  this back from {cat?.name}&apos;s record until then.
                </p>
                <button
                  type="button"
                  className="sight-undo"
                  onClick={() => {
                    if (undoId) removeSighting(undoId)
                    setUndoId(null)
                    onReported()
                    close()
                  }}
                >
                  Undo
                </button>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
