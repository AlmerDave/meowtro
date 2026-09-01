import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  approveFeeder,
  declineFeeder,
  listFeederRequests,
  type FeederRequest,
} from '@/data/feeders'

/* The admin's feeder-approval queue (spec
   2026-09-01-territory-visibility-decoy-design.md). Mounted behind
   App.tsx's admin gate, in the same .admin-controls shelf as RecordCat.

   Renders nothing at all while the queue is empty rather than an
   empty-state line: the shelf is a small corner and there is nothing for
   an admin to do about zero requests. It appears when somebody applies
   and disappears when the last one is cleared. Approve writes
   feeders/{uid} and deletes the request; Decline just deletes it.
   Oldest first (a queue is worked from the front). */

export function FeederRequests() {
  const [requests, setRequests] = useState<FeederRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    listFeederRequests()
      .then(setRequests)
      .catch(() => setError('Could not load feeder requests.'))
  }, [])

  useEffect(load, [load])

  async function act(uid: string, fn: (uid: string) => Promise<boolean>) {
    setBusy(uid)
    setError('')
    const ok = await fn(uid)
    setBusy(null)
    if (ok) setRequests((list) => list.filter((r) => r.uid !== uid))
    else setError('That did not go through, try again.')
  }

  if (requests.length === 0 && !error) return null

  return (
    <section className="feeder-requests" aria-label="Feeder applications">
      <p className="feeder-requests-eyebrow">
        Feeder applications{requests.length > 0 && ` (${requests.length})`}
      </p>
      {error && (
        <p className="admin-edit-error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {requests.map((r) => (
          <li key={r.uid} className="feeder-request">
            <div className="feeder-request-who">
              <strong>{r.name}</strong>
              <span>{r.email}</span>
            </div>
            {r.reason && <p className="feeder-request-reason">{r.reason}</p>}
            {/* Reuses .review-yes/.review-no wholesale, the same way
                .admin-pending does: approve or turn down a request is the
                same shape of action the sighting queue's buttons are. */}
            <div className="feeder-request-actions">
              <button
                type="button"
                className="review-no"
                disabled={busy === r.uid}
                onClick={() => void act(r.uid, declineFeeder)}
              >
                <X size={14} aria-hidden />
                Decline
              </button>
              <button
                type="button"
                className="review-yes"
                disabled={busy === r.uid}
                onClick={() => void act(r.uid, approveFeeder)}
              >
                <Check size={14} aria-hidden />
                Approve
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
