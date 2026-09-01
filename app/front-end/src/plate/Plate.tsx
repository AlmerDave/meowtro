import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Lock,
  LogIn,
  MapPin,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import {
  addAdminPhoto,
  deleteCat,
  deleteSighting,
  listPendingForCat,
  listSightings,
  reorderSighting,
  reviewSighting,
  updateCat,
  voteSighting,
  withdrawSighting,
  type Cat,
  type CatPatch,
} from '@/data/catsRepo'
import type { FeatureCollection, Polygon } from 'geojson'
import { signInWithGoogle } from '@/data/auth'
import { CAT_COLOURS, photoAt, THUMB_PX, type Colour } from '@/data/cats.seed'
import { describeWhen, distanceM, ringRadiusM, type Sighting } from '@/data/sightings'
import { ringCentroid } from '@/map/centroid'
import { CardStack, type StackCard } from '@/components/ui/card-stack'
import { TerritoryGlyph } from '@/plate/TerritoryGlyph'
import { Specular } from '@/ui/Specular'
import { useEscape } from '@/ui/escape'
import { compressImageToBlob, PHOTO_MAX_DIM, PHOTO_QUALITY } from '@/ui/imageToDataUrl'
import { uploadPhoto } from '@/data/photoUpload'
import { spring, springSoft } from '@/motion/springs'

/* The specimen plate. Motion owns the enter *and the exit* — the exit
   is the whole reason this library is here (React unmounts a component before
   you can animate it). App.tsx keeps the <AnimatePresence>; this file must
   stay conditionally mounted for the exit to ever run. No CSS transition on
   .plate: two owners of one animation is exactly the class of bug phase 4
   spent a session on.

   The hero photo carries layoutId="cat-photo-<id>", the same id the rail's
   thumbnail carries (ui/CatRow.tsx). That is the one bold move in the
   redesign: the photo is a single object that travels between the two, so the
   card visibly comes from the row you pressed instead of sliding in from
   off-screen with no stated origin.

   ## The 3D view was removed, and its code was not

   The Photo/3D toggle is gone (user direction, 2026-08-23) and with it the
   only route to plate/CatFigure.tsx, plate/FigureBoundary.tsx and cat.glb.
   Those files are all still here and still work; nothing imports them. Do
   not delete them on the grounds that nothing does, and do not delete the
   .plate-views rules in shell.css either, which are parked for the same
   reason and carry the same note.

   It is also the largest single performance change this file has had: the
   toggle lazy-loaded roughly a megabyte of three.js on first press, and
   with no toggle that chunk is never requested at all.

   The hero photo is now unconditional, which is a simplification rather
   than a loss: it used to stay mounted at opacity 0 underneath the model so
   that its layoutId always had a live element to morph back into on close,
   and with nothing to hide behind, that whole dance goes.

   ## Admin editing, phase 8's role gate extended to the record itself

   Everything below `admin` is one component reused twice rather than
   written twice: this file is the plate for both the desktop rail and
   ui/CatDeck's mobile sheet (see the note in App.tsx), so a control added
   here is already on both surfaces. Gated on the prop, not a CSS class —
   a non-admin's DOM has no edit affordance in it to find, not merely one
   hidden by a stylesheet. */

type Props = {
  cat: Cat
  onClose: () => void
  /** Report having seen this cat. Optional because the plate is a record
      first: it renders perfectly well somewhere that cannot accept a
      sighting, and the button simply is not drawn. */
  onReport?: (catId: string) => void
  /** Whether this visitor is holding the admin gate open (App.tsx's
      useAdmin). Everything under "Admin" below is gated on this alone. */
  admin?: boolean
  /** The signed-in visitor's own uid (App.tsx's useUid), phase 9. Threaded
      into catsRepo's listSightings, listPendingForCat, withdrawSighting,
      voteSighting and addAdminPhoto below, the functions that actually
      take it. Optional, unlike the App.tsx and CatDeck.tsx call sites
      which always supply it: the styleguide's specimen plate
      (Styleguide.tsx) has no signed-in visitor to speak of and renders one
      with nothing behind this prop at all, so every call site below falls
      back to `uid ?? ''` or `uid ?? null` rather than assuming a string. */
  uid?: string | null
  /** Whether this viewer may see accurate locations, i.e. admin or an
      approved feeder (App.tsx's canSeePrecise, spec 2026-09-01). When
      false the cat on screen is decoy-placed: the Range block and the
      coordinates row become a "feeder-only" lock, and the "I saw this one
      here" button is replaced by the same line, since a point tapped on a
      decoy map is unusable. Optional and defaults true so the styleguide's
      specimen plate (no App behind it) renders its full record. */
  canSeePrecise?: boolean
  /** Told to re-read cats and territories after an edit or delete, since
      either can change what the rest of the app is showing: a renamed cat
      in the rail, a corrected lastSeen, a deleted cat's territory on the
      map. The same refresh RecordCat already triggers on a new record
      (App.tsx's onRecorded) — editing an existing one needs exactly the
      same door back in. */
  onChanged?: () => void
  /** App.tsx's own refresh counter (its `loadToken`), bumped by every
      `onChanged` anywhere in the app — including ReportSighting.tsx's
      flow, which sits outside this component entirely and used to leave
      an already-open plate showing a stale sighting list until it was
      closed and reopened. Read only to force loadSightings below to run
      again; the number itself means nothing here. Optional so the
      styleguide's specimen plate (no App.tsx behind it) can render
      without one. */
  loadToken?: number
  /** The live territory shapes — the same FeatureCollection App.tsx already
      fetches for the map (catsRepo's listTerritories, which applies
      translateToward for the newest approved sighting). Read here for
      catRing/describeReach and forwarded straight to TerritoryGlyph, so
      the diagram, the "outside the known range" sentence and the actual
      map can never disagree about which polygon "the territory" currently
      means. */
  territories: FeatureCollection<Polygon>
  /** The live map's own answer to "what's nearest to this point", from
      App.tsx's MapInstanceBridge — Plate sits outside <MapCanvas>'s tree
      and cannot reach the MapLibre instance any other way. Forwarded
      straight to TerritoryGlyph, the one place it's actually used: the
      "N m across, near X" line under the shape is computed fresh on every
      render off the glyph's own live centre, nothing here writes it
      anywhere, so Plate itself has nothing to do with the result besides
      passing the function down. */
  nearestPlaceName?: (point: [number, number]) => string | null
}

