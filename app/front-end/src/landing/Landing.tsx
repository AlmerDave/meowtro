import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { FeatureCollection, Polygon } from 'geojson'
import { MapCanvas } from '@/map/MapCanvas'
import { listCats, type Cat } from '@/data/catsRepo'
import type { Sighting } from '@/data/sightings'
import { photoAt } from '@/data/cats.seed'
import { greetingName, signInWithGoogle, subscribeAuth, type User } from '@/data/auth'
import { Reel } from './Reel'

/* The front door.

   `/` itself: this page is index.html and the app is app.html. It was the
   other way round for a day, which made the landing reachable only by
   typing /landing.html while its own Explore button pointed at the app:
   a front door behind the house. See the note in vite.config.ts.

   A separate Vite entry, not a route. App.tsx's "no router, one page, one
   piece of navigable state" decision is untouched by this: these are two
   pages that link to each other, which is what an anchor is for.

   The ground is the real map, not a picture of one. That costs the pmtiles
   read on first paint, and it is the right trade for this project: the
   landing IS the product, and a still image of it would be the one part of
   the page that could quietly stop matching what the app looks like. */

/* The landing map is the basemap and nothing else.

   <Territories> and <CatMarkers> both render from what they are handed, so
   handing them nothing is the whole switch: no flag on MapCanvas, no branch
   inside either component. Three overlapping territory washes plus three
   pins plus the street labels was more than the hero could carry, and the
   cats are on this page already, in the guide panel, at a size you can
   actually see them. The map's job here is to be the city. */
const NO_TERRITORIES: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] }
const NO_CATS: Cat[] = []
const NO_SIGHTINGS: Sighting[] = []

/* The centre of the seeded territory data, stated to two minutes. Not read
   from the geojson at runtime: it is a caption about where BGC is, and
   recomputing a constant on every visitor's machine to print the same two
   numbers would be work pretending to be rigour. */
const COORDS = '14°33′N 121°03′E'

/* Where Explore goes. A constant because two places need it, the anchor
   href and the JS navigation, and those two must not drift apart. */
const APP = '/app.html'

/* Matches the container query in landing.css. Duplicated here because the
   button genuinely moves in the DOM rather than being restyled: on a narrow
   screen it belongs under the wordmark where the thumb is, not welded into
   a corner. One button either way, so focus order and listeners stay put. */
const NARROW = '(max-width: 620px)'

/* How many roster chips the card shows, with a count standing in for the
   rest. Not a scroll and not a wrap: at twelve cats the row is about 490px
   of overlapping circles inside a 400px card, and both of the obvious fixes
   turn a glance into an interaction. The row is a taste of the survey, not
   an index of it, and the index is one button away.

   Five is what fits at the narrow layout's 52px chip without crowding the
   name and description beside it. The rotation still runs through all
   twelve, so a chip outside the first five still gets its turn in the copy
   below; it simply has no circle of its own to sit under. */
const CHIPS = 5

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)

  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const onChange = () => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return narrow
}

