import { useState } from 'react'
import { Button } from '@/components/ui/button'
import FadeContent from '@/components/FadeContent'
import { Grain } from '@/Grain'
import { Plate } from '@/plate/Plate'
import { CatRow } from '@/ui/CatRow'
import { CATS, CAT_COLOURS } from '@/data/cats.seed'
import { THEMES, DEFAULT_THEME, TOGGLE_THEMES, type Theme } from '@/map/style'

const PALETTE = [
  { key: '--paper', role: 'Ground / panel surface base.' },
  { key: '--ink', role: 'Type and linework.' },
  { key: '--ink-soft', role: 'Secondary type, rules.' },
  { key: '--rust', role: 'The one accent — selection, glow, active state.' },
  { key: '--sage', role: 'Parks only.' },
]

const THEME_LABEL: Record<Theme, string> = {
  paper: 'paper',
  light: 'light glass',
  dark: 'dark glass',
}

// All three themes are real palettes selected by a data-theme attribute on
// :root (tokens.css), not guessed duplicates. Flip the attribute, sample
// with getComputedStyle (same technique as map/style.ts and
// map/Territories.tsx), then restore it — so this table can never drift
// from the tokens the app actually renders with.
function readPalette(theme: Theme): Record<string, string> {
  const root = document.documentElement
  const prevAttr = root.getAttribute('data-theme')
  root.setAttribute('data-theme', theme)
  const cs = getComputedStyle(root)
  const values: Record<string, string> = {}
  for (const c of PALETTE) values[c.key] = cs.getPropertyValue(c.key).trim()
  if (prevAttr === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', prevAttr)
  return values
}

/* opsz/WONK are Fraunces axes and only do anything on the paper theme; the
   glass themes' native stack ignores them silently. Listed anyway, since
   this page is where the paper theme's type is meant to be provable. */
const SCALE = [
  { label: '--t-4xl · opsz 144', size: 'var(--t-4xl)', opsz: 144, wonk: 1, text: 'Meowtro' },
  { label: '--t-3xl · opsz 96', size: 'var(--t-3xl)', opsz: 96, wonk: 1, text: 'Twelve residents' },
  { label: '--t-2xl · opsz 72', size: 'var(--t-2xl)', opsz: 72, wonk: 1, text: 'Milo' },
  { label: '--t-xl · opsz 36', size: 'var(--t-xl)', opsz: 36, wonk: 0, text: 'Track 30th' },
  { label: '--t-lg · opsz 24', size: 'var(--t-lg)', opsz: 24, wonk: 0, text: 'Section heading' },
  {
    label: '--t-base · opsz 14',
    size: 'var(--t-base)',
    opsz: 14,
    wonk: 0,
    text: 'A pin says the cat is here, which is false about every cat that has ever lived. A soft hatched polygon says this is her patch.',
  },
]

/* Three, still, because three is what shows overlap reading correctly and
   twelve overlapping washes shows nothing at all. The full palette is the
   strip below this demo.

   Tokens rather than the hexes that used to be typed here: this page exists
   to prove the design system, so a swatch that cannot follow a theme is the
   one thing on it that must not be hand-coloured. */
const TERRITORIES = [
  { id: 'milo', label: 'MILO', colour: 'var(--cat-rust)' },
  { id: 'biscuit', label: 'BISCUIT', colour: 'var(--cat-sage)' },
  { id: 'tala', label: 'TALA', colour: 'var(--cat-grey)' },
]

const ANTI_SLOP = [
  'No Inter, Roboto, Space Grotesk, or Geist.',
  'No default indigo-to-purple gradient.',
  'No flat semi-opaque rectangle standing in for glass.',
  'No copy-pasted radius/blur/shadow values per component — one recipe, in tokens.css.',
  'No gradient on the paper theme except the grain.',
  'No emoji, anywhere.',
  'No centered hero with a headline and two buttons.',
  'Every animation nameable and attributable to exactly one library (§8).',
]

// Sets the same data-theme attribute MapControls sets (map/MapControls.tsx),
// so this page proves every material without opening the app.
//
// All of THEMES, not just TOGGLE_THEMES: the app's button ships day/night
// only, but paper is still fully built and this is the page whose job is to
// prove that it still renders. If paper ever breaks, it breaks here first.
function ThemeCycleDemo({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div className="theme-cycle">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          className="theme-toggle"
          data-active={String(t === theme)}
          onClick={() => {
            document.documentElement.dataset.theme = t
            onChange(t)
          }}
        >
          {THEME_LABEL[t]}
          {!TOGGLE_THEMES.includes(t) && <span className="off-toggle"> · off toggle</span>}
        </button>
      ))}
    </div>
  )
}

