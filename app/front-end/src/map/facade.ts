/* The building facade pattern, spec rev 6 §2.5. Drawn to a canvas at
   runtime and handed to MapLibre as an image, because
   `fill-extrusion-pattern` takes an image id, and MapLibre cannot tint a
   pattern the way it tints `fill-extrusion-color`. That is also why this is
   regenerated per theme rather than recoloured in place.

   This module deliberately knows nothing about themes or tokens: it takes
   two already-resolved colour strings and a density. style.ts owns the
   token probe and the per-theme recipe, which keeps the only part of this
   file with real logic (windowCells) free of anything that needs a browser
   to evaluate. */

/** Tile size in px. 128 keeps the grid crisp across the zooms this map
    allows (14.6 to 17) without paying for a large texture upload on every
    theme flip. */
const TILE = 128

export const FACADE_COLS = 8
export const FACADE_ROWS = 8

export const FACADE_IMAGE_ID = 'building-facade'

/* A seeded LCG, not Math.random: the pattern is regenerated on every theme
   change, and an unseeded shuffle would move every lit window each time the
   user toggled day and night. Same seed, same building. */
const lcg = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Which cells of a cols x rows grid are lit. Pure and deterministic, which
    is the whole reason it is separate from the drawing below: it is the only
    part of this file that can be checked without a browser. See
    facade.check.ts. */
export function windowCells(
  seed: number,
  cols: number,
  rows: number,
  density: number
): boolean[] {
  const random = lcg(seed)
  const cells: boolean[] = []
  for (let i = 0; i < cols * rows; i++) cells.push(random() < density)
  return cells
}

/** The pattern tile. `base` must be the building's own colour: setting
    `fill-extrusion-pattern` overrides `fill-extrusion-color` entirely, so
    this image carries the wall, not just the windows.

    Returns null where there is no 2D context. Callers leave whatever is
    already painted in place rather than clearing to an untextured block
    half way through a theme change. */
export function facadeImage(
  base: string,
  glass: string,
  density: number,
  seed = 1
): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = base
  ctx.fillRect(0, 0, TILE, TILE)

  const cellWidth = TILE / FACADE_COLS
  const cellHeight = TILE / FACADE_ROWS
  // The gap between windows is the mullion. Floored at 1px so the grid never
  // closes up into a solid block if the tile or the cell count changes.
  const inset = Math.max(1, Math.round(cellWidth * 0.22))

  ctx.fillStyle = glass
  const cells = windowCells(seed, FACADE_COLS, FACADE_ROWS, density)
  cells.forEach((lit, i) => {
    if (!lit) return
    const x = (i % FACADE_COLS) * cellWidth
    const y = Math.floor(i / FACADE_COLS) * cellHeight
    ctx.fillRect(x + inset, y + inset, cellWidth - inset * 2, cellHeight - inset * 2)
  })

  return ctx.getImageData(0, 0, TILE, TILE)
}
