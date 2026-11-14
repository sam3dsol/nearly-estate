import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isQuestion, overlap, same } from '../ask.mjs'

test('a question is told from a topic', () => {
  for (const q of ['Is the Great Wall visible from space?', 'did napoleon die of poison', 'Will ETH beat BTC this month?', 'How old is the universe']) assert.ok(isQuestion(q), q)
  for (const t of ['Great Wall of China', 'Napoleon', 'https://en.wikipedia.org/wiki/Pluto', 'Bitcoin']) assert.ok(!isQuestion(t), t)
})
test('a question never mints a duplicate of a claim the page already prices', () => {
  const facts = [{ market: 41, claim: 'The Great Wall of China is visible from the Moon with the naked eye.' }, { market: 42, claim: 'The Great Wall was built in a single dynasty.' }]
  assert.equal(same(facts, 'The Great Wall of China can be seen from the Moon with the naked eye.')?.market, 41)
  assert.equal(same(facts, 'Napoleon died of arsenic poisoning on Saint Helena.'), null)
  assert.ok(overlap('alpha beta gamma delta', 'alpha beta gamma delta') === 1 && overlap('alpha beta gamma delta', 'xray yankee zulu') === 0)
})
