import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ClipboardList, X } from 'lucide-react'
import { listPending, listReviewed, reviewSighting } from '@/data/catsRepo'
import { describeWhen, type Sighting } from '@/data/sightings'
import { listCats, type Cat } from '@/data/catsRepo'
import { useEscape } from '@/ui/escape'
import { spring, springSoft } from '@/motion/springs'

/* The review queue, phase 8.

   ## What is actually being reviewed

   Sightings, and only sightings. A cat recorded through ui/RecordCat.tsx is
   made by an admin and is therefore reviewed by definition, which is why
   StoredCat carries no status and this panel has one kind of thing in it
   rather than two. That was a deliberate narrowing: the version where
   visitors propose cats needs an answer to "what does an unreviewed cat
   look like on a public map", and the version where they cannot need not
   ask the question at all.

   ## Approving is the thing that moves the map

   Until phase 8 a sighting translated its cat's territory the instant it
   was made, and the panel said so out loud. Now it lands `pending` and
   changes nothing, and pressing Approve here is what applies it. So this
   panel is not an administrative afterthought bolted onto the side of the
   app: it is the step that was previously implicit, made visible.

   Discard writes a verdict rather than deleting the row (data/sightings.ts
   has the reasoning), so the record below the queue is a real audit trail:
   who, what, where, when, and now what was decided.

   ## Why this reads the repo rather than the store

   Everything here goes through data/catsRepo.ts, same as every other
   surface. The queue is the one place in the app allowed to see pending
   data belonging to somebody else, and having that live behind the repo's
   own functions is what will let phase 9 put it behind an authorised
   endpoint without touching this file. */

type Props = {
  /** A verdict was recorded. App re-reads the repo, which is what makes an
      approved sighting actually move its territory on the map behind this
      panel. The same callback the record panel uses, because from App's
      side these are the same event: the data changed, read it again. */
  onReviewed: () => void
}

type Row = { sighting: Sighting; cat: Cat | null }

export function ReviewQueue({ onReviewed }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Row[]>([])
  const [reviewed, setReviewed] = useState<Row[]>([])

  useEscape(open, () => setOpen(false))

  /* Read on open, and again after every verdict. Not subscribed: a queue
     that reshuffles under the pointer while somebody is deciding about the
     row they are looking at is a way to approve the wrong thing. */
  const load = useCallback(async () => {
    const [cats, waiting, decided] = await Promise.all([
      listCats(),
      listPending(),
      listReviewed(),
    ])
    const byId = new Map(cats.map((cat) => [cat.id, cat]))
    /* A sighting whose cat has since been deleted still shows, with the id
       in place of a name. It is a record of something somebody did, and
       hiding it because the subject is gone would leave a submission that
       can never be resolved sitting in the store forever. */
    const join = (list: Sighting[]) =>
      list.map((sighting) => ({ sighting, cat: byId.get(sighting.catId) ?? null }))
    setPending(join(waiting))
    setReviewed(join(decided))
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function decide(id: string, catId: string, verdict: 'surveyed' | 'discarded') {
    if (!(await reviewSighting(id, catId, verdict))) return
    await load()
    onReviewed()
  }

  return (
    <>
      <button
        type="button"
        className="review-trigger"
        aria-label={
          pending.length > 0 ? `Review queue, ${pending.length} waiting` : 'Review queue'
        }
        onClick={() => setOpen((was) => !was)}
      >
        <ClipboardList size={16} />
        Review
        {/* The count is read on open, so before the first open it is 0 and
            this badge is absent. That is the honest state: the panel has
            not looked yet, and a badge showing a number it has not fetched
            would be a guess wearing a certainty. */}
        {pending.length > 0 && <span className="review-count">{pending.length}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            className="review"
            aria-label="Review queue"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
            transition={springSoft}
          >
            <div className="review-head">
              <p className="review-eyebrow">Awaiting review</p>
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
              {pending.length === 0 ? (
                <p className="review-empty">
                  Nothing waiting. Reported sightings land here before they move anything on the
                  map.
                </p>
              ) : (
                <ul className="review-list">
                  <AnimatePresence mode="popLayout">
                    {pending.map(({ sighting, cat }) => (
                      <motion.li
                        key={sighting.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={spring}
                        style={
                          cat ? ({ '--accent': `var(${cat.colour})` } as React.CSSProperties) : undefined
                        }
                      >
                        <div className="review-what">
                          <p className="review-name">{cat ? cat.name : sighting.catId}</p>
                          <p className="review-when">
                            Seen {describeWhen(sighting.at).toLowerCase()} ·{' '}
                            {sighting.point[1].toFixed(4)}, {sighting.point[0].toFixed(4)}
                          </p>
                        </div>

                        <div className="review-actions">
                          <button
                            type="button"
                            className="review-no"
                            onClick={() => void decide(sighting.id, sighting.catId, 'discarded')}
                          >
                            <X size={14} />
                            Discard
                          </button>
                          <button
                            type="button"
                            className="review-yes"
                            onClick={() => void decide(sighting.id, sighting.catId, 'surveyed')}
                          >
                            <Check size={14} />
                            Approve
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}

              {/* The audit trail. Not a separate panel: what was decided is
                  the context for what is waiting, and an admin comparing a
                  new report against the last one they turned down should
                  not have to go and find it. */}
              {reviewed.length > 0 && (
                <>
                  <p className="review-eyebrow review-past">Decided</p>
                  <ul className="review-log">
                    {reviewed.map(({ sighting, cat }) => (
                      <li key={sighting.id} data-verdict={sighting.status}>
                        <span>{cat ? cat.name : sighting.catId}</span>
                        <span>{describeWhen(sighting.at)}</span>
                        <span>{sighting.status === 'surveyed' ? 'Approved' : 'Discarded'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <p className="review-foot">
              Every visitor sees these decisions, like everything else the survey stores. An
              approved sighting moves its cat's territory; a discarded one stays on the record as
              a decision.
            </p>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
