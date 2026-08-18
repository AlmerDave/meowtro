import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { X } from 'lucide-react'
import type { Cat } from '@/data/catsRepo'
import { CatRow } from '@/ui/CatRow'
import { Plate } from '@/plate/Plate'
import { spring, springSoft } from '@/motion/springs'

/* The mobile presentation. Replaces the bottom sheet entirely.

   ## Why not a sheet

   Two sheet designs were built and both were wrong for this app.

   The first put the cat index in a drawer and swapped the whole panel for a
   plate on selection, with an "All cats" button back. That is page-to-page
   navigation inside a sheet, the misuse Nielsen Norman's bottom-sheet
   guidance names outright, and on a map it hid every other cat the moment
   you picked one.

   The second fixed the navigation by paging the index horizontally, which
   was right, but kept the drawer around it. That still left a permanent
   168px of chrome with a drag handle sitting over the map, and getting back
   to the map meant dragging furniture out of the way. On an app whose whole
   subject is the map, the panel should not be the thing you have to manage.

   ## What this is instead

   Cards floating directly on the map, and nothing else. There is no sheet,
   no handle and no detents, so at rest there is nothing to dismiss: the map
   is fully visible and fully pannable everywhere above the cards. "Go back
   to the map" costs zero gestures because you never left it.

   Tapping a card raises the full plate, and the card's photo flies into the
   plate's hero, the same shared-element move the desktop rail makes, so
   both presentations have the same signature rather than two. Getting out is
   a large close button, a tap on the scrim, Escape, or a drag down from the
   grabber: four ways out, which is three more than the sheet had.

   ## Why no carousel library

   Paging is native CSS scroll-snap. Momentum, rubber-banding at the ends,
   keyboard scrolling and the accessibility tree are all the platform's, and
   the component only reads where the scroller settled. Embla is 7KB for
   velocity-based drag physics and looping, and a three-card deck on a
   touchscreen that already has inertial scrolling needs neither. */

