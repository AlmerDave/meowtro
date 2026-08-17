import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import './shell.css'
import './styleguide.css'
import Styleguide from './Styleguide'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Styleguide />
  </StrictMode>
)
