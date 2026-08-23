# Nice to have — backlog

Not scheduled. Ideas raised and parked during the 2026-08-23 session, kept
here so they aren't lost between sessions. Pick one and say go.

## The loop already approved

- Let a sighting attach a photo (admin-only capture, per session direction),
  stored in IndexedDB rather than localStorage.
- The plate's hero becomes "sightings of MILO" — a gallery that grows as the
  survey is used, not a single static photo.
- `data/identify.ts`'s mock/real seam is already shaped for this: once a
  server exists, sighting photos are already labelled training data.

## Making the mock read as a system

- `?role=admin` URL switch (same one-shot pattern `?cat=` already uses) that
  unparks `ui/RecordCat.tsx` live in a demo, no auth needed.
- Pending vs. surveyed status on a cat, now that visitors contribute data
  nobody has reviewed yet. Small, and it's the seam admin review clicks
  into later.

## Gaps in what's built

- Habitat pings (map/Territories.tsx) only ever show for the selected cat.
  Worth deciding, not assuming: a "show every cat's range at once" toggle
  gets noisy past a handful of cats.
- No offline/error state if `bgc.pmtiles` itself fails to load. Everything
  else in the app degrades gracefully (photos, search, storage); the map
  tile file does not.
- No way to undo a sighting once the 9-second toast disappears. It's the
  one destructive visitor action with no recovery after the fact.

## Performance and polish

- The `app` JS chunk is over 1MB post-gzip in the build warnings. Worth a
  `manualChunks` pass before any real deployment.
- A proper About/credits surface. The app borrows animation techniques,
  uses fictional cat data, and states a safety rule about real animals — a
  field guide like this typically shows its sources.

## Leftover files from reverted work

- `public/cat-loading.json` and `public/dotlottie-player.wasm` (~2MB) are
  unused — left from a Lottie loading-mark that was tried and reverted back
  to the cube (2026-08-23, "I like the cube better"). Predate the session
  that reverted them, so not deleted unilaterally. Delete when convenient.
