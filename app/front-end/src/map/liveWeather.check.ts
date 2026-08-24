import assert from 'node:assert/strict'
import { toWeather } from './liveWeather'

/* The one runnable check behind the sky. toWeather is a table of numeric
   ranges, which is exactly the shape of thing that silently misclassifies
   after an edit: get a boundary wrong and BGC sits in a thunderstorm on a
   sunny afternoon, with nothing throwing.

   Run: npm run check:weather (see package.json -- there is no test runner
   in this project, so this compiles itself and runs on node). */

// Clear-ish: WMO 0-3 is clear through overcast, 45/48 is fog. No effect
// to paint for any of them, so they all land on clear.
for (const code of [0, 1, 2, 3, 45, 48]) {
  assert.equal(toWeather(code), 'clear', `code ${code}`)
}

// Rain: drizzle (51-57), rain (61/63), showers (80/81).
for (const code of [51, 53, 55, 56, 57, 61, 63, 66, 80, 81]) {
  assert.equal(toWeather(code), 'rain', `code ${code}`)
}

// Storm: thunder (95/96/99) plus the heavy-rain codes the ask called
// stormy -- heavy rain (65), heavy freezing rain (67), violent showers (82).
for (const code of [65, 67, 82, 95, 96, 99]) {
  assert.equal(toWeather(code), 'storm', `code ${code}`)
}

// The boundaries the ranges hinge on, spelled out so an off-by-one shows up
// as a named failure rather than a weird sky.
assert.equal(toWeather(50), 'clear', 'below the drizzle floor')
assert.equal(toWeather(51), 'rain', 'the drizzle floor itself')
assert.equal(toWeather(86), 'rain', 'the top of the showers range')
assert.equal(toWeather(87), 'clear', 'past the top, and unmapped')

console.log('liveWeather: ok')
