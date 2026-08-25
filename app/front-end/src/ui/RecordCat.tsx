import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { MapPin, Plus, X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { addCat, clearRecorded, countRecorded } from '@/data/catsRepo'
import { CAT_COLOURS, type Colour } from '@/data/cats.seed'
import { circleRing } from '@/data/localCats'
import { spring, springSoft } from '@/motion/springs'

/* Record a cat: the panel that adds one to the survey.

   ## Parked, on purpose, and not dead

   This is the ADMIN's tool and it is currently not mounted anywhere. See
   MapCanvas, where its render was replaced by ui/ReportSighting.tsx.

   Adding a cat is a reviewed action: an open "add a cat" on a public map is
   unreviewed data about real animals. Until there are accounts and somebody
   to do the reviewing, a visitor's only contribution is a sighting. Mount
   this again behind the role check and nothing else about it has to change.

   Do not delete it on the grounds that nothing imports it. That is the
   state it is meant to be in.

   ## What this is, and what it deliberately is not

   Local only. Everything recorded here goes into this browser's storage
   (data/localCats.ts) and no further, because there is no server yet and
   pretending otherwise in the UI would be the actual lie. The panel says so
   in its footer rather than hiding it, so nobody presenting this has to
   remember to add the caveat out loud.

   The territory is drawn, not typed. You click the map to say roughly where
   the cat lives and drag a radius around it, and what gets stored is the
   resulting circle. This is not a nicety: spec §9 forbids this app from
   holding an exact location for a real animal, and a form with a "location"
   box in it is exactly how that rule gets broken by accident. A circle you
   have to size yourself makes the imprecision the point of the interaction
   instead of a caveat under it.

   ## Why it lives inside <MapCanvas>

   It is a fixed HUD panel, like MapControls, and like MapControls it needs
   the map instance: to take a click, to draw the preview and to stop
   Territories selecting a cat with the click that places a point. useMap()
   only resolves inside the provider, so this renders there rather than
   beside the rail, where it visually appears to belong. */

const PREVIEW = 'record-preview'
const PREVIEW_FILL = 'record-preview-fill'
const PREVIEW_LINE = 'record-preview-line'

/** Radius bounds in metres. The floor is about a building's footprint and
    the ceiling about two city blocks, which brackets every seeded territory.
    Anything tighter starts to claim a precision this app will not state. */
const MIN_RADIUS = 30
const MAX_RADIUS = 250

/* The swatches used to be declared here, three of them, duplicating the
   union in data/cats.seed.ts. They are the same list now and it lives with
   the type, so the picker cannot offer a colour the data model rejects. */
const COLOURS = CAT_COLOURS

const EMPTY = {
  name: '',
  description: '',
  note: '',
  photo: '',
  line: '',
  colour: CAT_COLOURS[0].token as Colour,
}

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function RecordCat({ onRecorded }: { onRecorded: () => void }) {
  const { map, isLoaded, placing, setPlacing } = useMap()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [radiusM, setRadiusM] = useState(90)
  const [error, setError] = useState<string | null>(null)
  /* Read once per open rather than held in state: the number only changes
     through this panel, and the panel re-mounts its own body each time. */
  const [recorded, setRecorded] = useState(0)

  const reset = () => {
    setForm(EMPTY)
    setCenter(null)
    setRadiusM(90)
    setError(null)
    setPlacing(false)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  // Escape closes, the same courtesy the plate and the mobile panel give.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      /* Placing first: Escape while aiming should put the map back, not
         throw away a half-filled form. Two presses to leave, and the first
         one is the one you meant. */
      if (placing) setPlacing(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, placing, setPlacing])

  /* The click that places the point. `once`, so the map goes back to being a
     map straight after: a mode you have to remember to leave is the thing
     people press Escape at. preventDefault is the second belt, Territories'
     own `placing` guard being the first. */
  useEffect(() => {
    if (!map || !placing) return
    document.body.dataset.placing = 'true'
    const onClick = (e: MapMouseEvent) => {
      e.preventDefault()
      setCenter([e.lngLat.lng, e.lngLat.lat])
      setPlacing(false)
      setError(null)
    }
    map.once('click', onClick)
    return () => {
      delete document.body.dataset.placing
      map.off('click', onClick)
    }
  }, [map, placing, setPlacing])

  /* The preview circle: the same two layers a real territory gets, so what
     you are shown while choosing is what the map will look like afterwards.
     Added when the panel opens and torn down when it closes, rather than
     kept around empty, so a closed panel leaves no layers on the map. */
  useEffect(() => {
    if (!map || !isLoaded || !open) return
    if (!map.getSource(PREVIEW)) {
      map.addSource(PREVIEW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: PREVIEW_FILL,
        type: 'fill',
        source: PREVIEW,
        paint: { 'fill-color': token('--rust'), 'fill-opacity': 0.28 },
      })
      map.addLayer({
        id: PREVIEW_LINE,
        type: 'line',
        source: PREVIEW,
        paint: {
          'line-color': token('--rust'),
          'line-width': 1.5,
          // Dashed, like a real territory's boundary, and unlike anything
          // else on the map: this is a proposal, not a record.
          'line-dasharray': [2, 2],
        },
      })
    }
    return () => {
      for (const id of [PREVIEW_LINE, PREVIEW_FILL]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(PREVIEW)) map.removeSource(PREVIEW)
    }
  }, [map, isLoaded, open])

  // Live: every radius step and every re-placed point redraws the ring, and
  // the colour swatch repaints it, so the choice is made against the map
  // rather than against a form.
  useEffect(() => {
    if (!map || !open) return
    const source = map.getSource(PREVIEW) as GeoJSONSource | undefined
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features: center
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [circleRing(center, radiusM)] },
            },
          ]
        : [],
    })
    if (map.getLayer(PREVIEW_FILL)) {
      map.setPaintProperty(PREVIEW_FILL, 'fill-color', token(form.colour))
      map.setPaintProperty(PREVIEW_LINE, 'line-color', token(form.colour))
    }
  }, [map, open, center, radiusM, form.colour])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    /* The point is the one field with no input behind it, so it is the one
       field the browser cannot check. Everything else is `required` on a
       real input and is the platform's problem, not this component's. */
    if (!center) {
      setError('Place the territory on the map first.')
      return
    }
    const cat = await addCat({ ...form, center, radiusM })
    if (!cat) {
      setError('Could not save. This browser may have storage turned off.')
      return
    }
    onRecorded()
    close()
  }

  return (
    <>
      <motion.button
        type="button"
        className="record-open"
        aria-label="Record a cat"
        data-open={String(open)}
        onClick={() => {
          if (open) return close()
          setRecorded(countRecorded())
          setOpen(true)
        }}
        whileTap={{ scale: 0.94 }}
        transition={spring}
      >
        <Plus size={15} />
        <span>Record a cat</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.form
            className="record"
            onSubmit={submit}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={springSoft}
            aria-label="Record a cat"
          >
            <div className="record-head">
              <h2>New record</h2>
              <button type="button" className="record-close" aria-label="Cancel" onClick={close}>
                <X size={15} />
              </button>
            </div>

            <div className="record-body">
              <label className="record-field">
                <span className="record-label">Name</span>
                <input
                  className="record-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Mingming"
                  maxLength={40}
                  required
                  autoFocus
                />
              </label>

              <label className="record-field">
                <span className="record-label">Description</span>
                <input
                  className="record-input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Grey tabby · white socks · male, est. 2 yrs"
                  maxLength={90}
                  required
                />
              </label>

              {/* type="url" so the browser rejects a pasted filename before
                  this ever reaches storage. Required, and that is a real v1
                  limit rather than an oversight: there is no server to
                  upload a photograph to, so a link is the only photo this
                  version can hold. */}
              <label className="record-field">
                <span className="record-label">Photo link</span>
                <input
                  className="record-input"
                  type="url"
                  value={form.photo}
                  onChange={(e) => setForm({ ...form, photo: e.target.value })}
                  placeholder="https://…"
                  required
                />
              </label>

              <label className="record-field">
                <span className="record-label">Field note</span>
                <textarea
                  className="record-input"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="One thing you noticed that is not a measurement."
                  maxLength={220}
                  rows={2}
                />
              </label>

              <fieldset className="record-field record-colours">
                <legend className="record-label">Territory colour</legend>
                {COLOURS.map(({ token: name, label }) => (
                  <button
                    key={name}
                    type="button"
                    className="record-swatch"
                    style={{ '--swatch': `var(${name})` } as React.CSSProperties}
                    data-on={String(form.colour === name)}
                    aria-pressed={form.colour === name}
                    onClick={() => setForm({ ...form, colour: name })}
                  >
                    <span aria-hidden />
                    {label}
                  </button>
                ))}
              </fieldset>

              <div className="record-field">
                <span className="record-label">Territory</span>
                <button
                  type="button"
                  className="record-place"
                  data-on={String(placing)}
                  onClick={() => setPlacing(!placing)}
                >
                  <MapPin size={13} />
                  {placing
                    ? 'Click the map…'
                    : center
                      ? `${center[1].toFixed(4)}, ${center[0].toFixed(4)}`
                      : 'Place on the map'}
                </button>

                {/* Native range input, so the drag, the keyboard steps and
                    the touch target are all the platform's. */}
                <label className="record-radius">
                  <span>Rough size</span>
                  <input
                    type="range"
                    min={MIN_RADIUS}
                    max={MAX_RADIUS}
                    step={10}
                    value={radiusM}
                    onChange={(e) => setRadiusM(Number(e.target.value))}
                    disabled={!center}
                  />
                  <span className="record-radius-value">{radiusM * 2} m</span>
                </label>
              </div>

              {/* aria-live, because a submit that goes nowhere with a message
                  appearing somewhere is indistinguishable from a broken
                  button to anyone not looking at that spot. */}
              {error && (
                <p className="record-error" role="alert" aria-live="polite">
                  {error}
                </p>
              )}
            </div>

            <div className="record-foot">
              <span className="record-note">
                Saved in this browser only.
                {recorded > 0 && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="record-clear"
                      onClick={() => {
                        clearRecorded()
                        setRecorded(0)
                        onRecorded()
                      }}
                    >
                      Clear {recorded} recorded
                    </button>
                  </>
                )}
              </span>
              <button type="submit" className="record-save">
                Record
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  )
}