const body = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.045, delayChildren: 0.14 } },
}
const line = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: spring },
}

/** One pencil, reused for every editable field. Its mere presence in the
    DOM is already gated by the caller (`editing &&`), so this component
    itself carries no admin check of its own. */
function FieldPencil({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="admin-pencil" aria-label={`Edit ${label}`} onClick={onClick}>
      <Pencil size={12} />
    </button>
  )
}

/** The inline editor a pencil opens: an input, a save, a cancel. Its own
    `draft` state, seeded from `value` at mount, is enough because it is
    only ever mounted while open — closing and reopening a field is a fresh
    mount with a fresh draft, so nothing has to reset it by hand. */
function FieldEditor({
  label,
  value,
  multiline,
  maxLength,
  busy,
  error,
  onSave,
  onCancel,
}: {
  label: string
  value: string
  multiline?: boolean
  maxLength: number
  busy: boolean
  error: string | null
  onSave: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <div className="admin-edit-row">
      {multiline ? (
        <textarea
          className="admin-edit-input"
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={label}
          autoFocus
        />
      ) : (
        <input
          className="admin-edit-input"
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={label}
          autoFocus
        />
      )}
      <button
        type="button"
        className="admin-edit-confirm"
        aria-label={`Save ${label}`}
        disabled={busy}
        onClick={() => onSave(draft)}
      >
        <Check size={12} />
      </button>
      <button type="button" className="admin-edit-cancel" aria-label="Cancel" onClick={onCancel} disabled={busy}>
        <X size={12} />
      </button>
      {error && (
        <p className="admin-edit-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function Plate({
  cat,
  onClose,
  onReport,
  admin = false,
  uid = null,
  canSeePrecise = true,
  onChanged,
  loadToken,
  territories,
  nearestPlaceName,
}: Props) {
  /* Three states, not a boolean. Copying can genuinely fail, see the
     handler, and a button that silently does nothing is worse than one
     that says so. */
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')

  /* Every sighting this plate is allowed to see (catsRepo.listSightings has
     the policy), fetched once as a flat list. Everything else the body
     needs from it — the photo pile, "your reports", the admin's manage
     list — is a memoized view over this one array rather than three
     separate fetches, so a refresh after an edit only has to reload one
     thing. `loadSightings` is exposed (not just run in an effect) because
     the admin actions below need to re-pull it on demand. */
  const [sightings, setSightings] = useState<Sighting[]>([])

  /* Every open report on this cat, oldest first, phase 9. Fetched for
     everyone, not only admin: the visitor-facing lock below reads it too,
     to know a report already exists and roughly where (pendingPlace,
     above) — the exact point itself only ever reaches the map's own ghost
     (map/Territories.tsx), not this list's own rendering. What differs by
     `admin` is the review controls drawn from this list, not whether it
     gets fetched (catsRepo.listPendingForCat has the same note). */
  const [pendingForCat, setPendingForCat] = useState<Sighting[]>([])

  const loadSightings = useCallback(() => {
    let live = true
    Promise.all([listSightings(cat.id, uid), listPendingForCat(cat.id, uid)]).then(([list, pending]) => {
      if (!live) return
      setSightings(list)
      setPendingForCat(pending)
    })
    return () => {
      live = false
    }
    /* loadToken is in this array for one reason: a report filed through
       ReportSighting.tsx, which lives outside this component and cannot
       call loadSightings directly, still bumps App.tsx's shared counter on
       success. Every action *inside* this plate already calls
       loadSightings() itself below; this is the one path in from outside
       it. */
  }, [cat.id, uid, loadToken])

  useEffect(() => loadSightings(), [loadSightings])

  /* The one open report everyone anchors to — the map's ghost and badge
     (map/Territories.tsx, map/CatMarkers.tsx) pick the same oldest one, so
     nothing on screen ever points at two different claims for one cat. */
  const oldestPending = pendingForCat[0] ?? null

  /* The live ring, read once and shared by describeReach below and
     TerritoryGlyph (passed down as its `ring` prop rather than looked up a
     second time there — see that file's own note on why). `territories`
     is the same live, post-translateToward FeatureCollection App.tsx
     already fetches for the map, not the frozen seed file: a sighting
     approved for this cat moves the shape both places read from the same
     source, so the diagram and the map cannot show two different
     territories for one cat. A cat with no entry yet (recorded but not
     reflected in this render's snapshot) degrades to undefined, and both
     describeReach and the glyph already treat that as "nothing drawn"
     rather than a stale shape. */
  const catRing = useMemo(() => {
    const feature = territories.features.find((f) => f.properties?.id === cat.id)
    return feature?.geometry.coordinates[0] as [number, number][] | undefined
  }, [cat.id, territories])

  /* What's actually nearest the shape's own centre, right now — computed
     live off catRing, never written anywhere. Memoised on catRing rather
     than recomputed inline: catRing's own identity is not a precise "this
     cat's shape actually moved" signal (App.tsx hands down a freshly
     fetched `territories` object on every admin action anywhere, seeded
     cat or not, so catRing's useMemo re-runs and returns a new array on
     each one even when this cat's own coordinates are unchanged) — but it
     is at least scoped to real state changes rather than every render, so
     nearestPlaceName's small scan over the map's currently-loaded
     pois/roads tiles (map/landmark.ts) only ever repeats on an actual
     cats/territories refetch, never on a vote cast or an unrelated field
     opened, neither of which touch `territories` at all. Tightening this
     further (a coordinate-based key, so it truly only reruns when THIS
     cat's ring changes) would cost a deep-equality check to save a cheap
     synchronous scan that only ever runs while an admin is already
     mid-action — not worth it yet.

     Deliberately not shown inside TerritoryGlyph's own caption: that
     caption sits in a fixed-width column sized for "270 M ACROSS" and a
     real street or landmark name can run well past it (shell.css's
     `.territory-glyph-span` is `white-space: nowrap` in a `flex-shrink: 0`
     box, for exactly the short caption it was written for) — rendered
     instead in .plate-range-text below, which already wraps normally. */
  const nearbyPlace = useMemo(() => {
    return catRing ? nearestPlaceName?.(ringCentroid(catRing)) : undefined
  }, [catRing, nearestPlaceName])

  /* Same lookup as nearbyPlace above, asked about the pending report's own
     point instead of the cat's territory centre — so the lock message below
     can read "reported near Mitsukoshi BGC" instead of just "reported
     recently", which named nothing a reader could place. Landmark name
     only, never the coordinate itself: the same rounding-into-a-place-name
     nearestPlaceName already does for every other on-screen mention of a
     point (map/landmark.ts's own note on why 250m and "landmark, or
     failing that a road" is the right precision for a sentence). */
  const pendingPlace = useMemo(() => {
    return oldestPending ? nearestPlaceName?.(oldestPending.point) : undefined
  }, [oldestPending, nearestPlaceName])

  /* Distance from the known range rather than a coordinate, phase 9: raw
     lat/lng is exactly the precision an admin's own decision list should
     not be printing, and there is no geocoder in an app built around one
     offline .pmtiles file to turn it into a place name instead — this is
     the "landmark, or failing that a highlight" fallback, same maths
     ui/ReportSighting.tsx already shows a reporter before they submit. */
  const describeReach = (point: [number, number]): string | null => {
    if (!catRing) return null
    const centre = ringCentroid(catRing)
    const outside = Math.max(0, distanceM(centre, point) - ringRadiusM(catRing, centre))
    return outside > 0 ? `${Math.round(outside)} m outside the known range` : 'Inside the known range'
  }

  /* This visitor's own reports on this cat that nobody has reviewed yet.
     They are here at all because of a deliberate exception in
     catsRepo.listSightings: pending data reaches no public surface except
     this one, and only ever the caller's own. */
  const mine = useMemo(() => sightings.filter((sighting) => sighting.status === 'pending'), [sightings])

  /* Whether the one open report everything else anchors to belongs to
     somebody else, which is the only case the vote prompt below is a real
     question in.

     This used to be unconditional, on the reasoning that "my report" and
     "a report I can merely see" were definitionally the same set, because
     with no login every pending row a browser could read was one it had
     written itself. That stopped being true at phase 6, when a sighting
     gained an authorUid, and the result was a visitor with an open report
     seeing it listed under "Your reports, awaiting review" with a Withdraw
     button, and then again immediately below asking whether it matched
     what they saw. Corroborating yourself is not evidence, so their own
     report now falls through to the branch that renders nothing extra:
     "Your reports" above has already said the piece, and it has the one
     control that actually applies. */
  const someoneElsesPending = !!oldestPending && oldestPending.authorUid !== uid

  /* The signed-out counterpart to someoneElsesPending above. oldestPending
     itself is always null here (catsRepo.listPendingForCat returns []
     outright for a null uid, firestore.rules' own doing), so this reads
     cats/{id}.pendingCount instead: the one fact about an open report a
     signed-out client is allowed to have at all, a count with no point, no
     photo and no author behind it. Locks the report button the same way
     someoneElsesPending does, and offers signing in in place of the vote
     prompt a signed-in stranger would see. */
  const signedOutPending = !uid && (cat.pendingCount ?? 0) > 0

  /* The photographs on file for this cat. flatMap rather than filter-then-
     map, so the absent case is removed and the type narrows in one pass. */
  const photos = useMemo<StackCard[]>(
    () =>
      sightings.flatMap((sighting) =>
        sighting.photo
          ? [
              {
                id: sighting.id,
                src: sighting.photo,
                alt: `${cat.name}, photographed ${describeWhen(sighting.at)}`,
                caption: describeWhen(sighting.at),
              },
            ]
          : []
      ),
    [sightings, cat.name]
  )

  /* --- Admin editing -----------------------------------------------------
     `editing` is the whole-plate mode the admin strip's "Update record"
     opens; `openField` is which single field's inline editor is open
     within it, one at a time. Leaving edit mode abandons whatever was
     mid-edit rather than saving it, the same "cancel first, close second"
     shape RecordCat's own Escape handler uses. */
  const [editing, setEditing] = useState(false)
  const [openField, setOpenField] = useState<string | null>(null)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [colourError, setColourError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addingPhoto, setAddingPhoto] = useState(false)
  const [addPhotoError, setAddPhotoError] = useState<string | null>(null)

  const stopEditing = () => {
    setEditing(false)
    setOpenField(null)
    setFieldError(null)
    setConfirmingDelete(false)
    setAddPhotoError(null)
  }

  const openFieldEditor = (id: string) => {
    setOpenField(id)
    setFieldError(null)
  }

  const saveField = async (id: string, patch: CatPatch) => {
    setSavingField(id)
    const ok = await updateCat(cat.id, patch)
    setSavingField(null)
    if (ok) {
      setOpenField(null)
      setFieldError(null)
      onChanged?.()
    } else {
      setFieldError('Could not save. The field may be required.')
    }
  }

  const saveColour = async (token: Colour) => {
    setColourError(null)
    const ok = await updateCat(cat.id, { colour: token })
    if (ok) onChanged?.()
    else setColourError('Could not save.')
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    const ok = await deleteCat(cat.id)
    setDeleting(false)
    if (ok) {
      onChanged?.()
      onClose()
    } else {
      setDeleteError('Could not delete. Check your connection and try again.')
    }
  }

  /* Reorder only ever changes which photo leads the stack, never what the
     survey considers "last seen" (sightings.ts's sortForDisplay says why),
     so it only needs a local reload. Delete can remove the sighting behind
     a cat's lastSeen, so it also tells the parent to re-derive the cats
     list. */
  const moveSighting = async (id: string, direction: 'up' | 'down') => {
    if (await reorderSighting(cat.id, id, direction)) loadSightings()
  }
  const removeSightingRow = async (id: string) => {
    if (await deleteSighting(id)) {
      loadSightings()
      onChanged?.()
    }
  }

  /* An admin attaching a photo without waiting for a visitor to report one
     first — the gap "Update record" used to leave: a cat recorded with only
     its required cover photo (ui/RecordCat.tsx's own note on that field)
     could sit with zero sightings and no way to add one short of a real
     visitor's report. Pointed at the territory's own centre, the only
     coordinate this surface has (same fallback describeReach above uses). */
  const addPhoto = async (file: File | undefined) => {
    /* uid required now, not just catRing: addAdminPhoto writes it as the
       sighting's authorUid, the same field every other sighting in the
       log carries, and "Update record" is only ever open behind the admin
       gate anyway, so a missing uid here means an expired session rather
       than a real visitor this should silently do nothing for. */
    if (!file || !catRing || !uid) return
    setAddPhotoError(null)
    setAddingPhoto(true)
    try {
      const blob = await compressImageToBlob(file, PHOTO_MAX_DIM, PHOTO_QUALITY)
      const url = await uploadPhoto(blob, 'sightings')
      const ok = await addAdminPhoto(cat.id, ringCentroid(catRing), url, uid)
      if (ok) {
        loadSightings()
        onChanged?.()
      } else {
        setAddPhotoError('Could not save. Check your connection and try again.')
      }
    } catch {
      setAddPhotoError('Could not upload that photo. Try a different file.')
    } finally {
      setAddingPhoto(false)
    }
  }

  /* A visitor's thumb, everyone's, phase 9. Local reload only, same reason
     moveSighting above is: a vote changes a tally, never who is pending or
     what the cat's record looks like elsewhere, so there is nothing for
     onChanged to tell the rest of the app. */
  const castVote = async (id: string, direction: 'up' | 'down') => {
    /* uid ?? '': voteSighting takes a required string, one per uid now
       that a vote spans every viewer rather than one browser (see
       Sighting.votes' own note in data/sightings.ts). The vote buttons
       below render for anyone, signed in or not; a signed-out '' simply
       fails the write server-side (firestore.rules) rather than this
       function pretending to know in advance who is allowed to vote. */
    if (await voteSighting(id, uid ?? '', direction)) loadSightings()
  }

  /* The signed-out lock's own door in, same try/catch-and-message shape
     ui/ReportSighting.tsx's inline sign-in prompt already uses (signInError
     there is this file's own signInError, not shared state: two unrelated
     prompts, two unrelated failures). No setSignInBusy(false) on success
     is not a bug here either: subscribeAuth firing flips App.tsx's `uid`
     from null, which re-renders this plate with signedOutPending now
     false, unmounting this whole branch before the button could matter
     again. */
  const [signInBusy, setSignInBusy] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const signIn = async () => {
    setSignInError(null)
    setSignInBusy(true)
    try {
      await signInWithGoogle()
    } catch {
      setSignInError('Could not sign in. Try again.')
    } finally {
      setSignInBusy(false)
    }
  }

  /* An admin's verdict, reachable straight from the plate now rather than
     only from the corner panel that used to own this (ui/ReviewQueue.tsx,
     parked — see map/MapCanvas.tsx's note on why). Approving can move the
     territory (data/catsRepo.ts's listTerritories applies the newest
     SURVEYED sighting at read time, which this verdict may just have
     created), so onChanged is required here, unlike the vote above.

     Nothing landmark-specific happens here any more. It used to: an
     earlier version looked up the sighting's own point on approval and
     wrote the result into storage (catsRepo's setDerivedRange). That was
     a write that could go stale (a cat's `range` kept whatever text was
     written at ITS last approval, however out of date), and it duplicated
     the "how big" figure TerritoryGlyph already owns. The glyph now reads
     the live, translated ring itself (catRing, threaded through as its
     `ring` prop) and asks nearestPlaceName about its own current centre on
     every render, so approving a sighting is enough on its own — nothing
     here has to remember to keep a second fact in sync. */
  const decidePending = async (id: string, verdict: 'surveyed' | 'discarded') => {
    if (!(await reviewSighting(id, cat.id, verdict))) return
    loadSightings()
    onChanged?.()
  }

  /* Escape closes. A panel this size that can only be dismissed by finding
     one small button is the single most common complaint about card UIs.

     Through the shared stack rather than a window listener of its own. The
     sighting panel this card's own button opens sits on top of it and has
     its own Escape behaviour, and two window listeners meant one press did
     both: the report stepped back out of aiming AND the record it was
     started from closed behind it. See ui/escape.ts. */
  useEscape(true, onClose)

  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 1800)
    return () => clearTimeout(t)
  }, [copyState])

  return (
    <motion.article
      className="plate"
      /* The cat's territory token themes the whole card: the plate number,
         the hero glow, the rules beside each field, the copy button's hover.
         Set once here, read everywhere in CSS. */
      style={{ '--accent': `var(${cat.colour})` } as React.CSSProperties}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      /* Fast, flat exit on purpose. The photo is flying home on its own
         timeline underneath this; a slow card exit would still be on screen
         while it lands, and the two would read as one confused movement. */
      exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
      transition={springSoft}
    >
      <Specular />

      <div className="plate-hero">
        <motion.img
          layoutId={`cat-photo-${cat.id}`}
          transition={springSoft}
          className="plate-hero-photo"
          src={cat.photo}
          /* The row's own THUMB_PX thumbnail, painted as a background
             UNDER the full-size photograph rather than instead of it.

             The row and the pin stopped fetching 640x480 (see THUMB_PX in
             data/cats.seed.ts), which means the hero is now the first
             request for the large file rather than a cache hit, and an
             <img> renders nothing at all until it loads. Without this the
             shared-element morph, which is the signature moment of this
             app, would fly an empty frame out of the row on the first open
             of every cat.

             The small one is already in cache, because the row it flew out
             of is what put it there, so it paints on the first frame. The
             large one covers it the moment it arrives. Both are `cover` on
             the same box, so the swap reads as sharpening rather than as
             anything moving. Inline because the URL is per-cat: there is
             nothing here a stylesheet could hold. */
          style={{
            backgroundImage: `url("${photoAt(cat.photo, THUMB_PX)}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          alt={`${cat.name}, recorded on ${cat.line}`}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />

        <span className="plate-number">{cat.plate}</span>

        <motion.button
          type="button"
          className="plate-close"
          aria-label={`Close ${cat.name}`}
          onClick={onClose}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          transition={spring}
        >
          <X size={16} />
        </motion.button>
      </div>

      <motion.div className="plate-body" data-lenis-prevent variants={body} initial="hidden" animate="shown">
        {/* The survey line used to sit in the footer, below three
            fields nobody scrolls to. It is the second most identifying thing
            about a cat after its name, so it sits above the name now, where
            an eyebrow states which record you have open before you read
            whose it is. */}
        <motion.p className="plate-eyebrow" variants={line}>
          {cat.line}
        </motion.p>

        <div className="admin-field-row">
          <motion.h2 variants={line}>{cat.name}</motion.h2>
          {admin && editing && openField !== 'name' && (
            <FieldPencil label="name" onClick={() => openFieldEditor('name')} />
          )}
        </div>
        {admin && editing && openField === 'name' && (
          <FieldEditor
            label="name"
            value={cat.name}
            maxLength={40}
            busy={savingField === 'name'}
            error={fieldError}
            onSave={(next) => saveField('name', { name: next })}
            onCancel={() => setOpenField(null)}
          />
        )}

        <div className="admin-field-row">
          <motion.p className="plate-sub" variants={line}>
            {cat.description}
          </motion.p>
          {admin && editing && openField !== 'description' && (
            <FieldPencil label="description" onClick={() => openFieldEditor('description')} />
          )}
        </div>
        {admin && editing && openField === 'description' && (
          <FieldEditor
            label="description"
            value={cat.description}
            maxLength={90}
            busy={savingField === 'description'}
            error={fieldError}
            onSave={(next) => saveField('description', { description: next })}
            onCancel={() => setOpenField(null)}
          />
        )}

        {/* Range is promoted out of the field list and given the glyph,
            because range is the only field paired with a shape. The shape
            itself (the outline and its centre dot, TerritoryGlyph) is
            never a pencil: it's read straight off the live polygon, plus
            whatever sighting last translated it (catsRepo's
            translateToward), so there is nothing there an admin could type
            that wouldn't just make it lie about what's actually drawn on
            the map.

            2026-08-26: used to pair the shape with two lines of text — a
            hand-authored "point A → point B" sentence (cat.range) plus this
            nearest-place lookup underneath it in a smaller caption. Dropped
            the hand-authored line on user feedback: two descriptions of the
            same shape was more than a person needed, and "near X" is the one
            that actually orients a reader standing in BGC. nearbyPlace is
            still live-and-never-written the same way the shape is (see its
            own useMemo above), so admin gets no pencil or lock here either —
            there is nothing about this line an editor could ever be right
            about. cat.range itself is untouched in the data (Rail.tsx's
            search still reads it), just no longer shown here. */}
        <motion.div className="plate-range" variants={line}>
          <TerritoryGlyph ring={catRing} delay={0.3} />
          <div className="plate-range-text">
            <span className="plate-label">Range</span>
            {nearbyPlace && <span className="plate-value">{nearbyPlace}</span>}
          </div>
        </motion.div>

        {admin && editing && (
          <div className="plate-field admin-colour-field">
            <span className="plate-label">Territory colour</span>
            <div className="admin-swatches">
              {CAT_COLOURS.map(({ token, label }) => (
                <button
                  key={token}
                  type="button"
                  className="admin-swatch"
                  style={{ '--swatch': `var(${token})` } as React.CSSProperties}
                  data-on={String(cat.colour === token)}
                  aria-pressed={cat.colour === token}
                  aria-label={label}
                  disabled={savingField !== null}
                  onClick={() => saveColour(token)}
                />
              ))}
            </div>
            {colourError && (
              <p className="admin-edit-error" role="alert">
                {colourError}
              </p>
            )}
          </div>
        )}

        {/* First among the fields when there is one, because it is the only
            fact on this card that changes. A visitor reported it (see
            ui/ReportSighting.tsx); everything below is the survey's own
            record and does not move — unless an admin corrects it directly,
            which is what makes lastSeen editable at all: see catsRepo's
            CatPatch for why a normally-derived field is on that list. */}
        {(cat.lastSeen || (admin && editing)) && (
          <>
            <div className="admin-field-row">
              <motion.div className="plate-field" variants={line}>
                <span className="plate-label">Last seen</span>
                <span className="plate-value">{cat.lastSeen || 'Not yet observed'}</span>
              </motion.div>
              {admin && editing && openField !== 'lastSeen' && (
                <FieldPencil label="last seen" onClick={() => openFieldEditor('lastSeen')} />
              )}
            </div>
            {admin && editing && openField === 'lastSeen' && (
              <FieldEditor
                label="last seen"
                value={cat.lastSeen ?? ''}
                maxLength={40}
                busy={savingField === 'lastSeen'}
                error={fieldError}
                onSave={(next) => saveField('lastSeen', { lastSeen: next })}
                onCancel={() => setOpenField(null)}
              />
            )}
          </>
        )}

        <div className="admin-field-row">
          <motion.div className="plate-field" variants={line}>
            <span className="plate-label">First recorded</span>
            <span className="plate-value">{cat.firstRecorded}</span>
          </motion.div>
          {admin && editing && openField !== 'firstRecorded' && (
            <FieldPencil label="first recorded" onClick={() => openFieldEditor('firstRecorded')} />
          )}
        </div>
        {admin && editing && openField === 'firstRecorded' && (
          <FieldEditor
            label="first recorded"
            value={cat.firstRecorded}
            maxLength={24}
            busy={savingField === 'firstRecorded'}
            error={fieldError}
            onSave={(next) => saveField('firstRecorded', { firstRecorded: next })}
            onCancel={() => setOpenField(null)}
          />
        )}

        <div className="admin-field-row">
          <motion.div className="plate-field" variants={line}>
            <span className="plate-label">Disposition</span>
            <span className="plate-value">{cat.disposition}</span>
          </motion.div>
          {admin && editing && openField !== 'disposition' && (
            <FieldPencil label="disposition" onClick={() => openFieldEditor('disposition')} />
          )}
        </div>
        {admin && editing && openField === 'disposition' && (
          <FieldEditor
            label="disposition"
            value={cat.disposition}
            maxLength={90}
            busy={savingField === 'disposition'}
            error={fieldError}
            onSave={(next) => saveField('disposition', { disposition: next })}
            onCancel={() => setOpenField(null)}
          />
        )}

        {/* Last, and only when there is one — unless an admin is editing,
            in which case the row stays so there is somewhere to add one.
            Rendered conditionally otherwise, see the note on Cat.note. An
            orphaned label with nothing under it reads as data that failed
            to load rather than data that does not exist. */}
        {(cat.note || (admin && editing)) && (
          <>
            <div className="admin-field-row">
              <motion.div className="plate-field" variants={line}>
                <span className="plate-label">Field note</span>
                <span className="plate-value">{cat.note || 'Nothing recorded yet.'}</span>
              </motion.div>
              {admin && editing && openField !== 'note' && (
                <FieldPencil label="field note" onClick={() => openFieldEditor('note')} />
              )}
            </div>
            {admin && editing && openField === 'note' && (
              <FieldEditor
                label="field note"
                value={cat.note ?? ''}
                multiline
                maxLength={220}
                busy={savingField === 'note'}
                error={fieldError}
                onSave={(next) => saveField('note', { note: next })}
                onCancel={() => setOpenField(null)}
              />
            )}
          </>
        )}

        {/* What the survey has actually seen, as opposed to what it wrote
            down about the animal. It sits below the fields and directly
            above the button that adds to it, so the two read as one
            exchange: here is the record of observations, here is how you
            add yours.

            Only when there are photographs. A sighting with no photograph
            is a perfectly good sighting and already shows up in the "Last
            seen" field above; it just has nothing to put in a pile. An
            empty frame under a "Sightings" heading would claim a picture
            failed to load rather than that none was taken. */}
        {photos.length > 0 && (
          <motion.div className="plate-sightings" variants={line}>
            <span className="plate-label">Sightings</span>
            <CardStack cards={photos} label={`Photographs of ${cat.name}`} />
          </motion.div>
        )}

        {/* An admin's management view of the whole log, not just the
            photographed subset the stack above shows. Additive rather than
            a replacement for the stack: the stack's drag interaction is
            tuned for browsing, not for a list with delete buttons on it, so
            this is a second, plainer view rather than a rebuilt first one.

            Rendered whenever editing, not gated on sightings.length any
            more: a cat recorded with only its required cover photo and no
            extra photos (ui/RecordCat.tsx) lands with an empty list, and
            that used to mean this section, the only place "Update record"
            could add a photo, never appeared at all. The list itself stays
            conditional; the uploader below it does not. */}
        {admin && editing && (
          <motion.div className="admin-sightings" variants={line}>
            <span className="plate-label">Manage sightings</span>
            {sightings.length > 0 && (
              <ul className="admin-sighting-list">
                {sightings.map((sighting, i) => (
                  <li key={sighting.id} className="admin-sighting-row">
                    <span className="admin-sighting-when">
                      {describeWhen(sighting.at)}
                      {sighting.status !== 'surveyed' && (
                        <span className="admin-sighting-status" data-status={sighting.status}>
                          {sighting.status}
                        </span>
                      )}
                    </span>
                    <span className="admin-sighting-controls">
                      <button
                        type="button"
                        aria-label="Move earlier in the stack"
                        disabled={i === 0}
                        onClick={() => moveSighting(sighting.id, 'up')}
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Move later in the stack"
                        disabled={i === sightings.length - 1}
                        onClick={() => moveSighting(sighting.id, 'down')}
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="admin-sighting-delete"
                        aria-label="Delete this sighting"
                        onClick={() => removeSightingRow(sighting.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <label className="admin-sighting-add" data-disabled={String(!catRing || addingPhoto)}>
              <Plus size={13} />
              {addingPhoto ? 'Adding…' : 'Add a photo'}
              <input
                type="file"
                accept="image/*"
                disabled={!catRing || addingPhoto}
                onChange={(e) => void addPhoto(e.target.files?.[0])}
              />
            </label>
            {addPhotoError && (
              <p className="admin-edit-error" role="alert">
                {addPhotoError}
              </p>
            )}
          </motion.div>
        )}

        {/* What you reported and nobody has looked at yet.

            Above the report button rather than below it, because "you have
            already told us this" is context for whether to tell us again.

            Withdrawing does not notify App: nothing published changed,
            since a pending sighting was never applied to anything. Dropping
            the row from local state is the whole update, and pretending
            otherwise would make the map re-read the repo to arrive at
            exactly what it is already showing. */}
        {mine.length > 0 && (
          <motion.div className="plate-pending" variants={line}>
            <span className="plate-label">Your reports</span>
            {mine.map((sighting) => (
              <p key={sighting.id} className="plate-pending-row">
                <span>
                  {describeWhen(sighting.at)} · awaiting review
                </span>
                <button
                  type="button"
                  onClick={() => {
                    /* uid ?? '': withdrawSighting checks the caller's uid
                       against the sighting's own authorUid before deleting
                       anything, so a mismatched or empty uid just fails the
                       check and returns false rather than withdrawing
                       something this visitor did not report. */
                    void withdrawSighting(sighting.id, uid ?? '').then((gone) => {
                      if (gone) loadSightings()
                    })
                  }}
                >
                  Withdraw
                </button>
              </p>
            ))}
          </motion.div>
        )}

        {/* The one thing a visitor can contribute, offered wherever a cat is
            being read about rather than only inside the "I saw a cat" flow.
            That is the point of putting it here: the rail, a map pin, the
            deck and the scanner all end at this card, so one button covers
            every route instead of each route growing its own.

            Last in the body, after the record rather than inside it: the
            fields above are what the survey knows, and this is a thing to
            do about them. Outlined rather than filled, because the plate is
            a record first and an invitation second. */}
        {/* An admin's decision list, phase 9. Reachable straight off the
            record rather than buried behind "Update record" the way the
            plainer sightings manager below it is: this is the thing an
            admin most likely opened the plate to do, so it does not wait
            on a second click to appear. Replaces ui/ReviewQueue.tsx's own
            approve/discard controls (map/MapCanvas.tsx's note has the
            reasoning); reuses that panel's .review-yes/.review-no pill
            styling since the action is the same one, just relocated. */}
        {admin && pendingForCat.length > 0 && (
          <motion.div className="admin-pending" variants={line}>
            <span className="plate-label admin-strip-label">
              Pending review
              {pendingForCat.length > 1 && ` (${pendingForCat.length})`}
            </span>
            <ul className="admin-pending-list">
              {pendingForCat.map((sighting) => (
                <li key={sighting.id} className="admin-pending-row">
                  {sighting.photo && (
                    <img src={sighting.photo} alt="" className="admin-pending-photo" />
                  )}
                  <div className="admin-pending-info">
                    <span className="admin-pending-when">{describeWhen(sighting.at)}</span>
                    {describeReach(sighting.point) && (
                      <span className="admin-pending-point">{describeReach(sighting.point)}</span>
                    )}
                    {/* Only when somebody has actually voted: an admin
                        reading "0 up, 0 down" on every row learns nothing a
                        blank row would not already say. */}
                    {sighting.votes && (sighting.votes.up > 0 || sighting.votes.down > 0) && (
                      <span className="admin-pending-votes">
                        <ThumbsUp size={11} aria-hidden /> {sighting.votes.up}
                        <ThumbsDown size={11} aria-hidden /> {sighting.votes.down}
                      </span>
                    )}
                  </div>
                  <div className="admin-pending-actions">
                    <button
                      type="button"
                      className="review-no"
                      onClick={() => void decidePending(sighting.id, 'discarded')}
                    >
                      <X size={13} />
                      Reject
                    </button>
                    <button
                      type="button"
                      className="review-yes"
                      onClick={() => void decidePending(sighting.id, 'surveyed')}
                    >
                      <Check size={13} />
                      Approve
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {/* Phase 9: a cat with somebody else's open report locks out a
            second one rather than collecting an independent point nobody
            will ever compare against the first, which is the exact
            duplication this replaces. Everyone signed in gets this, not
            only admin: it is the public-facing half of review becoming
            visible instead of silent. The exact point lives on the map
            (map/Territories.tsx's ghost, opened to every visitor
            2026-08-26) and in the landmark name below (pendingPlace); this
            text is the words-only version of the same claim, with no
            diagram of its own since TerritoryGlyph's pending mark was
            removed the same day on user feedback. The tally under it is
            everybody's, one vote per account (Sighting.votes' own note),
            which is what makes asking the question worth anything.

            Four outcomes now, not three. Somebody else's open report, seen
            signed in, gets the question and the tally (below). This
            visitor's own gets nothing here, because "Your reports" above
            already covers it (see someoneElsesPending's own note). Signed
            out, with cat.pendingCount saying a report exists that
            listPendingForCat cannot hand this viewer the details of
            (firestore.rules keeps a pending report behind sign-in, spec
            §9), gets a lock with no place name, no photo and no tally, none
            of which reached this client, plus the door in rather than the
            question. Nothing open at all, either way, gets the report
            button. */}
        {someoneElsesPending && oldestPending ? (
          <motion.div className="plate-locked" variants={line}>
            <p className="plate-locked-msg">
              <Lock size={12} aria-hidden />A sighting of {cat.name} was reported
              {pendingPlace ? ` ${pendingPlace.replace(/^Near /, 'near ')}` : ''} recently and is
              awaiting review. Does that match what you saw?
            </p>
            <div className="plate-vote">
              <button
                type="button"
                className="plate-vote-btn"
                data-on={String(oldestPending.myVote === 'up')}
                aria-pressed={oldestPending.myVote === 'up'}
                onClick={() => void castVote(oldestPending.id, 'up')}
              >
                <ThumbsUp size={13} />
                {oldestPending.votes?.up ?? 0}
              </button>
              <button
                type="button"
                className="plate-vote-btn"
                data-on={String(oldestPending.myVote === 'down')}
                aria-pressed={oldestPending.myVote === 'down'}
                onClick={() => void castVote(oldestPending.id, 'down')}
              >
                <ThumbsDown size={13} />
                {oldestPending.votes?.down ?? 0}
              </button>
            </div>
          </motion.div>
        ) : signedOutPending ? (
          <motion.div className="plate-locked" variants={line}>
            <p className="plate-locked-msg">
              <Lock size={12} aria-hidden />A sighting of {cat.name} is awaiting review. Sign in to
              see it and vote.
            </p>
            <button
              type="button"
              className="plate-signin"
              disabled={signInBusy}
              onClick={() => void signIn()}
            >
              <LogIn size={13} />
              {signInBusy ? 'Signing in…' : 'Sign in with Google'}
            </button>
            {signInError && (
              <p className="plate-signin-error" role="alert">
                {signInError}
              </p>
            )}
          </motion.div>
        ) : (
          /* Either nothing is pending (the normal case, report offered), or
             the only thing pending is this visitor's own report, which
             "Your reports" above already said, with a Withdraw button.
             Voting on your own submission is not a real question, so this
             renders nothing rather than a prompt with no honest answer. */
          !oldestPending &&
          onReport && (
            <motion.button
              type="button"
              className="plate-report"
              variants={line}
              onClick={() => onReport(cat.id)}
            >
              <MapPin size={13} />
              I saw {cat.name} here
            </motion.button>
          )
        )}

        {/* The admin strip: the one place on the card that is not part of
            the record itself, which is why it sits apart from the fields
            above rather than styled as one of them. Hidden entirely from
            anyone the admin gate is shut for (App.tsx's useAdmin, which as
            of phase 9 means a real Google account with an admins/{uid}
            marker behind it), not merely styled away. */}
        {admin && (
          <motion.div className="admin-strip" variants={line}>
            <span className="plate-label admin-strip-label">Admin</span>
            {!confirmingDelete ? (
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-update"
                  data-on={String(editing)}
                  onClick={() => (editing ? stopEditing() : setEditing(true))}
                >
                  <Pencil size={13} />
                  {editing ? 'Done editing' : 'Update record'}
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-delete"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            ) : (
              <div className="admin-confirm">
                <p>
                  Delete {cat.name}'s record? Its territory and every photograph attached to it go
                  with it. This cannot be undone.
                </p>
                {deleteError && (
                  <p className="admin-edit-error" role="alert">
                    {deleteError}
                  </p>
                )}
                <div className="admin-confirm-actions">
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    Keep record
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-delete-confirm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Delete forever'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>

      <div className="plate-foot">
        {/* Coordinates are the one value here anyone would want out of the
            app, so they are the one value you can take with you. The label
            states what happened, in the past tense of the button that did
            it. clipboard is undefined on insecure origins, hence the guard. */}
        <button
          type="button"
          className="plate-copy"
          data-state={copyState}
          onClick={async () => {
            /* navigator.clipboard is undefined on insecure origins, which
               is exactly how this gets opened on a phone over a LAN IP, and
               writeText can also reject on a denied permission. Both used to
               land as a button that did nothing at all, the second one with
               an unhandled rejection behind it. Now the failure is a state
               the button can show. */
            try {
              await navigator.clipboard.writeText(cat.coordinates)
              setCopyState('done')
            } catch {
              setCopyState('failed')
            }
          }}
        >
          <span className="plate-copy-icon">
            {/* All three glyphs are mounted and crossfaded in place rather
                than swapped, so the button's width never changes under the
                pointer at the moment it is pressed. */}
            <Copy size={12} data-on={String(copyState === 'idle')} />
            <Check size={12} data-on={String(copyState === 'done')} />
            <X size={12} data-on={String(copyState === 'failed')} />
          </span>
          {/* aria-live, because the whole outcome of pressing this button is
              a word change inside it, with nothing announced, a screen
              reader user cannot tell a copy from a failure. */}
          <span className="plate-copy-label" aria-live="polite">
            {copyState === 'done'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Select the text to copy'
                : cat.coordinates}
          </span>
        </button>
      </div>
    </motion.article>
  )
}
