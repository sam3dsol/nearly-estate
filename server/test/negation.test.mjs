import { test } from 'node:test'
import assert from 'node:assert/strict'
import { same, candidates, findSame, negated, bare, overlap } from '../facts.mjs'

const ALL = [
  { id: 333, subject: 'napoleon.topic', status: 'Open', question: 'Napoleon died of arsenic poisoning.' },
  { id: 41, subject: 'great-wall-of-china.topic', status: 'Open', question: 'The Great Wall of China is visible from the Moon with the naked eye.' },
]
test('a negated claim never lands on the affirmative market, on the same page or across pages', async () => {
  assert.ok(negated("Napoleon didn't die of arsenic poisoning") && negated('Napoleon did not die of arsenic poisoning') && !negated('Napoleon died of arsenic poisoning'))
  assert.equal(same(ALL.map((m) => ({ market: m.id, claim: m.question })), 'Napoleon did not die of arsenic poisoning.'), null)
  assert.deepEqual(candidates('The Great Wall is not visible from the Moon with the naked eye.', ALL, 'space.topic'), [])
  assert.equal(await findSame('The Great Wall of China is not visible from the Moon with the naked eye', { exclude: 'space.topic', all: ALL, confirm: async () => true }), null)
  assert.equal((await findSame('The Great Wall of China is visible from the Moon with the naked eye', { exclude: 'space.topic', all: ALL, confirm: async () => false }))?.id, 41)
})

test('a negated question, stripped of its negation, overlaps the affirmative market it is the NO side of', () => {
  assert.equal(bare('Napoleon did not die of arsenic poisoning.'), 'Napoleon did die of arsenic poisoning.')
  assert.ok(overlap(bare('Napoleon did not die of arsenic poisoning.'), 'Napoleon died of arsenic poisoning.') >= 0.6)
  assert.equal(bare("Bitcoin isn't legal tender in El Salvador"), 'Bitcoin is legal tender in El Salvador')
})
