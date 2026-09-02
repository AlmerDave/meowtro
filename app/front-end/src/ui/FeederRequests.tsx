import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, UserPlus, X } from 'lucide-react'
import {
  approveFeeder,
  declineFeeder,
  listFeederRequests,
  type FeederRequest,
} from '@/data/feeders'
import { useEscape } from '@/ui/escape'
import { spring, springSoft } from '@/motion/springs'

/* The admin's feeder-approval queue (spec
   2026-09-01-territory-visibility-decoy-design.md).

   ## Why this is a trigger and a panel, not a panel

   The first version was a bare panel pinned top-left, always on screen for
   an admin. On a phone that is most of the map: it covered the record
   trigger, it had no way to dismiss it, and a failed load left a red
   banner sitting over Bonifacio permanently with nothing to press. A queue
   an admin visits occasionally is a trigger with a count on it, the shape
   ui/ReviewQueue.tsx already worked out for exactly this job.

   ## Why it borrows ReviewQueue's own class names

   `.review-trigger`, `.review`, `.review-yes`/`.review-no` and the rest
   are built, themed and carry their own mobile block in shell.css, and
   the panel they were written for is currently unmounted (map/MapCanvas.tsx
   has the note on why phase 9 moved sighting review onto the map). So this
   is not a copy of that styling, it is that styling, reused for the second
   thing in the app shaped like a review queue: a list of submissions with
   an approve and a reject on each row. Only the per-row content is new.
   Nothing here positions itself; it sits in `.admin-controls` beside the
   record trigger and inherits both corners from there.

   Approve writes `feeders/{uid}` and clears the request; Decline only
   clears it. Oldest first, because a queue is worked from the front. */

export function FeederRequests() {
  const [open, setOpen] = useState(false)
  const [requests, setRequests] = useState<FeederRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEscape(open, () => setOpen(false))

  /* Read on mount, not only on open, unlike ReviewQueue's own count. The
     difference is what the number is for: that panel's badge describes a
     queue the admin is already working, this one is the only signal that
     somebody has asked for access at all, and a badge that only appears
     after you open the thing it is meant to send you to is no signal. One
     getDocs over a small collection per admin page load is the whole cost.

     A failure sets `error` and leaves `requests` empty, which is the right
     degradation: no badge (nothing is known to be waiting) and the reason
     waiting inside the panel for whoever opens it, rather than a banner
     over the map that cannot be dismissed. */
  const load = useCallback(() => {
    listFeederRequests()
      .then((list) => {
        setRequests(list)
        setError('')
      })
      .catch(() => setError('Could not load feeder applications. The Firestore rules for feederRequests may not be deployed yet.'))
  }, [])

  useEffect(load, [load])

  async function act(uid: string, fn: (uid: string) => Promise<boolean>) {
    setBusy(uid)
    setError('')
    const ok = await fn(uid)
    setBusy(null)
    if (ok) setRequests((list) => list.filter((r) => r.uid !== uid))
    else setError('That did not go through. Try again.')
  }

  return (
    <>
      <button
        type="button"
        className="review-trigger"
        aria-label={
          requests.length > 0
            ? `Feeder applications, ${requests.length} waiting`
            : 'Feeder applications'
        }
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was)
          /* Refresh on the way in, so an application filed since the page
             loaded is there when the admin actually looks. */
          if (!open) load()
        }}
      >
        <UserPlus size={16} />
        Feeders
        {requests.length > 0 && <span className="review-count">{requests.length}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            className="review"
            aria-label="Feeder applications"
            /* scale(0.98), never scale(0): a panel that grows out of
               nothing reads as a glitch. Origin is set in shell.css to the
               corner the trigger sits in, so it opens out of the button
               that was pressed rather than out of its own middle. */
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
            transition={springSoft}
          >
            <div className="review-head">
              <p className="review-eyebrow">Feeder applications</p>
              <button
                type="button"
                className="review-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="review-body" data-lenis-prevent>
              {error && (
                <p className="admin-edit-error" role="alert">
                  {error}
                </p>
              )}

              {requests.length === 0 && !error ? (
                <p className="review-empty">
                  Nobody is waiting. Visitors who ask to see accurate territories land here before
                  anything on the map changes for them.
                </p>
              ) : (
                <ul className="review-list feeder-list">
                  <AnimatePresence mode="popLayout">
                    {requests.map((r, i) => (
                      <motion.li
                        key={r.uid}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        /* 40ms apart, so a queue of four cascades rather
                           than arriving as one block. Short enough that
                           the last row is in under a fifth of a second. */
                        transition={{ ...spring, delay: i * 0.04 }}
                      >
                        <div className="feeder-request-who">
                          <p className="review-name">{r.name}</p>
                          <p className="review-when">{r.email}</p>
                        </div>
                        {r.reason && <p className="feeder-request-reason">{r.reason}</p>}
                        <div className="feeder-request-actions">
                          <button
                            type="button"
                            className="review-no"
                            disabled={busy === r.uid}
                            onClick={() => void act(r.uid, declineFeeder)}
                          >
                            <X size={13} />
                            Decline
                          </button>
                          <button
                            type="button"
                            className="review-yes"
                            disabled={busy === r.uid}
                            onClick={() => void act(r.uid, approveFeeder)}
                          >
                            <Check size={13} />
                            Approve
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            <p className="review-foot">
              An approved feeder sees where the cats actually live. Everybody else sees each
              territory placed somewhere else in BGC.
            </p>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
