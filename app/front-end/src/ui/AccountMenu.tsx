import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LogIn, User as UserIcon, X } from 'lucide-react'
import { signInWithGoogle, type User } from '@/data/auth'
import { applyAsFeeder, myFeederStatus, type FeederStatus } from '@/data/feeders'
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

   As of the territory-visibility tier (spec 2026-09-01) this also carries
   the "Apply as a feeder" flow, so it now mounts for a signed-in non-feeder
   too (App.tsx's `!admin && !feeder`), not only while signed out. The panel
   switches on whether there is a `user`: the sign-in row for a stranger,
   the application form / status for somebody signed in who is not yet an
   approved feeder. An approved feeder or an admin never sees it (they
   already see accurate territories, so there is nothing here for them).

   Stacked directly above ui/ReportSighting.tsx's "I saw a cat" trigger on
   desktop, same bottom-left corner: that is already the visitor's own
   quiet corner (that file's own note on the corner choice), so a second
   visitor control belongs in the same column rather than opening a new
   spot on screen. Below the 900px breakpoint (shell.css's own mobile
   override) it moves to top-right instead, the same corner .admin-controls
   claims there when it is mounted; the two conditions never overlap, since
   .admin-controls only mounts for `admin` and this never does.

   A signed-in non-feeder briefly sees both this (bottom-left, the
   application) and .user-chip (top-centre, "Hi, X" and sign out): one is
   an action, the other a standing identity readout, so they are different
   things in different corners rather than a duplicate.

   An icon opening a small panel rather than a bare button, on request: the
   trigger and panel shape match ReviewQueue's and About's (icon toggles a
   floating panel, Escape closes it). The glyph is a person, not a
   hamburger: ui/ReportSighting.tsx's own "I saw a cat" trigger already
   owns the hamburger-crosses-to-X glyph. */

type Props = {
  /** The signed-in visitor, or null/undefined while signed out. Decides
      which face the panel shows. */
  user?: User | null
}

export function AccountMenu({ user = null }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<FeederStatus | 'unknown'>('unknown')
  const [reason, setReason] = useState('')

  useEscape(open, () => setOpen(false))

  /* Read on open, and only for a signed-in visitor: a stranger has no
     feeder status to fetch, and re-reading on every open is fine for a
     panel opened by hand once in a while. */
  useEffect(() => {
    if (!open || !user) return
    let live = true
    myFeederStatus(user.uid).then((s) => live && setStatus(s))
    return () => {
      live = false
    }
  }, [open, user])

  async function signIn() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle()
      /* No setOpen(false) here: subscribeAuth firing flips App.tsx's `user`,
         which re-renders this with a `user` prop and switches the panel to
         its signed-in face rather than unmounting it. */
    } catch {
      setError('Could not sign in. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!user) return
    setError(null)
    setBusy(true)
    const ok = await applyAsFeeder(user, reason)
    setBusy(false)
    if (ok) {
      setStatus('pending')
      setReason('')
    } else {
      setError('Could not send that. Try again.')
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
        <UserIcon size={16} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            className="account-menu-panel"
            aria-label={user ? 'Become a feeder' : 'Sign in'}
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

            {!user ? (
              <>
                <p className="account-menu-copy">
                  Sign in to report sightings and vote on reports other visitors have made.
                  Territories on the map are placed at random until you are approved as a feeder.
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
              </>
            ) : status === 'pending' ? (
              <p className="account-menu-copy">
                Your feeder application is with the survey. Once it is approved, territories on the
                map will show their true locations.
              </p>
            ) : status === 'approved' ? (
              <p className="account-menu-copy">
                You are an approved feeder. Territories show their true locations.
              </p>
            ) : (
              <>
                <p className="account-menu-copy">
                  Territories on the map are placed at random. Feeders see the true locations, so
                  they can look out for the cats. Tell the survey why you want in.
                </p>
                <textarea
                  className="account-menu-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Why do you want accurate cat locations?"
                  aria-label="Reason for applying"
                />
                <motion.button
                  type="button"
                  className="account-menu-signin"
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  disabled={busy || reason.trim().length === 0}
                  onClick={() => void apply()}
                >
                  {busy ? 'Sending…' : 'Apply as a feeder'}
                </motion.button>
              </>
            )}

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
