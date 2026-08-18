import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Search, X } from 'lucide-react'
import type { Cat } from '@/data/catsRepo'
import { CatRow } from '@/ui/CatRow'
import { spring, springSoft } from '@/motion/springs'

/* The index rail. Was a static list inside App.tsx; it is its own file
   now because it grew three behaviours (filter, keyboard nav, collapse) that
   have nothing to do with App's job of holding selection state.

   Keyboard model, deliberately built on native focus rather than ARIA
   combobox roles: the rows are real buttons, so moving DOM focus between them
   is already announced correctly and already activates on Enter/Space. An
   aria-activedescendant listbox layered over real buttons would be two
   competing focus models describing the same thing. Cmd/Ctrl+K and "/" reach
   the field, ArrowDown/Up walk the rows, Escape steps back out. */

type Props = {
  cats: Cat[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

export function Rail({ cats, selectedId, onSelect, onHover }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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
      const typingElsewhere =
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement !== inputRef.current
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typingElsewhere)) {
        e.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
        inputRef.current?.select()
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
    <motion.nav className="rail" layout transition={springSoft} data-open={String(open)}>
      <div className="rail-head">
        <div className="rail-title">
          <h1>Meowtro</h1>
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
                     also blurred would spend two states on one press. */
                  if (e.key === 'Escape') {
                    if (query) setQuery('')
                    else inputRef.current?.blur()
                  }
                }}
              />
              {query ? (
                <button type="button" className="rail-clear" aria-label="Clear search" onClick={clear}>
                  <X size={13} />
                </button>
              ) : (
                <kbd aria-hidden>⌘K</kbd>
              )}
            </div>

            <p className="rail-count">
              {query
                ? shown.length + ' of ' + cats.length + ' residents'
                : cats.length + ' residents · 3 survey lines'}
            </p>

            <div className="rail-list" ref={listRef} onKeyDown={onListKeyDown}>
              <AnimatePresence initial={false} mode="popLayout">
                {shown.map((cat) => (
                  <motion.div
                    key={cat.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -12, transition: { duration: 0.14 } }}
                    transition={springSoft}
                  >
                    <CatRow
                      cat={cat}
                      selected={cat.id === selectedId}
                      onSelect={() => onSelect(cat.id === selectedId ? null : cat.id)}
                      onHover={(hovering) => onHover(hovering ? cat.id : null)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* An empty screen is an invitation to act, not an apology. */}
              {!shown.length && (
                <motion.p className="rail-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
