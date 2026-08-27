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
    `firebase/auth` directly — same reasoning catsRepo.ts already gives
    for being the one file that knows what storage looks like underneath
    it. Returns the unsubscribe function React effects expect back. */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}

/** Whether `uid` has an `admins/{uid}` marker doc (firestore.rules'
    `isAdmin()`, mirrored here for the client to decide what to render;
    the rules are what actually enforce it, this is only ever a read). */
export async function isAdmin(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'admins', uid))
  return snap.exists()
}

export type { User }
