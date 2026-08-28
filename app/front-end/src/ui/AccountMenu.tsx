import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LogIn, User, X } from 'lucide-react'
import { signInWithGoogle } from '@/data/auth'
import { useEscape } from '@/ui/escape'
import { spring, springSoft } from '@/motion/springs'

/* The signed-out visitor's counterpart to App.tsx's admin banner and
   user-chip, and the thing that gap always lacked: with neither showing (the
   `!admin && !user` case), the app had no chrome that said "you can be
   somebody here" at all. The only sign-in prompt anywhere was buried behind
   Report a sighting (ui/ReportSighting.tsx's own confirm step), reachable
   only by a visitor who had already committed to reporting and got stopped
   partway through, not by someone who might sign in first because they want
   to vote on somebody else's report or just see what account features do.

   Stacked directly above ui/ReportSighting.tsx's "I saw a cat" trigger on
   desktop, same bottom-left corner: that is already the visitor's own
   quiet corner (that file's own note on the corner choice), so a second
   visitor control belongs in the same column rather than opening a new
   spot on screen. Below the 900px breakpoint (shell.css's own mobile
   override) it moves to top-right instead, the same corner .admin-controls
   claims there when it is mounted: two hamburger-ish controls stacked on a
   phone-width column read as one crowded thing rather than two, so mobile
   splits them onto opposite corners the way desktop already splits
   .sight-open (left) from .admin-controls (right). The two conditions
   never overlap, since this only mounts for `!admin && !user` and
   .admin-controls only for `admin`.

   Mounted whenever nobody is signed in (App.tsx's `!admin && !user`); once
   somebody signs in, App.tsx swaps in .user-chip instead, elsewhere on
   screen (top-centre), a standing status readout rather than an action, so
   the two are not meant to occupy the same spot.

   An icon opening a small panel rather than a bare button, on request: one
   row today (sign in), but the trigger and panel shape already match
   ReviewQueue's and About's (icon toggles a floating panel, Escape closes
   it), so a second row later, e.g. a link to what signing in is for, is a
   list item away rather than a redesign.

   The glyph is a person, not a hamburger: ui/ReportSighting.tsx's own
   "I saw a cat" trigger already owns the hamburger-crosses-to-X glyph, so
   reusing it here for a second, differently-purposed trigger would leave
   two hamburgers on screen with no way to tell them apart at a glance. A
   person glyph also reads correctly for what this button actually is: an
   account control, not a navigation menu. */

export function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscape(open, () => setOpen(false))

  async function signIn() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle()
      /* No setOpen(false) here: subscribeAuth firing flips App.tsx's `user`
         from null to a User, which unmounts this component (and its panel)
         from the outside, same as every other sign-in prompt in this app
         (ui/ReportSighting.tsx's own confirm-step button behaves the same
         way). Closing it here too would just be a state update racing its
         own unmount. */
    } catch {
      setError('Could not sign in. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="account-menu-trigger"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <User size={16} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            className="account-menu-panel"
            aria-label="Sign in"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.14 } }}
            transition={springSoft}
          >
            <div className="account-menu-head">
              <p className="account-menu-eyebrow">Meowtro</p>
              <button
                type="button"
                className="account-menu-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            <p className="account-menu-copy">
              Sign in to report sightings and vote on reports other visitors have made.
            </p>

            <motion.button
              type="button"
              className="account-menu-signin"
              whileTap={{ scale: 0.97 }}
              transition={spring}
              disabled={busy}
              onClick={() => void signIn()}
            >
              <LogIn size={14} />
              {busy ? 'Signing in…' : 'Sign in with Google'}
            </motion.button>

            {error && (
              <p className="account-menu-error" role="alert">
                {error}
              </p>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
