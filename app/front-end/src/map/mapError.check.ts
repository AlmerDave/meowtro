import assert from 'node:assert/strict'
import { isFatalMapError, BASEMAP_SOURCE } from './mapError'

/* The one runnable check behind the failure panel. Both directions of this
   rule are user-visible and neither one throws when it is wrong: too eager
   and a working map wears an error card, too shy and a dead map says
   nothing at all.

   Run: npm run check:maperror (there is no test runner in this project, so
   this compiles itself and runs on node). */

// Before the first paint. The pmtiles case: the protocol handler rejects,
// the style never resolves, and MapLibre has no source to blame.
assert.equal(isFatalMapError({ error: new Error('pmtiles: 404') }, false), true, 'no source, not painted')

// Same moment, and it is the basemap that failed by name.
assert.equal(
  isFatalMapError({ sourceId: BASEMAP_SOURCE, error: new Error('nope') }, false),
  true,
  'basemap source, not painted'
)

// Some other source failing before first paint is not the basemap dying.
// Territories and CatMarkers add their own GeoJSON sources, and a fault in
// one of those leaves the city on screen.
assert.equal(
  isFatalMapError({ sourceId: 'territories', error: new Error('nope') }, false),
  false,
  'another source, not painted'
)

// After the first paint nothing is fatal, whatever it names. This is the
// clause the app lives inside: one aborted tile on a pan must never raise
// a panel over a map that is working.
for (const sourceId of [undefined, BASEMAP_SOURCE, 'territories']) {
  assert.equal(
    isFatalMapError({ sourceId, error: new Error('tile aborted') }, true),
    false,
    `painted, source ${String(sourceId)}`
  )
}

console.log('mapError: ok')
