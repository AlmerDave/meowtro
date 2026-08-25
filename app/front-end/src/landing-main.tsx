import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import './shell.css'
import './landing/landing.css'
import Landing from './landing/Landing'

/* shell.css is imported even though the landing mounts no rail, plate or
   sheet. It was left out at first as a page-weight saving, and that was
   wrong: the map's own furniture is styled there, so the canvas lost its
   fixed positioning and the markers rendered unstyled, every cat photo
   painting at its natural 640x480 across the middle of the hero. The
   markers are gone now (the landing hands MapCanvas no cats), but .map,
   the storm veil and the rain layer are all still on this page and all
   still live in that file. A component's styles have to travel with the
   component. The unused rules gzip to a few kB and share a chunk with the
   app, so a visitor who goes on to click Explore pays nothing twice. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>
)
