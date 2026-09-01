import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/firebase'
import type { User } from './auth'

/* Feeder status, the second trust tier after admin (spec
   docs/superpowers/specs/2026-09-01-territory-visibility-decoy-design.md).
   `feeders/{uid}` is a marker doc exactly like `admins/{uid}`: written
   only by an admin (the in-app Feeder requests panel, approveFeeder
   below), read by any signed-in caller to decide what the map shows.
   Applying for it is a separate `feederRequests/{uid}` doc, never a
   self-write to `feeders`.

   Same role data/auth.ts plays for auth: callers never import
   firebase/firestore for this, they come through here. */

export type FeederStatus = 'none' | 'pending' | 'approved'

export type FeederRequest = {
  uid: string
  name: string
  email: string
  reason: string
  /** Epoch ms, for oldest-first ordering in the admin queue. */
  at: number
}

/** Whether `uid` holds a `feeders/{uid}` marker. Mirrors auth.ts's
    isAdmin: the rules are what enforce access, this is only ever the read
    the client uses to pick what to render. */
export async function isFeeder(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'feeders', uid))
  return snap.exists()
}

/** approved if the marker exists, else pending if a request is open, else
    none. The extra read on the "none" path is fine: this runs once when
    the account menu opens, not on every render. */
export async function myFeederStatus(uid: string): Promise<FeederStatus> {
  if ((await getDoc(doc(db, 'feeders', uid))).exists()) return 'approved'
  if ((await getDoc(doc(db, 'feederRequests', uid))).exists()) return 'pending'
  return 'none'
}

/** A signed-in visitor asking to be approved. Keyed by uid, so a re-apply
    after a decline is a fresh write to the same path. name/email come off
    the Google account so the admin has something to recognise; the same
    fallback chain data/auth.ts's greetingName uses. */
export async function applyAsFeeder(user: User, reason: string): Promise<boolean> {
  const trimmed = reason.trim()
  if (!trimmed) return false
  try {
    await setDoc(doc(db, 'feederRequests', user.uid), {
      name: user.displayName?.trim() || user.email?.split('@')[0] || 'Unknown',
      email: user.email ?? '',
      reason: trimmed.slice(0, 500),
      at: Date.now(),
    })
    return true
  } catch {
    return false
  }
}

/** The admin queue, oldest first (a queue is worked from the front, same
    reasoning as data/catsRepo.ts's listPending). Admin-only at the rule
    level; this function verifies nothing itself. */
export async function listFeederRequests(): Promise<FeederRequest[]> {
  const snap = await getDocs(collection(db, 'feederRequests'))
  return snap.docs
    .map((d) => ({ uid: d.id, ...(d.data() as Omit<FeederRequest, 'uid'>) }))
    .sort((a, b) => a.at - b.at)
}

/** Approve: write the marker and clear the request together, so a viewer
    can never be left reading as both pending and approved. */
export async function approveFeeder(uid: string): Promise<boolean> {
  try {
    const batch = writeBatch(db)
    batch.set(doc(db, 'feeders', uid), { at: Date.now() })
    batch.delete(doc(db, 'feederRequests', uid))
    await batch.commit()
    return true
  } catch {
    return false
  }
}

/** Decline: drop the request, write no marker. A re-apply is allowed (a
    fresh create at the same path). */
export async function declineFeeder(uid: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'feederRequests', uid))
    return true
  } catch {
    return false
  }
}
