import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameOnPage } from '../facts.mjs'

const FACTS = [{ market: 42, claim: 'The Great Wall of China is a single continuous wall.' }, { market: 41, claim: 'The Great Wall of China is visible from the Moon with the naked eye.' }]
test('a same-page match with shared words but a different fact is refused by the model check', async () => {
  const asked = []
  const no = async (a, b) => { asked.push(b); return false }
  assert.equal(await sameOnPage(FACTS, 'The Great Wall of China was built in a single dynasty.', no), null)
  assert.equal(asked.length, 1)
  assert.equal((await sameOnPage(FACTS, 'The Great Wall of China was built in a single dynasty.', async () => true))?.market, 42)
  assert.equal((await sameOnPage(FACTS, 'The Great Wall of China is visible from the Moon with the naked eye', no))?.market, 41, 'near-identical wording needs no call')
})