type Props = {
  cats: Cat[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

export function CatDeck({ cats, selectedId, onSelect, onHover }: Props) {
  /* Local, not lifted to App. Selection is shared with the map and belongs
     upstairs; "is the plate open" is this presentation's own business and
     the desktop rail has no equivalent of it, there, selection and open are
     the same event. Keeping it here is what lets App carry one selection
     for both layouts instead of a second flag the desktop half ignores.

     It is also what makes tapping a territory on the map scroll the deck
     without throwing a full-screen panel over the map you just tapped. */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /* Tab stays inside the open panel. aria-modal="true" tells assistive tech
     that everything outside is inert, but it does nothing to the tab order,
     without this, Tab walks straight out of a "modal" dialog into the map
     controls sitting behind the scrim, and the claim the ARIA makes is
     simply false. The deck is handled separately by `inert`; this covers
     everything else on the page.

     A wrap rather than a library: two edges, one keydown handler, and the
     panel is the only dialog in the app. */
  useEffect(() => {
    const panel = panelRef.current
    if (!expandedId || !panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      // Also catches focus having escaped already (or never entered), by
      // treating anything outside the panel as "past the end".
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        last.focus()
        e.preventDefault()
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus()
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expandedId])

  /* Opening moves focus into the panel. Without this, focus stays on the
     card button that was just made inert, so the browser drops it to <body>
     and the next Tab starts from the top of the document, and a screen
     reader is left reading the map it can no longer reach. */
  useEffect(() => {
    if (expandedId) panelRef.current?.focus({ preventScroll: true })
  }, [expandedId])

  /* Closing returns focus to the card that opened the panel rather than to
     the top of the document, the same courtesy App does for the rail. */
  const collapse = () => {
    const id = expandedId
    setExpandedId(null)
    if (id) requestAnimationFrame(() => document.getElementById(`cat-row-${id}`)?.focus())
  }

  const deckRef = useRef<HTMLDivElement>(null)

  /* Guards the two-way sync between the deck's scroll position and the
     selection. Without it, selecting from the map scrolls the deck, the
     scroll reports a new selection, and that selection scrolls the deck
     again, the classic controlled-scroll feedback loop. */
  const scrolling = useRef(false)

  /* Drag-to-dismiss is started from the grabber, never from the panel body.
     dragListener={false} plus explicit controls is the only way to have a
     draggable container whose content also scrolls: with the default
     listener, a flick to scroll the plate would throw the whole panel off
     the bottom of the screen. */
  const dragControls = useDragControls()

  const expanded = cats.find((c) => c.id === expandedId) ?? null

  const panelRef = useRef<HTMLDivElement>(null)

  /* Where a settled card's left edge actually comes to rest, in viewport
     coordinates: the deck's border-box left PLUS its inline padding, because
     scroll-padding-inline-start pushes snap positions in by that much.

     Both halves of the sync have to measure against this same line, and
     using the bare rect left was a real bug rather than an imprecision. It
     is off by exactly the padding, which is larger than the 8px tolerance
     below, so the "already in place" guard could never pass: every swipe
     fired a redundant scrollIntoView, which set the scrolling flag, which
     then swallowed the *next* genuine settle. Selection updated on every
     other swipe. */
  const leadingEdge = (deck: HTMLElement) =>
    deck.getBoundingClientRect().left + parseFloat(getComputedStyle(deck).paddingLeft || '0')

  // Selection in -> deck scrolls. Covers tapping a territory on the map.
  useEffect(() => {
    const deck = deckRef.current
    if (!deck || !selectedId) return
    const card = deck.querySelector<HTMLElement>(`[data-cat='${selectedId}']`)
    if (!card) return
    // Already in place (this selection came from the deck), scrolling again
    // would fight the finger still on it.
    if (Math.abs(card.getBoundingClientRect().left - leadingEdge(deck)) < 8) return
    scrolling.current = true
    /* scrollIntoView rather than scrollTo(offsetLeft): offsetLeft includes
       the deck's inline padding, so scrolling to it overshoots by exactly
       that padding on every card. scrollIntoView knows about
       scroll-padding. */
    card.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }, [selectedId])

  /* Deck scrolls -> selection out. scrollend rather than a debounced scroll
     handler: it fires once after momentum and snapping have both finished,
     so a flick across three cards reports one selection instead of three. */
  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return

    const settle = () => {
      if (scrolling.current) {
        scrolling.current = false
        return
      }
      const edge = leadingEdge(deck)
      const cards = Array.from(deck.querySelectorAll<HTMLElement>('[data-cat]'))
      const nearest = cards.reduce<HTMLElement | null>((best, card) => {
        if (!best) return card
        return Math.abs(card.getBoundingClientRect().left - edge) <
          Math.abs(best.getBoundingClientRect().left - edge)
          ? card
          : best
      }, null)
      const id = nearest?.dataset.cat
      if (id && id !== selectedId) onSelect(id)
    }

    /* Detected on window, not on the element: TypeScript's DOM lib has no
       onscrollend on HTMLDivElement yet, so `in deck` narrows the element to
       never in the true branch. Same feature, no narrowing. */
    if ('onscrollend' in window) {
      deck.addEventListener('scrollend', settle)
      return () => deck.removeEventListener('scrollend', settle)
    }
    let timer: number
    const onScroll = () => {
      clearTimeout(timer)
      timer = window.setTimeout(settle, 140)
    }
    deck.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      deck.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [selectedId, onSelect])

  return (
    <>
      {/* The index. Stays mounted and stays on the map while a plate is
          open, it is behind the scrim, so it is dimmed rather than gone,
          which is what makes closing read as coming back down to it. */}
      <motion.div
        className="cat-deck"
        ref={deckRef}
        data-lenis-prevent
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSoft, delay: 0.1 }}
        /* inert, not aria-hidden. The cards are real buttons, and
           aria-hidden over focusable content is invalid: it hides them from
           a screen reader while leaving them in the tab order, so you can
           focus something that is not announced. inert removes them from
           both, and stops pointer events reaching them behind the scrim. */
        inert={expanded ? true : undefined}
      >
        {cats.map((cat) => (
          <div className="cat-deck-item" key={cat.id} data-cat={cat.id}>
            <CatRow
              cat={cat}
              selected={cat.id === selectedId}
              marker={false}
              // Only the expanded cat's photo may leave. Swiping selects
              // without opening, and a selected-but-closed card must keep
              // its thumbnail.
              photoAway={cat.id === expandedId}
              onSelect={() => {
                onSelect(cat.id)
                setExpandedId(cat.id)
              }}
              onHover={(hovering) => onHover(hovering ? cat.id : null)}
            />
          </div>
        ))}
      </motion.div>

      <AnimatePresence>
        {expanded && (
          <>
            {/* Dims the map and the deck, and is itself the largest possible
                close target. A scrim you can tap is the single most reliable
                way out of a panel on a phone, and it costs no chrome. */}
            <motion.button
              type="button"
              className="cat-scrim"
              aria-label="Close and return to the map"
              /* Out of the tab order on purpose. It is a pointer shortcut
                 that duplicates the close button, and aria-modal hides it
                 from assistive tech anyway, leaving it tabbable would put a
                 full-screen unlabelled-looking stop between the panel's real
                 controls. */
              tabIndex={-1}
              onClick={collapse}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            <motion.div
              className="cat-panel"
              ref={panelRef}
              /* A dialog by behaviour, it covers the app, traps interaction
                 behind a scrim and is dismissed as a unit, so it has to be
                 one in the accessibility tree too. tabIndex -1 makes it a
                 focus target without putting it in the tab order. */
              role="dialog"
              aria-modal="true"
              aria-label={expanded.name}
              tabIndex={-1}
              /* Rises from the bottom edge it was tapped on. The photo makes
                 its own journey from the card underneath on a shared
                 layoutId, so this only has to carry the frame. */
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springSoft}
              drag="y"
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              /* Elastic downward only. Dragging up from the grabber should
                 meet resistance and stop, there is nothing above. */
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                /* Distance OR speed, not distance alone: a quick flick down
                   is a dismissal even if the finger only travelled 40px, and
                   requiring a long drag is what makes hand-rolled sheets feel
                   sticky. */
                if (info.offset.y > 140 || info.velocity.y > 550) collapse()
              }}
            >
              {/* A bar, not two absolutely-positioned things. The close used
                  to be positioned against the panel and was tall enough to
                  hang over the top of the hero photo below it; giving the two
                  a row of their own is what stops that, and it is also the
                  only way the grabber stays centred on the panel rather than
                  centred on whatever space the close leaves. */}
              <div className="cat-panel-head">
                {/* The drag origin, and the only one. Fills the bar so the
                    whole strip is grabbable, with touch-action: none in CSS
                    so the browser hands the vertical gesture to Motion here
                    instead of trying to scroll the page with it. */}
                <div
                  className="cat-panel-grab"
                  onPointerDown={(e) => dragControls.start(e)}
                  aria-hidden
                >
                  <span />
                </div>

                {/* Sits above the grabber so its taps are not swallowed by
                    the drag surface underneath. */}
                <motion.button
                  type="button"
                  className="cat-panel-close"
                  aria-label={`Close ${expanded.name}`}
                  onClick={collapse}
                  whileTap={{ scale: 0.9 }}
                  transition={spring}
                >
                  <X size={18} />
                </motion.button>
              </div>

              <div className="cat-panel-body" data-lenis-prevent>
                <Plate cat={expanded} onClose={collapse} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
