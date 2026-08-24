import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { useMap } from '@/map/MapCanvas'
import { countRecorded, listCats } from '@/data/catsRepo'
import { allSightings, readSightings } from '@/data/sightings'
import { useEscape } from '@/ui/escape'
import { springSoft } from '@/motion/springs'

/* About, and the credits.

   ## Why this is a readout and not a paragraph

   The obvious About page is prose: what the project is, who made it, a list
   of links. This one opens with numbers instead, because the numbers are
   the honest answer to the question somebody actually has when they press
   an info button on a map they have been clicking around: what am I
   looking at, and is any of it real?

   So it states the survey's own size, live, in the same mono-and-tracked
   voice the plate uses for a specimen's measurements. Two of those numbers
   are about the visitor's own contributions, which is the only part of this
   app that is genuinely theirs, and the one thing no static credits page
   could ever show them.

   ## Attribution is a licence condition here, not manners

   Three of the rows below are obligations. The cat model is CC-BY, and
   Open-Meteo's free tier is CC-BY 4.0; OpenStreetMap's data is ODbL. The
   map's own attribution control (map/style.ts) carries the short version
   because it is on screen whenever the map is, and this is the long one,
   with the things that are owed thanks rather than credit alongside them.

   Kept as data rather than markup so the two lists cannot drift: every row
   is one entry, and a row with a `licence` is one somebody is required to
   show. */

type Credit = {
  what: string
  who: string
  href: string
  /** Present when showing this is a condition of use, not a courtesy. */
  licence?: string
}

const CREDITS: Credit[] = [
  {
    what: 'Map data',
    who: 'OpenStreetMap contributors',
    href: 'https://www.openstreetmap.org/copyright',
    licence: 'ODbL',
  },
  {
    what: 'Basemap tiles',
    who: 'Protomaps',
    href: 'https://protomaps.com',
  },
  {
    what: 'Weather',
    who: 'Open-Meteo',
    href: 'https://open-meteo.com/',
    licence: 'CC-BY 4.0',
  },
  {
    what: 'Cat model',
    who: 'Poly by Google',
    href: 'https://poly.pizza/m/6dM1J6f6pm9',
    licence: 'CC-BY',
  },
  {
    what: 'Photographs',
    who: 'placecats',
    href: 'https://placecats.com',
  },
  {
    what: 'Card stack',
    who: 'Motion, via 21st.dev',
    href: 'https://21st.dev/@motiondotdev/components/motion-card-stack',
  },
]

/** What the survey knows right now. Read on open rather than subscribed:
    this panel is a snapshot somebody asked for, and a counter ticking under
    a paragraph they are reading would be motion with no message. */
type Survey = { cats: number; observations: number; yours: number }

type Props = { onClose: () => void }

export function About({ onClose }: Props) {
  const { weather, theme } = useMap()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEscape(true, onClose)

  useEffect(() => {
    let live = true
    listCats().then((cats) => {
      if (!live) return
      setSurvey({
        cats: cats.length,
        observations: allSightings().length,
        // The visitor's own additions, both kinds counted together: from
        // their side these are one thing, "what I put in", regardless of
        // which store it landed in.
        yours: countRecorded() + readSightings().length,
      })
    })
    return () => {
      live = false
    }
  }, [])

  /* Focus lands on the panel so the close button and the links are one Tab
     away, matching what the sighting panel does when a plate opens it. */
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      panelRef.current?.focus({ preventScroll: true })
    )
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <motion.section
      ref={panelRef}
      className="about"
      tabIndex={-1}
      aria-label="About this survey"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      transition={springSoft}
    >
      <div className="about-head">
        <p className="about-eyebrow">Field guide · BGC</p>
        <button type="button" className="about-close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="about-body" data-lenis-prevent>
        <h2>Meowtro</h2>
        <p className="about-lede">
          A hand-inked survey of the community cats of Bonifacio Global City. Each cat is mapped
          by the territory it roams rather than a single pin, because cats do not sit still.
        </p>

        {/* The readout. Three numbers, and the third is the only one that
            belongs to the person reading it. */}
        <dl className="about-stats" aria-busy={survey === null}>
          <div>
            <dt>Cats</dt>
            {/* An em dash while loading rather than 0: zero is a real
                answer that happens to be wrong, and it would flash on
                every open before the true count landed. */}
            <dd>{survey ? survey.cats : '—'}</dd>
          </div>
          <div>
            <dt>Observations</dt>
            <dd>{survey ? survey.observations : '—'}</dd>
          </div>
          <div>
            <dt>Yours</dt>
            <dd>{survey ? survey.yours : '—'}</dd>
          </div>
        </dl>

        <p className="about-readout">
          Sky <span>{weather}</span> · Theme <span>{theme}</span>
        </p>

        <h3>What is real</h3>
        <p>
          The map, the streets and the weather are. The cats are not: all three are invented, and
          their territories are drawn, not recorded. Anything you add stays in this browser and
          reaches no server.
        </p>
        <p className="about-rule">
          A real cat would be mapped the same way, and that is the point. A survey of live animals
          shows an area it roams, never an exact spot and never a feeding time, because a map that
          says precisely where an animal sleeps is a map for whoever means it harm.
        </p>

        <h3>Sources</h3>
        <ul className="about-credits">
          {CREDITS.map((credit) => (
            <li key={credit.what}>
              <span className="about-credit-what">{credit.what}</span>
              <a href={credit.href} target="_blank" rel="noreferrer noopener">
                {credit.who}
              </a>
              {/* Marked, so the rows that are legally required to be here
                  are visibly different from the ones that are thanks. */}
              {credit.licence && <span className="about-licence">{credit.licence}</span>}
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  )
}
