# Meowtro

A hand-inked field guide to the community cats of Bonifacio Global City.

Twelve named residents, each mapped by the **territory they roam** rather than a
single pin — because cats don't sit still. Click one and the map eases over, a
specimen plate opens, and the cat renders as a slowly-turning 3D figure in a
pencil-and-ink shader.

Cream paper. Ink linework. Pencil hatching for turf. No glass cards, no neon,
no purple gradient.

## Status

Design phase. Nothing built yet.

- **Full spec:** [`docs/superpowers/specs/2026-08-16-meowtro-design.md`](docs/superpowers/specs/2026-08-16-meowtro-design.md)

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
