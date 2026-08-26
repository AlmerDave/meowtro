import assert from 'node:assert/strict'
import { composeDescription, EMPTY_ANSWERS, UNKNOWN, type CoatAnswers } from './describeCat'

/* Run: npm run check:describecat */

const full: CoatAnswers = {
  furColour: 'Grey',
  pattern: 'Tabby',
  marks: ['White socks'],
  sex: 'Male',
  age: 'Young adult',
}
assert.equal(
  composeDescription(full),
  'Grey tabby · white socks · male, est. young adult',
  'a fully-answered set did not compose to the expected seed-style sentence'
)

const noMarks: CoatAnswers = { ...full, marks: [] }
assert.equal(
  composeDescription(noMarks),
  'Grey tabby · male, est. young adult',
  'an empty marks list should drop that clause entirely, not print an empty one'
)

const noneMark: CoatAnswers = { ...full, marks: ['None'] }
assert.equal(
  composeDescription(noneMark),
  'Grey tabby · male, est. young adult',
  '"None" is a real answer to the marks question but must not appear as text'
)

const multiMarks: CoatAnswers = { ...full, marks: ['White socks', 'Bobtail'] }
assert.equal(
  composeDescription(multiMarks),
  'Grey tabby · white socks, bobtail · male, est. young adult',
  'multiple marks did not join with a comma'
)

const sexUnknown: CoatAnswers = { ...full, sex: UNKNOWN }
assert.equal(
  composeDescription(sexUnknown),
  'Grey tabby · white socks, est. young adult',
  'an unknown sex should drop out of the tail clause, not print "Don\'t know"'
)

const colourUnknown: CoatAnswers = { ...full, furColour: UNKNOWN }
assert.equal(
  composeDescription(colourUnknown),
  'Tabby · white socks · male, est. young adult',
  'an unknown fur colour should leave just the pattern, capitalised as the sentence start'
)

assert.equal(
  composeDescription(EMPTY_ANSWERS),
  '',
  'no answers at all must compose to an empty string, not "· ·" or similar'
)

const allUnknown: CoatAnswers = { furColour: UNKNOWN, pattern: UNKNOWN, marks: [UNKNOWN], sex: UNKNOWN, age: UNKNOWN }
assert.equal(composeDescription(allUnknown), '', 'every answer being "Don\'t know" must compose to nothing')

console.log('describeCat: ok')
