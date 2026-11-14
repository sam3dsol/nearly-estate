import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pOf } from '../desk.mjs'

test('an agent answers true or false with a confidence; the probability follows the answer, so a sure "false" is a low p', () => {
  assert.equal(pOf({ true: false, confidence: 0.95 }), 0.050000000000000044 < 0.06 ? pOf({ true: false, confidence: 0.95 }) : NaN)
  assert.ok(Math.abs(pOf({ true: false, confidence: 0.95 }) - 0.05) < 1e-9)
  assert.equal(pOf({ true: true, confidence: 0.97 }), 0.97)
  assert.ok(Number.isNaN(pOf({ true: true, confidence: 0.3 })), 'a confidence under 0.5 is not an answer')
  assert.equal(pOf({ p: 0.2 }), 0.2, 'an older reply with only p still counts')
  assert.ok(Number.isNaN(pOf({ note: 'no numbers' })))
})

// the answer is about the claim as written, and a view whose own note says the opposite trades nothing
import { mixed, ANSWER } from '../desk.mjs'
const NFT = 'An NFT restricts the sharing and copying of the digital file it references'
test('the answer field is claim_as_written_is_true; a stored reply with "true" still reads', () => {
  assert.ok(ANSWER.includes('"claim_as_written_is_true": true or false') && !ANSWER.includes('{"true"'))
  assert.equal(pOf({ claim_as_written_is_true: true, confidence: 0.97 }), 0.97)
  assert.ok(Math.abs(pOf({ claim_as_written_is_true: false, confidence: 0.9 }) - 0.1) < 1e-9)
  assert.equal(pOf({ claim_as_written_is_true: false, true: true, confidence: 0.8 }).toFixed(2), '0.20', 'the new field wins')
})
test('market 231: "true" with a note that says the source denies the claim is mixed; "false" with that note is not', () => {
  const note = 'Encyclopedia explicitly states an NFT does not restrict the sharing or copying of the file it points to.'
  assert.equal(mixed(NFT, { claim_as_written_is_true: true, confidence: 0.97, note }), true)
  assert.equal(mixed(NFT, { true: true, confidence: 0.97, note }), true, 'the stored reply of 231 itself')
  assert.equal(mixed(NFT, { claim_as_written_is_true: false, confidence: 0.97, note }), false)
})
test('a negatively worded claim: a note that repeats its negation agrees with "true" and contradicts "false"', () => {
  const claim = 'An NFT does not restrict the sharing of the file it references', note = 'The encyclopedia says an NFT doesn’t restrict sharing of the file.'
  assert.equal(mixed(claim, { claim_as_written_is_true: true, confidence: 0.9, note }), false)
  assert.equal(mixed(claim, { claim_as_written_is_true: false, confidence: 0.9, note }), true)
})
test('a note that calls the claim false or true decides; a negated verdict flips; plain agreement is never mixed', () => {
  assert.equal(mixed('Paris is the capital of France', { claim_as_written_is_true: true, confidence: 0.9, note: 'The claim is false: the article names Lyon.' }), true)
  assert.equal(mixed('Paris is the capital of France', { claim_as_written_is_true: false, confidence: 0.9, note: 'The article confirms Paris as the capital.' }), true)
  assert.equal(mixed('Paris is the capital of France', { claim_as_written_is_true: false, confidence: 0.7, note: 'No source confirms it for the period asked.' }), false)
  assert.equal(mixed('Paris is the capital of France', { claim_as_written_is_true: true, confidence: 0.9, note: 'Nothing in the article contradicts it; Paris is the capital.' }), false)
  assert.equal(mixed('Paris is the capital of France', { claim_as_written_is_true: true, confidence: 0.95, note: 'The article states Paris is the capital and largest city of France.' }), false)
  assert.equal(mixed('The Great Wall is visible from the Moon', { claim_as_written_is_true: false, confidence: 0.95, note: 'A popular myth; astronauts report it cannot be seen with the naked eye.' }), false)
  assert.equal(mixed(NFT, { note: 'no answer' }), false, 'no answer, nothing to compare')
})
