import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CAT_COLOURS } from './cats.seed'

/* The one runnable check behind the territory palette.

   A cat's colour is used as `color:` in the rail, the plate and the
   landing's roster, so every entry has to clear WCAG AA (4.5:1) against
   --paper, in all three themes. That is 24 numbers. Nobody is going to
   work them out by hand after re-tuning a mix weight, and getting one
   wrong throws nothing: it ships as a cat whose name is slightly hard to
   read, which is exactly how --sage got to 3.09:1 and stayed there.

   This reads tokens.css rather than keeping its own copy of the palette,
   because a check with its own copy of the thing it is checking verifies
   only that the copy is self-consistent. It parses the three theme blocks
   for the five base colours, parses the --cat-* block for the mixes, and
   resolves them the way the browser would.

   Run: npm run check:palette (there is no test runner in this project, so
   this compiles itself and runs on node). */

const AA_TEXT = 4.5

/* From the working directory, not from __dirname: this file is compiled
   into node_modules/.tmp before it runs, so its own location at runtime
   says nothing about where the stylesheet is. npm scripts run from the
   package root, which is the one stable anchor here. */
const css = fs.readFileSync(path.join(process.cwd(), 'src', 'tokens.css'), 'utf8')

/** The five base tokens, per theme. `paper` is the bare :root block. */
type Base = Record<string, string>

const BASE_NAMES = ['--paper', '--ink', '--ink-soft', '--rust', '--sage']

/* The first block under this selector that actually defines all five base
   colours.

   Every occurrence, not the first one, because a selector appears more than
   once in tokens.css and the first hit is usually the wrong block: the two
   glass themes share a materials block (`:root[data-theme='light'],
   :root[data-theme='dark'] {`) that sets radius and blur and no colours at
   all, and it comes before the block that sets dark's palette. Rather than
   encode which occurrence is the interesting one, which is the kind of
   number that is right until somebody adds a rule above it, this asks each
   block whether it is the one.

   The block is taken as everything up to the next line that is a lone
   closing brace. These blocks contain no nested rules, so that is enough
   and this does not need a CSS parser. */
function baseColours(selector: string): Base {
  for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
    const block = css.slice(at, css.indexOf('\n}', at))
    const out: Base = {}
    for (const name of BASE_NAMES) {
      const hit = new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})').exec(block)
      if (hit) out[name] = hit[1]
    }
    if (BASE_NAMES.every((name) => out[name])) return out
  }
  assert.fail(`no block under ${selector} defines all of ${BASE_NAMES.join(', ')}`)
}

const THEMES: Record<string, Base> = {
  // The bare :root IS the paper theme. There are two `:root {` blocks in
  // the file now (the base one and the palette), and indexOf finds the
  // first, which is the base one. If that ever stops being true the
  // assertions inside baseColours fail by name rather than silently.
  paper: baseColours(':root {'),
  light: baseColours(":root[data-theme='light'] {"),
  dark: baseColours(":root[data-theme='dark'] {"),
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const toHex = (c: number[]) =>
  '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

/** color-mix(in srgb, ...) interpolates channel-wise in gamma-encoded sRGB. */
const mix = (a: number[], weight: number, b: number[]) =>
  a.map((v, i) => v * weight + b[i] * (1 - weight))

/** Resolve one --cat-* declaration's value against a theme's base colours.
    Handles the three shapes actually used: a bare var(), a two-colour mix,
    and one mix nested inside another. */
function resolve(value: string, base: Base): number[] {
  const text = value.trim()

  const bare = /^var\((--[a-z-]+)\)$/.exec(text)
  if (bare) {
    assert.ok(base[bare[1]], `unknown base token: ${bare[1]}`)
    return rgb(base[bare[1]])
  }

  /* Greedy on purpose. In the one nested value (--cat-olive) there are two
     `NN%,` in the string, and the outer mix is the later one, so greedy
     matching splits at the right place and the head recurses. */
  const mixed = /^color-mix\(in srgb, (.+) (\d+)%, var\((--[a-z-]+)\)\)$/.exec(text)
  assert.ok(mixed, `unparsed palette value: ${text}`)
  const [, head, weight, tail] = mixed
  assert.ok(base[tail], `unknown base token: ${tail}`)
  return mix(resolve(head, base), Number(weight) / 100, rgb(base[tail]))
}

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (c: number[]) => {
  const [r, g, b] = c.map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

// Every colour the picker offers must exist in tokens.css. This is the
// clause that catches a swatch added to the list and not to the stylesheet,
// which renders as a transparent territory rather than as an error.
const declared = new Map<string, string>()
for (const hit of css.matchAll(/(--cat-[a-z]+):\s*([^;]+);/g)) declared.set(hit[1], hit[2])

let worst = { ratio: Infinity, where: '' }
for (const { token } of CAT_COLOURS) {
  const value = declared.get(token)
  assert.ok(value, `${token} is offered by CAT_COLOURS but not defined in tokens.css`)

  for (const [name, base] of Object.entries(THEMES)) {
    const ratio = contrast(resolve(value, base), rgb(base['--paper']))
    if (ratio < worst.ratio) worst = { ratio, where: `${token} on ${name}` }
    assert.ok(
      ratio >= AA_TEXT,
      `${token} on ${name}: ${ratio.toFixed(2)}:1 as text, under AA's ${AA_TEXT}. ` +
        `Mix it further toward --ink.`
    )
  }
}

console.log(
  `palette: ok, ${CAT_COLOURS.length} colours x ${Object.keys(THEMES).length} themes, ` +
    `worst ${worst.ratio.toFixed(2)}:1 (${worst.where})`
)
