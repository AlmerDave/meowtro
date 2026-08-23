import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { FeatureCollection, Polygon } from 'geojson'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { ArrowLeft, Binoculars, Camera, Cat as CatGlyph, Check, MapPin, Search, X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { ringCentroid } from '@/map/centroid'
import { addSighting, distanceM, removeSighting, ringRadiusM, translateToward } from '@/data/sightings'
import type { Cat } from '@/data/catsRepo'
import type { Request } from '@/App'
import { ScanCat } from '@/ui/ScanCat'
import { spring, springSoft } from '@/motion/springs'

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
   job (ui/RecordCat.tsx, currently unmounted, waiting for the version with
   accounts in it): an open "add a cat" on a public map is unreviewed data
   about real animals, which is the one thing this project has a written
   rule against.

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
  const [query, setQuery] = useState('')
  /* Where the map was looking when the picker opened. See the header: this
     is deliberately a snapshot rather than the live centre. */
  const [origin, setOrigin] = useState<[number, number] | null>(null)
  const [undoId, setUndoId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)

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
    setStep('closed')
    setCatId(null)
    setPoint(null)
    setWhen('now')
    setQuery('')
    setPlacing(false)
  }

  /* Taken on entering the picker, including on the way back from a later
     step, so a person who panned the map to look for the cat gets an order
     that reflects where they ended up. */
  useEffect(() => {
    if (step !== 'pick' || !map) return
    const { lng, lat } = map.getCenter()
    setOrigin([lng, lat])
  }, [step, map])

  useEffect(() => {
    if (step === 'closed') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Aiming is the innermost state, so Escape leaves that first rather
      // than throwing away the whole report.
      if (placing) setPlacing(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, placing, setPlacing])

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
       reason. */
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
  }, [report, setPlacing])

  const choose = (id: string) => {
    setCatId(id)
    setStep('place')
    setPlacing(true)
  }

  const commit = () => {
    if (!cat || !point) return
    const minutes = WHEN.find((w) => w.key === when)?.minutesAgo ?? 0
    const sighting = addSighting(cat.id, point, Date.now() - minutes * 60_000)
    if (!sighting) return
    setUndoId(sighting.id)
    setStep('done')
    onReported()
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
        type="button"
        className="sight-open"
        data-open={String(open)}
        onClick={() => (open ? close() : setStep('pick'))}
        whileTap={{ scale: 0.94 }}
        transition={spring}
      >
        {/* Binoculars, not an eye. An eye is the visibility toggle in
            every design system there is: it means show/hide, or preview,
            and it is the glyph you reach for when you have not decided what
            the button means. Binoculars belong to the vocabulary this app
            is actually written in, the one with survey lines, plate numbers
            and field notes in it: they are what somebody recording animals
            is carrying. */}
        <Binoculars size={15} />
        <span>I saw a cat</span>
      </motion.button>

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
                {/* Neutral across all four of the scanner's states, since
                    a title saying "point it at the cat" is stale the
                    moment there is a photo on screen. */}
                {step === 'scan' && 'Identify a cat'}
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
                    {matches.map(({ cat: c, away }) => (
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
                        <img src={c.photo} alt="" loading="lazy" decoding="async" width={160} height={160} />
                        <span className="sight-card-name">{c.name}</span>
                        <span className="sight-card-away">
                          {Number.isFinite(away) ? `${Math.round(away)} m away` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="sight-empty">
                    No cat here matches “{query.trim()}”. Try a colour or a marking, or an admin
                    can add a cat the survey has not recorded yet.
                  </p>
                )}

                <div className="sight-foot">
                  <button type="button" className="sight-scan" onClick={() => setStep('scan')}>
                    <Camera size={13} />
                    I do not know which one
                  </button>
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
                  <img src={cat.photo} alt="" />
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

                    <p className="sight-summary">
                      {cat.name} at {point[1].toFixed(4)}, {point[0].toFixed(4)}.{' '}
                      {reach && reach.outside > 0
                        ? `Its territory moves ${Math.round(reach.distance)} m.`
                        : 'Its territory shifts slightly.'}
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
                <p>
                  Recorded. {cat?.name}&apos;s territory has moved. Nobody reviews sightings yet,
                  so yours was applied straight away.
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
