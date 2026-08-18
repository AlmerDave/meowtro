import type { Cat } from '@/data/catsRepo'

/* One row of the cat index, rev 6 §3. Shared by the desktop rail
   (App.tsx) and the mobile sheet (ui/CatSheet.tsx), so the two presentations
   can never drift apart.

   A real <button> rather than a styled div, for free keyboard focus and
   activation. */

type Props = {
  cat: Cat
  selected: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
}

export function CatRow({ cat, selected, onSelect, onHover }: Props) {
  return (
    <button
      type="button"
      className="cat-row"
      data-selected={String(selected)}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* alt is empty on purpose: the cat's name sits right beside it in
          text, so announcing the photo as well would only repeat it. This
          image is decoration.

          onError hides the element rather than leaving a broken-image glyph.
          That is the whole offline story for this feature: with no network
          the row degrades to the text layout it had before photos existed,
          rather than to a damaged one.

          width/height are set so the row does not reflow when the image
          resolves, or when it fails. */}
      <img
        className="cat-row-thumb"
        src={cat.photo}
        alt=""
        width={44}
        height={44}
        loading="lazy"
        decoding="async"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
      <span className="cat-row-text">
        <span className="cat-row-name">{cat.name}</span>
        <span className="cat-row-line">{cat.line.split(' · ')[0]}</span>
      </span>
    </button>
  )
}