export default function Landing() {
  /* Loaded for the roster in the guide panel, not for the map. */
  const [cats, setCats] = useState<Cat[]>([])
  const [active, setActive] = useState(0)
  const [held, setHeld] = useState(false)
  const [leaving, setLeaving] = useState(false)
  /* Sign-in failure, said out loud. signInWithPopup rejects for four
     ordinary reasons (the popup was closed, the browser blocked it, a
     double-click raced a second one, the network dropped) and this button
     used to handle none of them: the press threw an unhandled rejection
     into the console and the page simply did nothing, which on the one
     control that gets anybody into the app is the worst place to be
     silent. Short and non-technical rather than the Firebase error code,
     same as every other error string in this app: "auth/popup-blocked"
     tells a visitor nothing they can act on. */
  const [signInError, setSignInError] = useState<string | null>(null)
  /* Returning-visitor state for the signin slot below: a persisted Google
     session means the button has nothing left to do (popups aren't free)
     except say who's signed in and offer the same way into the app. */
  const [user, setUser] = useState<User | null>(null)
  useEffect(() => subscribeAuth(setUser), [])
  const narrow = useNarrow()

  /* The reveal. landing.css styles every top-level surface as hidden under
     `.landing:not(.is-ready)`; this is what removes that. A single
     requestAnimationFrame rather than setting it synchronously — the same
     one-frame idiom ui/Rail.tsx uses for its own boot stagger — so the
     browser paints the hidden state at least once before the class flips
     and the transition has something to animate from. State, not a ref
     like Rail's: Rail hands a boolean to Motion as a prop, nothing here
     reads JS at all, so the only way to move a CSS transition is an actual
     class change on the DOM. */
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  /* Back from the app. `leaving` is React state and the curtain it raises
     is opaque --paper over the whole page, so a bfcache restore (which
     brings the DOM and this component's state back exactly as they were)
     put the visitor on a blank rectangle with no way out. pageshow with
     `persisted` is the only signal that this happened; a plain unmount
     effect never runs, because the page was never unmounted. */
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  useEffect(() => {
    let live = true
    listCats().then((loaded) => {
      if (live) setCats(loaded)
    })
    return () => {
      live = false
    }
  }, [])

  /* The roster advances on its own until somebody points at it, then it is
     theirs. Same contract as the reel: ambient until engaged. */
  useEffect(() => {
    if (held || cats.length === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setActive((i) => (i + 1) % cats.length), 4200)
    return () => window.clearInterval(id)
  }, [held, cats.length])

  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  /* Explore is a transition, not a link. The HUD clears, the camera pushes
     in, and only then does the app load — so the last thing on screen here
     is the same city the app opens on, rather than a white flash between
     two pages. The href stays real underneath for middle-click, ctrl-click
     and anyone who never gets the JS. */
  function explore(event: MouseEvent<HTMLAnchorElement>) {
    /* altKey included: on every desktop browser alt-click means "download
       this link", which is a request to NOT navigate. Taking it over would
       run the curtain and then navigate anyway. */
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return
    event.preventDefault()
    if (leaving) return
    setLeaving(true)
    const wait = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900
    timer.current = window.setTimeout(() => {
      window.location.href = APP
    }, wait)
  }

  const cat = cats[active]

  const cta = (
    <a className="landing-cta" href={APP} onClick={explore}>
      Explore the map
      <span className="landing-cta-arrow" aria-hidden="true">
        <ArrowRight size={18} />
      </span>
    </a>
  )

  return (
    <div className={`landing${ready ? ' is-ready' : ''}${leaving ? ' is-leaving' : ''}`}>
      <MapCanvas
        chrome={false}
        interactive={false}
        cats={NO_CATS}
        territories={NO_TERRITORIES}
        sightings={NO_SIGHTINGS}
        uid={null}
        selectedId={null}
        onSelect={() => {}}
        hoveredId={null}
        onHover={() => {}}
        onRecorded={() => {}}
        onOpenRecord={() => {}}
        report={null}
      >
        <Reel />
      </MapCanvas>

      {/* Top and bottom only. The middle of the frame is where the city is,
          and the wordmark has to stay legible against it without the whole
          map being greyed out to make that easy. */}
      <div className="landing-scrim" aria-hidden="true" />

      <header className="landing-nav">
        <a className="landing-brand" href="/">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4" opacity="0.3" />
            <circle cx="12" cy="12" r="5.6" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          </svg>
          MEOWTRO
        </a>

        {/* There was a nav here: Cats / Territories / Field notes, three
            links pointing at the same one place, inside a <nav> labelled
            "Sections" over a page that has no sections to jump to. It read
            as a site map for a site that is one door and one map.

            Removed rather than aimed somewhere. The page is deliberately a
            mystery box: the whole design intent is that you click Explore
            to find out, and three shortcuts past the front door work
            against exactly that. Brand on the left, the sign-in seam on the
            right, one Explore. If this ever needs links again they should
            be real destinations, not three names for the same href. */}

        {/* The seam. It was a span reading "Soon" for exactly as long as
            there was nothing behind it, then a link out to ?role=admin's
            stand-in gate for phase 8. Phase 9: a real Google popup, so the
            element itself changes from an anchor to a button, there is no
            href for this to navigate through any more, sign-in is
            something that happens on this page before the navigation does.

            Explore's own curtain timing (see `explore` above) is not
            reused here: signing in is not a page transition, there is
            nothing to reveal underneath it, so this navigates directly
            once the popup resolves. */}
        <div className="landing-signin-slot">
          {user ? (
            /* Already signed in (a persisted session, not a fresh popup):
               the button's job shrinks to "take me in", so it navigates
               straight there instead of round-tripping through Google
               again. Same pill, same arrow, so this reads as the one
               control settling into its other state rather than a second
               control appearing. */
            <a className="landing-signin" href={APP} onClick={explore}>
              <span className="landing-signin-name">Hi, {greetingName(user)}</span>
              <span className="landing-signin-arrow" aria-hidden="true">
                <ArrowUpRight size={14} />
              </span>
            </a>
          ) : (
            <button
              type="button"
              className="landing-signin"
              onClick={async () => {
                setSignInError(null)
                try {
                  await signInWithGoogle()
                } catch {
                  setSignInError('Could not sign in. Try again.')
                  return
                }
                window.location.href = APP
              }}
            >
              Sign in
              <span className="landing-signin-arrow" aria-hidden="true">
                <ArrowUpRight size={14} />
              </span>
            </button>
          )}
          {signInError && (
            <p className="landing-signin-error" role="alert">
              {signInError}
            </p>
          )}
        </div>
      </header>

      <div className="landing-hero">
        <p className="landing-wordmark">MEOWTRO</p>
        {narrow && <div className="landing-hero-cta">{cta}</div>}
      </div>

      <section className="landing-guide" aria-label="About this survey">
        <p className="landing-eyebrow">
          <b>Field guide</b>
          <span aria-hidden="true">/</span>
          {COORDS}
          <span aria-hidden="true">/</span>
          Taguig
        </p>

        <h1 className="landing-lede">
          A field guide to the community cats of Bonifacio Global City.
        </h1>

        <p className="landing-note">
          Each cat is mapped by the territory it roams, never by a pin. Cats do not sit still.
        </p>

        <div className="landing-rule" />

        <div className="landing-roster">
          <div className="landing-chips">
            {cats.slice(0, CHIPS).map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`landing-chip${i === active ? ' on' : ''}`}
                style={{ '--cat-own': `var(${c.colour})` } as CSSProperties}
                aria-label={`${c.name}, ${c.description}`}
                aria-current={i === active}
                onMouseEnter={() => {
                  setHeld(true)
                  setActive(i)
                }}
                onFocus={() => {
                  setHeld(true)
                  setActive(i)
                }}
                onClick={() => {
                  setHeld(true)
                  setActive(i)
                }}
                onMouseLeave={() => setHeld(false)}
                onBlur={() => setHeld(false)}
              >
                {c.photo ? (
                  /* 640x480 was being downloaded to paint a 52px circle.
                     photoAt knows the seeded URL shape and rewrites it;
                     104 is the rendered size at 2x, which is what a retina
                     phone wants and is still a twelfth of the pixels. */
                  <img src={photoAt(c.photo, 104)} alt="" width={52} height={52} />
                ) : null}
              </button>
            ))}

            {/* Not a button. Pressing it would have to do something, and
                the something is Explore, which is already the largest
                thing on the page. It is a count, and it reads as one. */}
            {cats.length > CHIPS && (
              <span className="landing-chip-more">+{cats.length - CHIPS}</span>
            )}
          </div>

          {cat && (
            <div
              /* Keyed on the cat so the swap animation restarts per change
                 instead of needing a class toggled off and back on. */
              key={cat.id}
              className="landing-roster-copy"
              style={{ '--cat': `var(${cat.colour})` } as CSSProperties}
            >
              <p className="landing-roster-name">{cat.name}</p>
              <p className="landing-roster-desc">{cat.description}</p>
            </div>
          )}
        </div>
      </section>

      {!narrow && cta}

      <div className="landing-curtain" aria-hidden="true" />
    </div>
  )
}