export default function Styleguide() {
  const [grain, setGrain] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>('milo')
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)
  const [palettes] = useState(() =>
    Object.fromEntries(THEMES.map((t) => [t, readPalette(t)])) as Record<
      Theme,
      Record<string, string>
    >
  )

  function copy(hex: string) {
    navigator.clipboard?.writeText(hex)
    setCopied(hex)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <>
      {/* Only paints on the paper theme — tokens.css hides .grain under the
          two glass themes, so this toggle is a paper-theme control that
          simply has nothing to show on the other two. */}
      <Grain on={grain} />

      <main className="page">
        <header className="masthead">
          <h1>Meowtro</h1>
          <p>
            Design system, spec §4. Three themes off one token file. The app ships the light and
            dark glass HUD — translucent panels, real blur and shadow; paper, the 1950s naturalist
            field survey in cream and ink, is built and kept but off the app's toggle. One warm
            accent throughout, specimen plates for cats instead of pins.
          </p>
        </header>

        <ThemeCycleDemo theme={theme} onChange={setTheme} />

        <section>
          <div className="sec-head">
            <span className="num">01</span>
            <h2>Palette</h2>
            <span className="note">
              {copied ? (
                <span className="copied">copied {copied}</span>
              ) : (
                'click a chip to copy · read live, all three themes'
              )}
            </span>
          </div>
          <div className="palette-compare">
            <div className="palette-head">
              <span>token</span>
              {THEMES.map((t) => (
                <span key={t}>{THEME_LABEL[t]}</span>
              ))}
              <span>role</span>
            </div>
            {PALETTE.map((c) => (
              <div className="palette-row" key={c.key}>
                <span className="palette-name">{c.key}</span>
                {THEMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="palette-chip"
                    onClick={() => copy(palettes[t][c.key])}
                  >
                    <span className="swatch-fill" style={{ background: palettes[t][c.key] }} />
                    <span className="hex">{palettes[t][c.key]}</span>
                  </button>
                ))}
                <span className="palette-role">{c.role}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="num">02</span>
            <h2>Type</h2>
            <span className="note">
              --font-display + JetBrains Mono. Two families, no more — display is Fraunces on
              paper, the native stack on glass.
            </span>
          </div>
          {SCALE.map((s) => (
            <div className="specimen" key={s.label}>
              <span className="label">{s.label}</span>
              <div
                className="sample"
                style={{
                  fontSize: s.size,
                  fontVariationSettings: `'opsz' ${s.opsz}, 'SOFT' 0, 'WONK' ${s.wonk}`,
                  lineHeight: s.opsz > 40 ? 1.05 : 1.5,
                  fontWeight: s.opsz > 20 ? 600 : 400,
                }}
              >
                {s.text}
              </div>
            </div>
          ))}
          <div className="specimen">
            <span className="label">--font-mono</span>
            <div className="sample" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
              14.5512° N, 121.0500° E · LINE 03 · TRACK 30TH · Mar 2024
            </div>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="num">03</span>
            <h2>Territory</h2>
            <span className="note">click one — selection uses feature-state, not rebuilds</span>
          </div>

          {/* The whole palette a cat can be. Eight, every one a mix of the
              five base colours, all clearing AA as text on --paper in all
              three themes (npm run check:palette does that arithmetic).
              Rendered from CAT_COLOURS itself, so a colour added to the
              picker appears here without anyone remembering to add it. */}
          <div className="cat-palette">
            {CAT_COLOURS.map((c) => (
              <div key={c.token} className="cat-swatch">
                <span className="chip" style={{ background: `var(${c.token})` }} />
                <span className="label">{c.label}</span>
                <span className="token">{c.token}</span>
              </div>
            ))}
          </div>
          <div className="territories">
            {TERRITORIES.map((t) => {
              const isSel = selected === t.id
              return (
                <button
                  key={t.id}
                  className="territory"
                  data-selected={String(isSel)}
                  onClick={() => setSelected(isSel ? null : t.id)}
                  style={{
                    background: t.colour,
                    // spec §6: selected 0.32, others 0.05, resting 0.14
                    opacity: selected === null ? 0.14 : isSel ? 0.32 : 0.05,
                    transition: 'opacity var(--dur-plate) var(--ease)',
                  }}
                >
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="num">04</span>
            <h2>Plate</h2>
            <span className="note">spec §7 · ~420px</span>
          </div>
          <div className="plate-specimen">
            <Plate cat={CATS[0]} onClose={() => undefined} />
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="num">05</span>
            <h2>Anti-slop checklist</h2>
            <span className="note">applied at every review</span>
          </div>
          <ul className="checklist">
            {ANTI_SLOP.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        {/* Gate 2. Neither of these was written here: shadcn's button and React
            Bits' fade came out of registries and wear our palette because of
            the bridge in app.css. If they ever look generic, the bridge broke. */}
        <section>
          <div className="sec-head">
            <span className="num">06</span>
            <h2>Bridge</h2>
            <span className="note">installed, not authored</span>
          </div>
          <FadeContent duration={700} className="bridge">
            <Button>Open plate</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </FadeContent>
          <p className="bridge-note">
            shadcn/ui button (radix) inside React Bits FadeContent. Rust primary, no grey, no red,
            and the corner/shadow follow the active theme — square and flat on paper, rounded with
            a real shadow on glass.
          </p>
        </section>

        <section>
          <div className="sec-head">
            <span className="num">07</span>
            <h2>Material</h2>
            <span className="note">.rail itself, borrowed from shell.css — cycle theme above</span>
          </div>
          <div className="glass-demo">
            {/* The real structure, not a lookalike: the rail's children
                moved onto their own classes, and a swatch built from bare
                <h1>/<button> would show the material correctly while showing
                the contents wrong. */}
            <div className="rail">
              <div className="rail-head">
                <div className="rail-title">
                  <h1>
                    Meowtro
                    <span className="rail-live" aria-hidden />
                  </h1>
                  <p>Bonifacio Global City</p>
                </div>
              </div>
              <div className="rail-list">
                {CATS.slice(0, 2).map((cat, i) => (
                  <CatRow
                    key={cat.id}
                    cat={cat}
                    selected={i === 0}
                    onSelect={() => undefined}
                    onHover={() => undefined}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <div className="toolbar">
        <span>grain</span>
        <button aria-pressed={grain} onClick={() => setGrain(!grain)}>
          {grain ? 'on' : 'off'}
        </button>
        <span style={{ color: 'var(--ink-soft)' }}>
          paper theme only — toggle to see what the texture is doing
        </span>
      </div>
    </>
  )
}
