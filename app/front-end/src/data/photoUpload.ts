import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { storage } from '@/firebase'

/* One function, because that is everything a caller needs from Storage:
   hand it compressed bytes, get back a URL to put on a Cat or a Sighting.
   Nothing downstream (catsRepo.ts, sightings.ts) needs to know Storage
   exists at all, a photo is a URL string wherever it lands, same
   contract data/sightings.ts's own `photo` field note already promised. */

/** Uploads `blob` under `<folder>/<random id>.jpg` and returns its public
    download URL. The id is random rather than derived from the cat/
    sighting it belongs to: at upload time (RecordCat's step 0, before a
    cat exists yet) there is often no id to derive it from. */
export async function uploadPhoto(blob: Blob, folder: 'cats' | 'sightings'): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const path = `${folder}/${id}.jpg`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' })
  return getDownloadURL(storageRef)
}
