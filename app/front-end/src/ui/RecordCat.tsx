import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { MapPin, Plus, X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { nearestPlaceName } from '@/map/landmark'
import { addCat, clearRecorded, countRecorded } from '@/data/catsRepo'
import { subscribeAuth } from '@/data/auth'
import { CAT_COLOURS, type Colour } from '@/data/cats.seed'
import {
  AGES,
  composeDescription,
  EMPTY_ANSWERS,
  FUR_COLOURS,
  MARKS,
  PATTERNS,
  SEXES,
  UNKNOWN,
  type CoatAnswers,
} from '@/data/describeCat'
import { SHAPES, shapePreviewPoints, shapeRing, type Shape } from '@/data/territoryShape'
import { addChip, BUILTIN_NOTE_CHIPS, readChips } from '@/data/noteChips'
import { compressImageToBlob, PHOTO_MAX_DIM, PHOTO_QUALITY } from './imageToDataUrl'
import { uploadPhoto } from '@/data/photoUpload'
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

/** Not a knob a user sees; see ui/imageToDataUrl.ts's own note on
    PHOTO_MAX_DIM/PHOTO_QUALITY for why this is load-bearing rather than
    tunable polish. */
const MAX_EXTRA_PHOTOS = 6

const COLOURS = CAT_COLOURS

/* Visual swatches for the fur colour and pattern questions (Step 2): a
   plain text pill left an admin guessing what "Tricolor" or "Colorpoint"
   actually look like next to "Tabby". Both maps key off the exact option
   strings FUR_COLOURS/PATTERNS already export from data/describeCat.ts,
   with an explicit fallback to the "don't know" swatch rather than
   rendering nothing for a string that doesn't match, so a future option
   added to one list without a matching class here degrades to a visible
   placeholder instead of a silently blank pill. */
const FUR_SWATCH_CLASS: Record<string, string> = {
  Black: 'fur-black',
  Grey: 'fur-grey',
  'Orange/Ginger': 'fur-orange',
  White: 'fur-white',
  Brown: 'fur-brown',
  'Calico/Mixed': 'fur-mixed',
}
const PATTERN_SWATCH_CLASS: Record<string, string> = {
  Solid: 'pat-solid',
  Tabby: 'pat-tabby',
  Tuxedo: 'pat-tuxedo',
  Tricolor: 'pat-tricolor',
  Tortoiseshell: 'pat-tortoiseshell',
  Colorpoint: 'pat-colorpoint',
}

const STEPS = ['Photo', 'Identity', 'Character & look', 'Place & review'] as const

/** `src` is a local `blob:` object URL for the live thumbnail, not a
    Storage URL — see the note above pickMainPhoto on why upload is
    deferred to submit time. `blob` is what actually gets uploaded then. */
type ExtraPhoto = { id: string; blob: Blob; src: string }

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

/** A small SVG trace of what a territory shape actually draws, built from
    shapePreviewPoints, the same per-shape data shapeRing uses to draw the
    real polygon on the map. A generic circle/blob/square icon would have
    been a second, unrelated guess at what "Notched" or "Ragged" look like;
    this is the real outline, just too small to place on a map. */
function ShapePreview({ shape }: { shape: Shape }) {
  const points = shapePreviewPoints(shape)
    .map(([x, y]) => `${(x * 9 + 11).toFixed(1)},${(y * 9 + 11).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="record-shape-preview" viewBox="0 0 22 22" width="22" height="22" aria-hidden>
      <polygon points={points} />
    </svg>
  )
}

function SingleChoice({
  label,
  options,
  value,
  onChange,
  swatch,
}: {
  label: string
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  /** Renders a small visual indicator before an option's text, e.g. a
      colour dot or a pattern-filled tile. Optional: Sex has no meaningful
      visual for "Male"/"Female" and just omits this, same plain-text pill
      as before. */
  swatch?: (option: string) => React.ReactNode
}) {
  return (
    <fieldset className="record-field record-colours">
      <legend className="record-label">{label}</legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="record-pill"
          data-on={String(value === option)}
          onClick={() => onChange(option)}
        >
          {swatch?.(option)}
          {option}
        </button>
      ))}
    </fieldset>
  )
}

export function RecordCat({ onRecorded }: { onRecorded: () => void }) {
  const { map, isLoaded, placing, setPlacing } = useMap()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY_FORM)
  const [extraPhotos, setExtraPhotos] = useState<ExtraPhoto[]>([])
  const [answers, setAnswers] = useState<CoatAnswers>(EMPTY_ANSWERS)
  const [customMark, setCustomMark] = useState('')
  const [showCustomMark, setShowCustomMark] = useState(false)
  const [myChips, setMyChips] = useState<string[]>([])
  const [customChip, setCustomChip] = useState('')
  const [showCustomChip, setShowCustomChip] = useState(false)
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [radiusM, setRadiusM] = useState(90)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recorded, setRecorded] = useState(0)
  /* Who is signed in, phase 9: RecordCat is only ever mounted behind
     App.tsx's admin gate, so this is practically always non-null by the
     time the form is reachable, but the field is read fresh here rather
     than trusted from a prop because addCat's authorUid has to name the
     actual writer, not whoever held the gate open when the panel opened. */
  const [uid, setUid] = useState<string | null>(null)
  useEffect(() => subscribeAuth((user) => setUid(user?.uid ?? null)), [])
  /* The compressed Blob behind form.photo's preview URL, kept out of `form`
     because it is never one of CatDraft's fields itself — submit() uploads
     it and puts the resulting Storage URL in the draft instead. See the
     note above pickMainPhoto for why upload waits until then. */
  const [mainPhotoBlob, setMainPhotoBlob] = useState<Blob | null>(null)
  /* A count of compressions currently in flight, not a boolean: the main
     photo and the extra-photos gallery are two independent pickers on the
     same screen (pickMainPhoto/pickExtraPhotos below), each reachable
     while the other is still mid-compress, and pickExtraPhotos itself
     compresses several files at once via Promise.all. A boolean set
     true-then-false around each call would have the last one to *start*
     clear it the moment it, alone, finishes, even while its siblings are
     still running, which is exactly the silently-dropped-photo bug a
     review caught here (back when this counted uploads rather than
     compressions). The count only reaches zero once every compression
     that started has actually finished (its own `finally` decrements it),
     so "processing" is simply `photosProcessing > 0`. Decoding and
     redrawing a large phone photo to canvas is not instant, and Next/Add
     cat must not be pressable while a photo the submit is about to read
     is still only partially compressed. */
  const [photosProcessing, setPhotosProcessing] = useState(0)
  const photoProcessing = photosProcessing > 0

  const reset = () => {
    /* Every preview is a blob: object URL, never uploaded to Storage until
       submit actually ran (see pickMainPhoto's note). Revoking them here
       covers every exit — cancel, Escape, and a successful submit's own
       close() — so an abandoned or finished wizard leaks no object URLs,
       the same way it now leaks no orphaned Storage files either. */
    if (form.photo) URL.revokeObjectURL(form.photo)
    for (const photo of extraPhotos) URL.revokeObjectURL(photo.src)
    setStep(0)
    setForm(EMPTY_FORM)
    setMainPhotoBlob(null)
    setExtraPhotos([])
    setAnswers(EMPTY_ANSWERS)
    setCustomMark('')
    setShowCustomMark(false)
    setCustomChip('')
    setShowCustomChip(false)
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
    setForm((f) => ({ ...f, description: composeDescription(answers) }))
  }, [answers])

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

  /* The preview shape: the same two layers a real territory gets, so what
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

  /* Pickers compress and preview locally; neither one touches Storage.
     Uploading here, at pick time, used to mean every file chosen became a
     permanent Storage object immediately, whether or not the wizard was
     ever finished — a cancelled panel, a re-picked photo, or (as found
     2026-08-28) a save that failed after upload all left orphans behind,
     with no way to clean them up (storage.rules forbids client delete on
     purpose). Uploading is now deferred to submit(), the one place that is
     about to write the cat doc, so nothing reaches Storage unless a save
     is actually happening. The trade: a save that fails *after* its
     uploads succeed can still leave an orphan, but that is now the rare
     case instead of the common one. */
  const pickMainPhoto = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setPhotosProcessing((n) => n + 1)
    try {
      const blob = await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
      if (form.photo) URL.revokeObjectURL(form.photo)
      setMainPhotoBlob(blob)
      setForm((f) => ({ ...f, photo: URL.createObjectURL(blob) }))
    } catch {
      setError('Could not read that photo. Try a different file.')
    } finally {
      setPhotosProcessing((n) => n - 1)
    }
  }

  const pickExtraPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    const room = MAX_EXTRA_PHOTOS - extraPhotos.length
    const picked = Array.from(files).slice(0, room)
    try {
      /* Each photo in the batch counts itself in and out of
         photosProcessing individually, not the Promise.all as a whole:
         compress time varies per file, and the count must stay above zero
         for as long as ANY of them is still running, not just until the
         fastest one resolves. */
      const compressed = await Promise.all(
        picked.map(async (file) => {
          setPhotosProcessing((n) => n + 1)
          try {
            const blob = await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
            return { blob, src: URL.createObjectURL(blob) }
          } finally {
            setPhotosProcessing((n) => n - 1)
          }
        })
      )
      setExtraPhotos((prev) => [...prev, ...compressed.map((photo, i) => ({ id: `${Date.now()}-${i}`, ...photo }))])
    } catch {
      setError('Could not read one of those photos. Try again.')
    }
  }

  const removeExtraPhoto = (id: string) => {
    setExtraPhotos((prev) => {
      const removed = prev.find((photo) => photo.id === id)
      if (removed) URL.revokeObjectURL(removed.src)
      return prev.filter((photo) => photo.id !== id)
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    /* The territory placement is the one field with no input behind it, so
       it is the one field the browser cannot check. Everything else is
       either `required` on a real input (photo, name) or gated on
       canAdvance before the wizard lets a step be left (description): this
       is the one condition neither of those covers. */
    if (!center) {
      setError('Place the territory on the map first.')
      return
    }
    /* canAdvance already keeps step 0 from being left without a main
       photo, so this only ever fires if that guard was somehow bypassed;
       kept as the actual gate rather than trusting the UI path, the same
       reason center's own check above exists. */
    if (!mainPhotoBlob) {
      setError('Add a photo first.')
      return
    }
    setBusy(true)
    /* The one place any of this reaches Storage, and only once we are
       actually about to write the cat doc — see the note above
       pickMainPhoto. A failure here is reported separately from a
       Firestore failure below: this one means nothing was saved and
       nothing (beyond this upload itself) was written anywhere. */
    let photoUrl: string
    let extraUrls: string[]
    try {
      ;[photoUrl, extraUrls] = await Promise.all([
        uploadPhoto(mainPhotoBlob, 'cats'),
        Promise.all(extraPhotos.map((photo) => uploadPhoto(photo.blob, 'cats'))),
      ])
    } catch {
      setBusy(false)
      setError('Could not upload the photos. Check your connection and try again.')
      return
    }
    /* The eyebrow's other half. The seeded cats each carry a real nearby
       place ("LINE 03 · TRACK 30TH"); the form never asks for one (see
       catsRepo.addCat's own note on not inventing a filing convention),
       so a recorded cat used to fall straight through to a literal
       fallback string every time. Same lookup Plate.tsx already uses for
       a cat's own "Near X" range line, run here against the point that
       was just placed: "Near " is stripped because the seeded convention
       names the place directly rather than prefixing it. Null when
       nothing named is within range (map/landmark.ts's SEARCH_RADIUS_M),
       which leaves draft.line empty and addCat's own "FIELD ENTRY"
       fallback fires instead. Only the place half travels down: the
       number in front of it is catsRepo.addCat's own job, the same way it
       already owns the plate number's count. */
    const place = map ? nearestPlaceName(map, center)?.replace(/^Near /, '') : null
    const cat = await addCat({
      ...form,
      photo: photoUrl,
      line: place ? place.toUpperCase() : form.line,
      center,
      radiusM,
      extraPhotos: extraUrls,
      /* RecordCat only ever mounts behind App.tsx's admin gate, so uid is
         non-null in practice by the time this form is reachable; the
         fallback empty string is here only so a stale/expired session
         cannot throw at submit instead of just recording an odd author. */
      authorUid: uid ?? '',
    })
    setBusy(false)
    if (!cat) {
      setError('Could not save. Check your connection and try again.')
      return
    }
    onRecorded()
    close()
  }

  const canAdvance = step === 0 ? !!mainPhotoBlob : step === 1 ? !!form.name.trim() && !!form.description : true
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
          void countRecorded().then(setRecorded)
          setMyChips(readChips())
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
            onKeyDown={(e) => {
              // Steps 0-2 mount no `type="submit"` button, but the implicit-
              // submission rule still fires on Enter through a single
              // text input (the name field, an inline "+ Custom"/"+ Add
              // your own" box). That would submit the record before the
              // later steps have even been visited, so Enter is blocked
              // on a text-like <input> specifically, not on every element:
              // a plain `!isLastStep` guard would also eat Enter's default
              // action on every button (Next included), the note
              // textarea's newline, and the file inputs' own picker, none
              // of which are implicit-submission risks in the first place
              // (a file input does not block implicit submission the way
              // a text field does, so it is excluded here too).
              const target = e.target
              if (
                e.key === 'Enter' &&
                !isLastStep &&
                target instanceof HTMLInputElement &&
                target.type !== 'file'
              ) {
                e.preventDefault()
              }
            }}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={springSoft}
            aria-label="Add a new cat"
          >
            <div className="record-head">
              <h2>New cat · {STEPS[step]}</h2>
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
                        required={!mainPhotoBlob}
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

              {step === 1 && (
                <>
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

                  <SingleChoice
                    label="Fur colour"
                    options={FUR_COLOURS}
                    value={answers.furColour}
                    onChange={(furColour) => setAnswers((a) => ({ ...a, furColour }))}
                    swatch={(option) => (
                      <span
                        className={`record-swatch-dot ${FUR_SWATCH_CLASS[option] ?? 'fur-unknown'}`}
                        aria-hidden
                      />
                    )}
                  />
                  <SingleChoice
                    label="Pattern"
                    options={PATTERNS}
                    value={answers.pattern}
                    onChange={(pattern) => setAnswers((a) => ({ ...a, pattern }))}
                    swatch={(option) => (
                      <span
                        className={`record-swatch-tile ${PATTERN_SWATCH_CLASS[option] ?? 'pat-unknown'}`}
                        aria-hidden
                      />
                    )}
                  />

                  <fieldset className="record-field record-colours">
                    <legend className="record-label">Distinguishing marks</legend>
                    {MARKS.map((mark) => (
                      <button
                        key={mark}
                        type="button"
                        className="record-pill"
                        data-on={String(answers.marks.includes(mark))}
                        onClick={() =>
                          setAnswers((a) => ({
                            ...a,
                            marks: a.marks.includes(mark) ? a.marks.filter((m) => m !== mark) : [...a.marks, mark],
                          }))
                        }
                      >
                        {mark}
                      </button>
                    ))}
                    {answers.marks
                      .filter((mark) => !(MARKS as readonly string[]).includes(mark))
                      .map((mark) => (
                        <button
                          key={mark}
                          type="button"
                          className="record-pill"
                          data-on="true"
                          onClick={() => setAnswers((a) => ({ ...a, marks: a.marks.filter((m) => m !== mark) }))}
                        >
                          {mark}
                        </button>
                      ))}
                    <button type="button" className="record-pill record-pill-add" onClick={() => setShowCustomMark(true)}>
                      + Custom
                    </button>
                  </fieldset>
                  {showCustomMark && (
                    <div className="record-inline-add">
                      <input
                        className="record-input"
                        value={customMark}
                        onChange={(e) => setCustomMark(e.target.value)}
                        placeholder='e.g. "kinked tail"'
                        maxLength={30}
                      />
                      <button
                        type="button"
                        className="record-save"
                        onClick={() => {
                          const value = customMark.trim()
                          if (value) {
                            setAnswers((a) => ({
                              ...a,
                              marks: a.marks.includes(value) ? a.marks : [...a.marks, value],
                            }))
                          }
                          setCustomMark('')
                          setShowCustomMark(false)
                        }}
                      >
                        Add
                      </button>
                    </div>
                  )}

                  <SingleChoice
                    label="Sex"
                    options={SEXES}
                    value={answers.sex}
                    onChange={(sex) => setAnswers((a) => ({ ...a, sex }))}
                  />

                  <fieldset className="record-field record-colours">
                    <legend className="record-label">Age</legend>
                    {AGES.map(({ id, hint }) => (
                      <button
                        key={id}
                        type="button"
                        className="record-pill"
                        data-on={String(answers.age === id)}
                        onClick={() => setAnswers((a) => ({ ...a, age: id }))}
                      >
                        {id}
                        {hint && <small>{hint}</small>}
                      </button>
                    ))}
                  </fieldset>

                  <p className="record-preview">
                    Description: <strong>{form.description || '·'}</strong>
                  </p>
                </>
              )}
              {step === 2 && (
                <>
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

                  <div className="record-field record-colours">
                    {BUILTIN_NOTE_CHIPS.map((phrase) => (
                      <button
                        key={phrase}
                        type="button"
                        className="record-pill"
                        onClick={() => setForm((f) => ({ ...f, note: f.note ? `${f.note} ${phrase}.` : `${phrase}.` }))}
                      >
                        {phrase}
                      </button>
                    ))}
                    {myChips.map((phrase) => (
                      <button
                        key={phrase}
                        type="button"
                        className="record-pill record-pill-mine"
                        onClick={() => setForm((f) => ({ ...f, note: f.note ? `${f.note} ${phrase}.` : `${phrase}.` }))}
                      >
                        {phrase}
                      </button>
                    ))}
                    <button type="button" className="record-pill record-pill-add" onClick={() => setShowCustomChip(true)}>
                      + Add your own
                    </button>
                  </div>
                  {showCustomChip && (
                    <div className="record-inline-add">
                      <input
                        className="record-input"
                        value={customChip}
                        onChange={(e) => setCustomChip(e.target.value)}
                        placeholder="A phrase you use often…"
                        maxLength={60}
                      />
                      <button
                        type="button"
                        className="record-save"
                        onClick={() => {
                          const phrase = customChip.trim()
                          const saved = addChip(phrase)
                          if (saved) setMyChips(saved)
                          if (phrase) {
                            setForm((f) => ({ ...f, note: f.note ? `${f.note} ${phrase}.` : `${phrase}.` }))
                          }
                          setCustomChip('')
                          setShowCustomChip(false)
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}

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

                  <fieldset className="record-field record-colours">
                    <legend className="record-label">Territory shape</legend>
                    {SHAPES.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className="record-pill"
                        data-on={String(form.shape === id)}
                        onClick={() => setForm({ ...form, shape: id })}
                      >
                        <ShapePreview shape={id} />
                        {label}
                      </button>
                    ))}
                  </fieldset>
                </>
              )}
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

                  <div className="record-summary">
                    <p>
                      <strong>{form.name || 'Unnamed'}</strong> · {form.description || 'no description yet'}
                    </p>
                    <p>
                      {SHAPES.find((s) => s.id === form.shape)?.label} territory,{' '}
                      {COLOURS.find((c) => c.token === form.colour)?.label} ·{' '}
                      {1 + extraPhotos.length} photo{extraPhotos.length === 0 ? '' : 's'}
                    </p>
                  </div>
                </>
              )}

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
              {/* Two corrections to the note on step 0, both from the same
                  cause: since phase 9 a recorded cat is a document in the
                  shared `cats` collection, not a row in one browser's
                  storage. The note said the opposite, and the button beside
                  it, which reads like clearing a local scratchpad, in fact
                  deletes every admin's recorded cat for every visitor,
                  permanently, on a single press. So the note now says who
                  can see this, and the press now asks first: a confirm is
                  the least this deserves, and the count in the message is
                  what makes "clear" read as the number of records it is
                  about to destroy. */}
              {step > 0 ? (
                <button type="button" className="record-back" onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              ) : (
                <span className="record-note">
                  Shared with every visitor once saved.
                  {recorded > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="record-clear"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete all ${recorded} recorded cats, for everyone? This cannot be undone.`
                            )
                          ) {
                            return
                          }
                          void clearRecorded().then(() => {
                            setRecorded(0)
                            onRecorded()
                          })
                        }}
                      >
                        Clear {recorded} recorded
                      </button>
                    </>
                  )}
                </span>
              )}
              {isLastStep ? (
                <button type="submit" className="record-save" disabled={busy || photoProcessing}>
                  {busy ? 'Saving…' : 'Add cat'}
                </button>
              ) : (
                <button
                  type="button"
                  className="record-save"
                  disabled={!canAdvance || photoProcessing}
                  onClick={() => setStep((s) => s + 1)}
                >
                  {photoProcessing ? 'Processing…' : 'Next'}
                </button>
              )}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  )
}
