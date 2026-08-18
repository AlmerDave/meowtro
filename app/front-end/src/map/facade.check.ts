/* The one runnable check in this project, spec rev 6 §7.

   `windowCells` is the only part of the facade with real logic (seeding,
   density, grid size) and the only part that does not need a canvas.
   Everything else in facade.ts is drawing, which a visual gate covers.

   No framework, and no test runner is being added: CLAUDE.md records that
   verification here is `npx tsc -b` plus visual review. Node 20 cannot strip
   TypeScript types, so this is bundled with the esbuild that Vite already
   depends on rather than run directly.

     npx esbuild src/map/facade.check.ts --bundle --platform=node \
       --format=esm --outfile=.facade-check.mjs && node .facade-check.mjs

   This file is not imported by the app and is excluded from the build. */
import assert from 'node:assert/strict'
import { FACADE_COLS, FACADE_ROWS, windowCells } from './facade'

// Length is always cols * rows, whatever the density.
assert.equal(windowCells(1, FACADE_COLS, FACADE_ROWS, 0.5).length, FACADE_COLS * FACADE_ROWS)
assert.equal(windowCells(1, 4, 2, 0.5).length, 8)

// Density 0 lights nothing and density 1 lights everything. These are the
// two extremes the real recipes actually use: light theme runs at 1.
assert.equal(windowCells(1, 8, 8, 0).filter(Boolean).length, 0)
assert.equal(windowCells(1, 8, 8, 1).filter(Boolean).length, 64)

// Deterministic: same seed, same grid. This is the property that stops the
// windows reshuffling every time the user toggles the theme.
assert.deepEqual(windowCells(7, 8, 8, 0.4), windowCells(7, 8, 8, 0.4))

// Different seeds must actually differ, or the LCG is degenerate and every
// building would carry an identical pattern.
assert.notDeepEqual(windowCells(7, 8, 8, 0.4), windowCells(8, 8, 8, 0.4))

// A mid density lands somewhere sane rather than at either rail. Wide bounds
// on purpose: this asserts the distribution is not degenerate, it does not
// pin the LCG's exact output.
const lit = windowCells(3, 16, 16, 0.35).filter(Boolean).length
assert.ok(lit > 40 && lit < 140, `expected a mid-range lit count, got ${lit}`)

console.log('facade.check.ts: all assertions passed')
