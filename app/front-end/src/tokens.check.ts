import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* The stylesheets' own runnable check. There is no test runner here, so this
   compiles itself and runs on node: npm run check:tokens.

   It exists because two CSS defects shipped in this project and neither one
   could throw, log, or fail a typecheck. CSS's whole error model is "drop
   the declaration and carry on", which is exactly the wrong behaviour for a
   codebase whose stated rule (CLAUDE.md, "the token bridge") is that every
   size and colour resolves through one file.

     1. `.review-past { margin-top: var(--s-5) }`. The space scale is
        1/2/3/4/6/8/12/16 and has no 5, so the declaration was invalid and
        the block sat flush against the list above it. A typo in a token
        name is silence.

     2. app.css's shadcn bridge redefined `--accent` at :root, after
        tokens.css had set it to --rust. Both rules are unlayered, so source
        order settled it and the app's accent became --well (--ink at 4%).
        --accent is what every :focus-visible outline in shell.css and
        landing.css is drawn in, so the focus indicator was a 4% wash of the
        text colour on every control that does not belong to a specific cat.
        Nothing about that is visible in a diff of either file: it only
        exists in the two of them together.

   Both are the same class of bug, so both get the same check: read the
   stylesheets as text, and hold the token vocabulary to the two rules the
   project already says it lives by. */

/* cwd, not __dirname: npm run puts the working directory at app/front-end
   and the compiled copy of this file lands under node_modules/.tmp, which
   is a different depth from the source. Every check in this project is run
   through npm, so cwd is the stable one. */
const ROOT = process.cwd()

/** The stylesheets this project owns. Vendor CSS (tailwind, shadcn,
    maplibre) is deliberately not read: it has its own vocabulary and this
    check is about ours. */
const SHEETS = [
  'src/tokens.css',
  'src/app.css',
  'src/shell.css',
  'src/landing/landing.css',
  'src/styleguide.css',
]

/** Custom properties set from JavaScript rather than declared in CSS, so a
    stylesheet may read one it cannot be shown to define. Each is written as
    an inline style on the element that needs it:

      --accent    the cat a panel is about (CatRow, Plate, CatPin,
                  ReportSighting's picker cards, ReviewQueue's rows). It IS
                  declared in tokens.css as well, as the fallback for chrome
                  with no cat behind it; it is here only because the inline
                  write is the interesting one.
      --swatch    a colour button's own swatch (RecordCat, Plate's admin
                  colour picker).
      --cat       / --cat-own  the landing's roster chip and its copy.
      --fill      the scanner's confidence bar.

    Kept as an explicit list rather than a "well, it might be inline"
    escape hatch: a token that is neither declared nor on this list is a
    typo, which is the whole point. */
const SET_IN_JS = new Set(['--accent', '--swatch', '--cat', '--cat-own', '--fill'])

const source = new Map(SHEETS.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]))

/** Every `--name:` that appears as a declaration. Anchored to the start of a
    line because that is how this codebase writes them, one per line, and a
    looser pattern would also match the `--name` inside a var() call. */
function declaredIn(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/^[ \t]*(--[a-z0-9-]+)[ \t]*:/gm)].map((match) => match[1])
  )
}

/** Every `var(--name)` with NO fallback. One with a fallback is a
    deliberate "this may not exist" (`var(--flash-x, 50%)` in .storm-flash,
    which is set per strike and legitimately absent before the first one),
    so it is not a claim about the token vocabulary and is not checked. */
function requiredIn(css: string): { token: string; sheet: string }[] {
  return [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((match) => ({
    token: match[1],
    sheet: '',
  }))
}

// --- Rule one: no token is used without being defined somewhere ----------

const declared = new Set<string>()
for (const css of source.values()) for (const name of declaredIn(css)) declared.add(name)

const missing: string[] = []
for (const [path, css] of source) {
  for (const { token } of requiredIn(css)) {
    if (!declared.has(token) && !SET_IN_JS.has(token)) missing.push(`${path}: var(${token})`)
  }
}
assert.deepEqual(missing, [], `used but never declared:\n  ${missing.join('\n  ')}`)

// --- Rule two: app.css's bridge does not redefine a tokens.css name ------
//
// The bridge maps shadcn's vocabulary onto ours. Both files declare at
// :root and both are unlayered, so any name in both is a silent override of
// tokens.css by whichever import comes second, and app.css always does.
// There is no legitimate reason for the bridge to own a name tokens.css
// already owns: that is what `--color-x: var(--our-token)` is for.

const ours = declaredIn(source.get('src/tokens.css') as string)
const bridge = declaredIn(source.get('src/app.css') as string)
const clashes = [...bridge].filter((name) => ours.has(name)).sort()

assert.deepEqual(
  clashes,
  [],
  `app.css redefines tokens.css names (tokens.css loses, it is imported first):\n  ${clashes.join('\n  ')}`
)

// --- Rule three: the focus ring has a real colour ------------------------
//
// The consequence of rule two, stated directly, so this check still fails
// loudly if the two files are ever restructured in a way that gets past the
// name comparison above. --accent's declared fallback has to be a visible
// colour, not a wash: shell.css draws every :focus-visible outline in it.

const accent = /^\s*--accent:\s*var\((--[a-z0-9-]+)\)/m.exec(source.get('src/tokens.css') as string)
assert.ok(accent, 'tokens.css must declare --accent')
assert.equal(
  accent[1],
  '--rust',
  'tokens.css --accent is the default focus-ring colour and must stay an ink-strength accent'
)

// --- Rule four: the safe-area tokens are not inert ----------------------
//
// env(safe-area-inset-*) reads 0 on every browser until a page asks to
// paint under the unsafe edges, so --safe-t/r/b/l are only real if the
// viewport meta says viewport-fit=cover. That is one word in a file nobody
// opens, holding up every fixed panel's offset in two stylesheets. Both
// pages that carry the app's chrome are checked; index.html and app.html
// inject head.html at build (vite.config.ts), so head.html is the one that
// counts for them.

for (const page of ['head.html', 'styleguide.html']) {
  const html = readFileSync(join(ROOT, page), 'utf8')
  const meta = /<meta[^>]+name="viewport"[^>]*>/.exec(html)
  assert.ok(meta, `${page} must carry a viewport meta`)
  assert.match(
    meta[0],
    /viewport-fit=cover/,
    `${page}'s viewport meta must set viewport-fit=cover, or every --safe-* token is 0`
  )
}

// --- Rule five: the insets go through the aliases -----------------------
//
// A stylesheet writing env(safe-area-inset-*) directly is a rule that
// bypasses tokens.css, which is the same drift the token bridge exists to
// stop, and in this case it also loses the 0px fallback the aliases carry
// for browsers that do not know env() at all.

const raw = [...source]
  .filter(([path]) => path !== 'src/tokens.css')
  .filter(([, css]) => css.includes('env(safe-area'))
  .map(([path]) => path)

assert.deepEqual(
  raw,
  [],
  'env(safe-area-inset-*) written directly, use var(--safe-t/r/b/l): ' + raw.join(', ')
)

console.log('tokens: ok')
