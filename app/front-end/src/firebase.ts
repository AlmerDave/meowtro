import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

/* One Firebase app instance, module-scope, same reason map/MapCanvas.tsx
   sets up MapLibre's worker pool once at module scope: every consumer
   needs the same instance, and re-initializing on every import would be
   wrong rather than merely wasteful.

   VITE_* rather than plain env names: Vite only exposes prefixed vars to
   client code (anything else is a server-only secret it deliberately
   strips), and an API key here is public by design: Firebase's real
   access control is Firestore/Storage Security Rules, not this key. */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    'Missing Firebase config. Copy .env.local.example to .env.local and fill it in from the Firebase console.'
  )
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
