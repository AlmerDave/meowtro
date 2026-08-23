import { useEffect, useRef } from 'react'

/* Escape closes the innermost thing, and only that.

   Two panels are open at once on desktop more often than it looks: press
   "I saw MILO here" on a plate and the sighting panel opens over the plate
   that asked for it. Both listened for Escape on `window`, so one press ran
   both handlers — the report stepped back out of aiming AND the record
   behind it closed. Two unrelated things from one keystroke, which is the
   exact bug ui/Rail.tsx's search field already fixed for its own case.

   Neither panel could fix this alone. They are listeners on the same
   target, so there is no propagation for stopPropagation to stop, and
   stopImmediatePropagation resolves by registration order — which is mount
   order, which is not what "innermost" means.

   A stack is the fix, and it is the shape the platform itself uses for
   <dialog>: whatever opened last is what Escape is about. One window
   listener for the whole app, attached while anything is on the stack and
   removed when the last thing leaves, so an app with no panels open has no
   handler on the key at all.

   Anything that swallows Escape before it reaches window still wins, by
   design: the rail's search field calls stopPropagation so that clearing a
   query does not also close a plate, and that keeps working here.

   Verified the way map/Storm.tsx's keyframes are, since there is no test
   runner in this project (CLAUDE.md): bundle this file with esbuild against
   a react stub whose useEffect runs immediately and whose useRef is a box,
   give it a fake window with one listener slot, and assert that two active
   registrations produce ONE window listener, that a press runs only the
   last one registered, that the outer one takes over when the inner
   unregisters, that active: false never joins the stack, and that the
   listener is removed entirely once the stack empties. Re-run it that way
   if the ordering here is ever changed. */

type Entry = { fn: () => void }

const stack: Entry[] = []

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  stack[stack.length - 1]?.fn()
}

/** Run `onEscape` on the Escape key, but only while this is the innermost
    registered handler. `active` is a prop rather than a mount condition so
    a component that is always mounted (ui/ReportSighting.tsx) can join and
    leave the stack as it opens and closes. */
export function useEscape(active: boolean, onEscape: () => void) {
  /* The callback is read through a ref so that a handler closing over
     fresh state does not have to re-enter the stack to be current. Pushing
     again on every render would reorder the stack under a panel that had
     not moved, which is precisely the ordering this exists to get right. */
  const latest = useRef(onEscape)
  latest.current = onEscape

  useEffect(() => {
    if (!active) return
    const entry: Entry = { fn: () => latest.current() }
    if (!stack.length) window.addEventListener('keydown', onKey)
    stack.push(entry)
    return () => {
      stack.splice(stack.indexOf(entry), 1)
      if (!stack.length) window.removeEventListener('keydown', onKey)
    }
  }, [active])
}
