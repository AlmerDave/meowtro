/* PARKED, 2026-08-23. Nothing imports this file. It catches CatFigure
   failing to load, and CatFigure is parked too; see the note there. */

import { Component, type ReactNode } from 'react'

/* An error boundary around the lazily-loaded 3D figure, and the only class
   component in the app, React still has no hook that catches a render
   error, so this is the language's shape, not a style choice.

   It exists for one failure that is entirely plausible here: CatFigure is a
   ~1 MB chunk fetched on demand, and this app's whole offline story is that
   it degrades to a working page instead of a damaged one. Without a
   boundary, a failed chunk leaves Suspense waiting forever, so a dropped
   connection reads as "Rendering specimen" spinning indefinitely, the app
   lying about being busy rather than admitting it is stuck.

   React.lazy caches a rejected import, so there is deliberately no retry
   button: pressing it would fail instantly every time. The fallback offers
   the thing that does work instead, which is the photo. */

type Props = { children: ReactNode; fallback: ReactNode }
type State = { failed: boolean }

export class FigureBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
