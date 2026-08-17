# Meowtro

A hand-inked field guide to the community cats of Bonifacio Global City.

Twelve named residents, each mapped by the **territory they roam** rather than a
single pin — because cats don't sit still. Click one and the map eases over, a
specimen plate opens, and the cat renders as a slowly-turning 3D figure in a
pencil-and-ink shader.

A **light / dark glass HUD** — translucent blurred panels, real shadow, one
warm accent — switched day-to-night from a button on the map. A third theme,
**paper** (cream stock, ink linework, pencil hatching for turf, the original
field-guide identity), is fully built and one attribute away, just not on the
toggle. No neon, no purple gradient, in any of them.

## Status

**Phase 5 of 6 built.** Design system, registry bridge, the BGC map with
territory polygons, and the specimen plate with its 3D cat. Phase 4's
scroll-driven camera was built and then reverted — the map's drag and zoom
are plain MapLibre now. Remaining: phase 6, polish and proof.

- **Build plan — start here:** [`docs/superpowers/plans/2026-08-16-meowtro-build-plan.md`](docs/superpowers/plans/2026-08-16-meowtro-build-plan.md)
  The checkpoint file. Records what is done, what is next, and the exact next command.
- **Design spec:** [`docs/superpowers/specs/2026-08-16-meowtro-design.md`](docs/superpowers/specs/2026-08-16-meowtro-design.md)
- **Design system:** [`app/front-end/src/tokens.css`](app/front-end/src/tokens.css)
  All three themes live here. Every paper/glass difference is the same token
  name with a different value — nothing downstream branches on the theme.
- **Registry bridge:** [`app/front-end/src/app.css`](app/front-end/src/app.css)
  Written once. Every component installed after it inherits the palette.

```bash
cd app/front-end && npm install && npm run dev
#   /                  the app — map, territories, specimen plate
#   /styleguide.html   the design system, section 06 is the bridge
```

Rev 2 changed the motion goal: this is a vehicle for learning how to integrate
animation libraries and assemble from component registries. Six libraries, each
owning one named moment — see §8 of the spec. Only the map style, the territory
layers, the cat markers and the paper grain are hand-authored; everything else
installs.

## The short version

| | |
|---|---|
| **Place** | Bonifacio Global City, Taguig — small, walkable, gridded, and it has a real cat-feeder community. |
| **v1** | Map + cat profiles + territory zones. Seeded data, no backend. |
| **v2** | Sighting reports and community-submitted cats, once v1 earns it. |
| **Stack** | Vite · React · TypeScript · MapLibre GL · Protomaps · react-three-fiber |
| **Why it exists** | A deliberate front-end craft project: real 3D on the web, motion that means something, and a visual identity that could not have been generated from a template. |

## Inspiration

Venice's cats — not a website, but a culture. Marianna Zampieri's *Cats in
Venice* photo project and the Dingo Association (running the city's stray care
since 1965) both work the same way: individual cats, with names, who belong to
specific places. That's the spine Meowtro copies. The map is just the container.
