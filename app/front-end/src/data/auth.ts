import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/firebase'

/* Google only (design doc, "Auth"): one button, no password to create or
   reset, and Firebase Auth handles the whole popup/token exchange. */
const provider = new GoogleAuthProvider()

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, provider)
}

export async function signOutUser(): Promise<void> {
  await signOut(auth)
}

/** Wraps Firebase's own onAuthStateChanged so callers never import
    `firebase/auth` directly; same reasoning catsRepo.ts already gives
    for being the one file that knows what storage looks like underneath
    it. Returns the unsubscribe function React effects expect back. */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}

/** Whether `uid` has an `admins/{uid}` marker doc (firestore.rules'
    `isAdmin()`, mirrored here for the client to decide what to render;
    the rules are what actually enforce it, this is only ever a read).

    A failed read answers `false` rather than throwing. Every caller is a
    React effect that does `isAdmin(uid).then(setAdmin)` with no catch, so
    a denied or offline read used to surface as an unhandled rejection and
    leave the UI in whatever state it started in anyway. Answering here is
    the same outcome without the noise, and it is the correct answer to
    fail to: "we could not confirm you hold the gate" and "you do not hold
    the gate" must render identically, or a rules outage becomes a
    privilege escalation. The rules are still the thing that enforces it. */
export async function isAdmin(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid))
    return snap.exists()
  } catch {
    return false
  }
}

/** One-shot read of the signed-in uid, unlike subscribeAuth's ongoing
    subscription, for callers that only need a snapshot at the moment
    they ask (ui/About.tsx's open-time readout), not live updates for as
    long as they're mounted. */
export function getCurrentUid(): Promise<string | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      resolve(user?.uid ?? null)
    })
  })
}

/** What a "Hi, ___" greeting says: the Google account's own display name,
    or the local part of its email when there isn't one (a handful of
    Google Workspace accounts skip displayName). 'there' only if neither
    is set, which real Google sign-ins don't leave both empty. */
export function greetingName(user: User): string {
  return user.displayName?.trim() || user.email?.split('@')[0] || 'there'
}

export type { User }
