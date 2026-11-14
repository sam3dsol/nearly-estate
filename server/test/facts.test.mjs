import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidates, findSame, overlap, linkKeys } from '../facts.mjs'

const ALL = [
  { id: 41, subject: 'great-wall-of-china.topic', status: 'Open', question: 'The Great Wall of China is visible from the Moon with the naked eye.' },
  { id: 98, subject: 'napoleon.topic', status: 'Open', question: 'Napoleon died of stomach cancer on the island of Saint Helena in 1821.' },
  { id: 333, subject: 'napoleon.topic', status: 'Open', question: 'Napoleon died of arsenic poisoning.' },
  { id: 7, subject: 'moon.topic', status: { Invalid: { at_ms: 1 } }, question: 'The Great Wall of China is visible from the Moon.' },
]

test('candidates: other pages only, by shared words, best first, never a voided market', () => {
  const c = candidates('The Great Wall is visible from the Moon with the naked eye.', ALL, 'space.topic')
  assert.deepEqual(c.map((m) => m.id), [41])
  assert.deepEqual(candidates('The Great Wall is visible from the Moon.', ALL, 'great-wall-of-china.topic').map((m) => m.id), [])
})
test('near-identical wording links without a model call; otherwise the model decides', async () => {
  let asked = 0
  const confirm = async () => { asked++; return false }
  const m = await findSame('The Great Wall of China is visible from the Moon with the naked eye', { exclude: 'space.topic', all: ALL, confirm })
  assert.equal(m?.id, 41); assert.equal(asked, 0)
  const n = await findSame('Napoleon died on Saint Helena of a stomach illness in 1821.', { exclude: 'france.topic', all: ALL, confirm })
  assert.equal(n, null); assert.ok(asked >= 1, 'the model was asked about the close one')
  const y = await findSame('Napoleon died on Saint Helena of a stomach illness in 1821.', { exclude: 'france.topic', all: ALL, confirm: async () => true })
  assert.equal(y?.id, 98)
})
test('overlap is against the shorter sentence', () => { assert.equal(overlap('alpha beta gamma', 'alpha beta gamma delta epsilon'), 1); assert.equal(overlap('alpha beta', 'gamma delta'), 0) })

test('a link answers to the page\'s phrasing and to the market\'s question, so a rewrite finds it', () => {
  assert.deepEqual(linkKeys('Napoleon Bonaparte died of arsenic poisoning', 'Napoleon died of arsenic poisoning.'), ['napoleon bonaparte died of arsenic poisoning', 'napoleon died of arsenic poisoning'])
  assert.deepEqual(linkKeys('Same text.', 'Same text.'), ['same text'])
})

test('the no-model shortcut needs the same words in the same order: a subject swap or a qualifier asks the model', async () => {
  const asked = []
  const no = async (a, b) => { asked.push(b); return false }
  const all = [{ id: 7, question: 'Germany defeated France in 1940.', subject: 'ww2.topic', status: 'Open' }]
  assert.equal(await findSame('France defeated Germany in 1940.', { exclude: 'x', all, confirm: no }).catch(() => 'threw'), null)
  assert.equal(asked.length, 1, 'the swap went to the model')
})
