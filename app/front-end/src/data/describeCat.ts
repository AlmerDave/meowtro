/* The five tap-choice questions behind Step 2 of ui/RecordCat.tsx, and the
   pure function that turns an admin's answers into one `description`
   string — the same style the seeded cats already use ("Grey tabby ·
   white socks · male, est. 2 yrs"), without ever asking anyone to
   hand-compose a sentence.

   Kept in its own file, separate from ui/RecordCat.tsx, for the same
   reason data/localCats.ts's geometry is separate from the panel that
   calls it: this is checkable under node (describeCat.check.ts) and the
   component that renders it is not. */

export const UNKNOWN = "Don't know"

export const FUR_COLOURS = ['Black', 'Grey', 'Orange/Ginger', 'White', 'Brown', 'Calico/Mixed', UNKNOWN] as const
export const PATTERNS = ['Solid', 'Tabby', 'Tuxedo', 'Tricolor', 'Tortoiseshell', 'Colorpoint', UNKNOWN] as const
export const MARKS = [
  'White socks',
  'White chest',
  'Bobtail',
  'Notched ear',
  'Long-haired',
  'Short-haired',
  'None',
  UNKNOWN,
] as const
export const SEXES = ['Male', 'Female', UNKNOWN] as const

/** Age brackets. Short values are what gets stored and composed
    ("est. young adult"); `hint` is the year range shown under the button
    in the picker, never part of the composed sentence. */
export const AGES: { id: string; hint: string }[] = [
  { id: 'Kitten', hint: 'under 1 yr' },
  { id: 'Young adult', hint: '1-3 yrs' },
  { id: 'Adult', hint: '3-7 yrs' },
  { id: 'Senior', hint: '7+ yrs' },
  { id: UNKNOWN, hint: '' },
]

export type CoatAnswers = {
  furColour: string
  pattern: string
  /** Multi-select; may include a custom free-text entry typed through the
      "+ Custom" chip, which is why this is `string[]` rather than a union
      of MARKS. */
  marks: string[]
  sex: string
  age: string
}

export const EMPTY_ANSWERS: CoatAnswers = { furColour: '', pattern: '', marks: [], sex: '', age: '' }

const known = (value: string) => value !== '' && value !== UNKNOWN

/** Composes the five answers into one sentence, skipping any clause with
    nothing answerable in it — an admin who only knows the colour still
    gets a real (short) description rather than a required field with
    nothing to put in it. */
export function composeDescription(answers: CoatAnswers): string {
  const { furColour, pattern, marks, sex, age } = answers

  const furPart = known(furColour) ? furColour : ''
  const patternPart = known(pattern) ? pattern : ''

  // Build the head: if both colour and pattern, lowercase pattern; if only pattern, keep capitalized
  const head = (() => {
    if (furPart && patternPart) {
      return `${furPart} ${patternPart.toLowerCase()}`
    }
    if (furPart) {
      return furPart
    }
    return patternPart // Keep original case if it's the sentence start
  })()

  const marksClause = marks.filter((mark) => known(mark) && mark !== 'None').join(', ').toLowerCase()

  const sexPart = known(sex) ? sex.toLowerCase() : ''
  const agePart = known(age) ? `est. ${age.toLowerCase()}` : ''

  // Build the tail: sex and age
  const tail = [sexPart, agePart].filter(Boolean).join(', ')

  // If there's a tail with sex, join marks and tail with dot
  if (sexPart) {
    return [head, marksClause, tail].filter(Boolean).join(' · ')
  }

  // If there's no sex but there's age, join marks and age with comma
  if (agePart) {
    const marksAndAge = [marksClause, agePart].filter(Boolean).join(', ')
    return [head, marksAndAge].filter(Boolean).join(' · ')
  }

  // Otherwise just join everything with dots
  return [head, marksClause, tail].filter(Boolean).join(' · ')
}
