import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { MapPin, Plus, X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { addCat, clearRecorded, countRecorded } from '@/data/catsRepo'
import { CAT_COLOURS, type Colour } from '@/data/cats.seed'
import { SHAPES, shapeRing, type Shape } from '@/data/localCats'
import { compressImage } from './imageToDataUrl'
import { spring, springSoft } from '@/motion/springs'

/* Add a new cat: the panel that adds one to the survey.

   ## Parked, on purpose, and not dead

   This is the ADMIN's tool and it is currently not mounted anywhere. See
   MapCanvas, where its render was replaced by ui/ReportSighting.tsx.

   Adding a cat is a reviewed action: an open "add a cat" on a public map is
   unreviewed data about real animals. Until there are accounts and somebody
   to do the reviewing, a visitor's only contribution is a sighting. Mount
   this again behind the role check and nothing else about it has to change.

   Do not delete it on the grounds that nothing imports it. That is the
   state it is meant to be in.

   ## Four steps, not one long form

   Rev 2026-08-26: guided description questions, an upload gallery and a
   shape picker together made the original single-page form long enough
   that "too long" stopped being a nitpick. Each step keeps its own local
   validation; the one check with no input behind it (a territory must be
   placed) still lives on final submit, same as it always did.

   ## The territory is drawn, not typed

   You click the map to say roughly where the cat lives and drag a radius
   around it; what gets stored is one of four warped-circle polygons (see
   data/localCats.ts's shapeRing). This is not a nicety: spec §9 forbids
   this app from holding an exact location for a real animal, and a form
   with a "location" box in it is exactly how that rule gets broken by
   accident.

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

/** The longest edge and JPEG quality every uploaded photo is compressed
    to, matching the seeded photos' own size (data/cats.seed.ts's CATAAS
    helper). Not a knob a user sees, see ui/imageToDataUrl.ts's own note
    on why this is load-bearing rather than tunable polish. */
const PHOTO_MAX_DIM = 640
const PHOTO_QUALITY = 0.75
const MAX_EXTRA_PHOTOS = 6

const COLOURS = CAT_COLOURS

const STEPS = ['Photo', 'Identity', 'Character & look', 'Place & review'] as const

type ExtraPhoto = { id: string; src: string }

const EMPTY_FORM = {
  name: '',
  description: '',
  note: '',
  photo: '',
  line: '',
  colour: CAT_COLOURS[0].token as Colour,
  shape: 'round' as Shape,
}

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function RecordCat({ onRecorded }: { onRecorded: () => void }) {
  const { map, isLoaded, placing, setPlacing } = useMap()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY_FORM)
  const [extraPhotos, setExtraPhotos] = useState<ExtraPhoto[]>([])
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [radiusM, setRadiusM] = useState(90)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recorded, setRecorded] = useState(0)

  const reset = () => {
    setStep(0)
    setForm(EMPTY_FORM)
    setExtraPhotos([])
    setCenter(null)
    setRadiusM(90)
    setError(null)
    setPlacing(false)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placing) setPlacing(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, placing, setPlacing])

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
          'line-dasharray': [2, 2],
        },
      })
    }
    return () => {
      for (const id of [PREVIEW_LINE, PREVIEW_FILL]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(PREVIEW)) map.removeSource(PREVIEW)
    }
  }, [map, isLoaded, open])

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
              geometry: { type: 'Polygon', coordinates: [shapeRing(form.shape, center, radiusM)] },
            },
          ]
        : [],
    })
    if (map.getLayer(PREVIEW_FILL)) {
      map.setPaintProperty(PREVIEW_FILL, 'fill-color', token(form.colour))
      map.setPaintProperty(PREVIEW_LINE, 'line-color', token(form.colour))
    }
  }, [map, open, center, radiusM, form.shape, form.colour])

  const pickMainPhoto = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const compressed = await compressImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
      setForm((f) => ({ ...f, photo: compressed }))
    } catch {
      setError('Could not read that photo. Try a different file.')
    }
  }

  const pickExtraPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    const room = MAX_EXTRA_PHOTOS - extraPhotos.length
    const picked = Array.from(files).slice(0, room)
    try {
      const compressed = await Promise.all(picked.map((file) => compressImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY)))
      setExtraPhotos((prev) => [
        ...prev,
        ...compressed.map((src, i) => ({ id: `${Date.now()}-${i}`, src })),
      ])
    } catch {
      setError('Could not read one of those photos. Try again.')
    }
  }

  const removeExtraPhoto = (id: string) => {
    setExtraPhotos((prev) => prev.filter((photo) => photo.id !== id))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!center) {
      setError('Place the territory on the map first.')
      return
    }
    setBusy(true)
    const cat = await addCat({
      ...form,
      center,
      radiusM,
      extraPhotos: extraPhotos.map((photo) => photo.src),
    })
    setBusy(false)
    if (!cat) {
      setError('Could not save. This browser may have storage turned off.')
      return
    }
    onRecorded()
    close()
  }

  const canAdvance = step === 0 ? !!form.photo : true
  const isLastStep = step === STEPS.length - 1

  return (
    <>
      <motion.button
        type="button"
        className="record-open"
        aria-label="Add a new cat"
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
        <span>Add a new cat</span>
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
            aria-label="Add a new cat"
          >
            <div className="record-head">
              <h2>New cat — {STEPS[step]}</h2>
              <button type="button" className="record-close" aria-label="Cancel" onClick={close}>
                <X size={15} />
              </button>
            </div>

            <div className="record-progress" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
              {STEPS.map((label, i) => (
                <span key={label} data-on={String(i === step)} aria-label={label} />
              ))}
            </div>

            <div className="record-body">
              {step === 0 && (
                <>
                  <label className="record-field">
                    <span className="record-label">Photo</span>
                    <div className="record-photo-row">
                      {form.photo && <img className="record-thumb" src={form.photo} alt="" />}
                      <input
                        className="record-file"
                        type="file"
                        accept="image/*"
                        required={!form.photo}
                        onChange={(e) => pickMainPhoto(e.target.files?.[0])}
                      />
                    </div>
                  </label>

                  <div className="record-field">
                    <span className="record-label">More photos (optional)</span>
                    <div className="record-gallery">
                      {extraPhotos.map((photo) => (
                        <div key={photo.id} className="record-gallery-item">
                          <img src={photo.src} alt="" />
                          <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => removeExtraPhoto(photo.id)}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                      {extraPhotos.length < MAX_EXTRA_PHOTOS && (
                        <label className="record-gallery-add">
                          <Plus size={16} />
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => pickExtraPhotos(e.target.files)}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </>
              )}

              {step === 1 && <p className="record-note">Step 2 lands in the next task.</p>}
              {step === 2 && <p className="record-note">Step 3 lands in the next task.</p>}
              {step === 3 && (
                <>
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
                </>
              )}

              {error && (
                <p className="record-error" role="alert" aria-live="polite">
                  {error}
                </p>
              )}
            </div>

            <div className="record-foot">
              {step > 0 ? (
                <button type="button" className="record-back" onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              ) : (
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
              )}
              {isLastStep ? (
                <button type="submit" className="record-save" disabled={busy}>
                  {busy ? 'Saving…' : 'Add cat'}
                </button>
              ) : (
                <button
                  type="button"
                  className="record-save"
                  disabled={!canAdvance}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next
                </button>
              )}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  )
}
