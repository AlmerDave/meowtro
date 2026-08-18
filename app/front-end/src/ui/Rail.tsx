import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Search, X } from 'lucide-react'
import type { Cat } from '@/data/catsRepo'
import { CatRow } from '@/ui/CatRow'
import { Specular } from '@/ui/Specular'
import { spring, springSoft } from '@/motion/springs'

/* The index rail. Was a static list inside App.tsx; it is its own file
   now because it grew three behaviours (filter, keyboard nav, collapse) that
   have nothing to do with App's job of holding selection state.

   It is framed as the survey's console rather than a list in a box: a
   masthead that states what is being surveyed and reports that the survey is
   live, then the field, then the readout, then the rows. Everything below the
   masthead is one instrument reading out the same three cats, which is why
   the count line is set like an instrument label and not like a sentence.

   Keyboard model, deliberately built on native focus rather than ARIA
   combobox roles: the rows are real buttons, so moving DOM focus between them
   is already announced correctly and already activates on Enter/Space. An
   aria-activedescendant listbox layered over real buttons would be two
   competing focus models describing the same thing. Cmd/Ctrl+K and "/" reach
   the field, ArrowDown/Up walk the rows, Escape steps back out. */

type Props = {
  cats: Cat[]
  selectedId: string | null
  /** Round-trips back down so a territory hovered on the map lights its row.
      The rail reports hover upward already; this is the return leg. */
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

export function Rail({ cats, selectedId, hoveredId, onSelect, onHover }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /* The boot stagger runs once. After the first list has landed, a row
     appearing is the filter responding to a keystroke, and a keystroke that
     takes 200ms to show its result feels like lag rather than like
     choreography, so from then on rows arrive together. A ref, not state:
     nothing renders differently because of it, and re-rendering the list to
     record that it has finished animating would be the animation's own tail
     wagging the component. */
  const booted = useRef(false)
  useEffect(() => {
    if (cats.length) requestAnimationFrame(() => (booted.current = true))
  }, [cats.length])

  /* Derived, not the literal 3 this used to print. `line` is "LINE 03 ·
     TRACK 30TH" and the survey line is the part before the separator, which
     is the same split CatRow uses for its own label. A hardcoded count is
     true exactly until the fourth cat is added on a line that already
     exists. */
  const lines = useMemo(
    () => new Set(cats.map((c) => c.line.split(' · ')[0])).size,
    [cats],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cats
    // Searches everything a person might remember about a cat, not just the
    // name: "orange", "torn ear" and "32nd" all have to find someone.
    return cats.filter((c) =>
      [c.name, c.line, c.description, c.range, c.disposition].join(' ').toLowerCase().includes(q),
    )
  }, [cats, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Any text field, including this one. The previous version excluded
         the rail's own input from the check, which meant that typing "/"
         *into the search box* matched the shortcut: it swallowed the
         keystroke and selected the field instead of inserting the character.
         A search field you cannot type a "/" into is a bug on its own, and
         the mid-word select-all it did was worse.

         Cmd/Ctrl+K is deliberately not gated the same way, it is a global
         "go to search" and should work from wherever you are, which is the
         whole convention it borrows. */
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setOpen(true)
        /* Deferred a frame, and that is the whole fix rather than a
           flourish. While the rail is collapsed the search field is not
           mounted at all, AnimatePresence has unmounted the panel, so
           inputRef.current is null and focusing it synchronously did
           nothing. Pressing the shortcut from a collapsed rail expanded it
           and then left the caret nowhere, which is the one thing the
           shortcut exists to do. setOpen has committed by the next frame,
           so by then there is a field to focus. */
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.select()
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rows = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.cat-row') ?? [])

  const clear = () => {
    setQuery('')
    inputRef.current?.focus()
  }

  /* One delegated handler for the whole list instead of a handler per row:
     the rows are siblings in one container, so the container is the only
     place "the next one" is actually knowable. */
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return
    if (e.key === 'Escape') {
      inputRef.current?.focus()
      e.preventDefault()
      return
    }
    const all = rows()
    const next = all[all.indexOf(document.activeElement as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : -1)]
    /* Walking up off the top returns to the field, which is where the list
       was entered from. Walking down off the bottom stays put rather than
       wrapping: a silent jump back to the top reads as a lost keypress. */
    if (next) next.focus()
    else if (e.key === 'ArrowUp') inputRef.current?.focus()
    else return
    e.preventDefault()
  }

  return (
    <motion.nav
      className="rail"
      layout
      transition={springSoft}
      data-open={String(open)}
      /* The panel's own arrival. Slightly under the rounded corner's own
         travel so the card reads as settling onto the map rather than being
         thrown at it. */
      initial={{ opacity: 0, x: -20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
    >
      <Specular />

      <div className="rail-head">
        <div className="rail-title">
          <h1>
            Meowtro
            {/* The survey is live: this is the only always-moving thing in
                the UI, and it is two seconds long so it reads as a pulse
                rather than as a spinner. Purely ambient, it reports no
                state that changes, only that the instrument is on. */}
            <span className="rail-live" aria-hidden />
          </h1>
          <p>Bonifacio Global City</p>
        </div>
        <motion.button
          type="button"
          className="rail-collapse"
          aria-expanded={open}
          aria-label={open ? 'Collapse the index' : 'Expand the index'}
          onClick={() => setOpen(!open)}
          whileTap={{ scale: 0.9 }}
          transition={spring}
        >
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={spring}>
            <ChevronDown size={16} />
          </motion.span>
        </motion.button>
      </div>

      {/* height: auto is a real Motion animation, not a CSS transition: CSS
          cannot interpolate to auto, and every hand-rolled max-height trick
          ends up easing at the wrong speed in one of the two directions. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="rail-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springSoft}
          >
            <div className="rail-search">
              <Search size={14} aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="Search the survey"
                aria-label="Search cats"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    rows()[0]?.focus()
                    e.preventDefault()
                  }
                  if (e.key === 'Enter' && shown.length) {
                    onSelect(shown[0].id)
                    e.preventDefault()
                  }
                  /* Clear first, leave second. Escape on a filled field that
                     also blurred would spend two states on one press.

                     stopPropagation because Plate also listens for Escape on
                     window, so one press was doing two unrelated things:
                     clearing the query AND closing the open plate. Escape
                     cancels the innermost thing, and while the caret is in
                     this field that is this field. */
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    if (query) setQuery('')
                    else inputRef.current?.blur()
                  }
                }}
              />
              {query ? (
                <motion.button
                  type="button"
                  className="rail-clear"
                  aria-label="Clear search"
                  onClick={clear}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.85 }}
                  transition={spring}
                >
                  <X size={13} />
                </motion.button>
              ) : (
                <kbd aria-hidden>⌘K</kbd>
              )}
            </div>

            {/* Two readouts on one line: what is on screen, and what it was
                filtered from. The filtered count is keyed on its own value so
                the digit swaps rather than being silently rewritten, the one
                number here that changes while you watch it. */}
            <p className="rail-count">
              <span className="rail-count-n">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={shown.length}
                    initial={{ y: '-100%', opacity: 0 }}
                    animate={{ y: '0%', opacity: 1 }}
                    exit={{ y: '100%', opacity: 0 }}
                    transition={spring}
                  >
                    {shown.length}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span>
                {query ? `of ${cats.length} residents` : `residents · ${lines} survey lines`}
              </span>
            </p>

            <div className="rail-list" ref={listRef} onKeyDown={onListKeyDown}>
              <AnimatePresence mode="popLayout">
                {shown.map((cat, i) => (
                  <motion.div
                    key={cat.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -12, transition: { duration: 0.14 } }}
                    transition={
                      booted.current ? springSoft : { ...springSoft, delay: 0.06 + i * 0.055 }
                    }
                  >
                    <CatRow
                      cat={cat}
                      selected={cat.id === selectedId}
                      hovered={cat.id === hoveredId}
                      onSelect={() => onSelect(cat.id === selectedId ? null : cat.id)}
                      onHover={(hovering) => onHover(hovering ? cat.id : null)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* An empty screen is an invitation to act, not an apology. */}
              {!shown.length && (
                <motion.p
                  className="rail-empty"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <span>No cat on record matches that.</span>
                  <button type="button" onClick={clear}>
                    Show all {cats.length}
                  </button>
                </motion.p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
