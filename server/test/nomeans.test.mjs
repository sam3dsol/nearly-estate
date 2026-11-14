// what a NO means: the model's reply is read by claim number and checked, a round asks 20 claims a call, and the daily cap holds
// whatever the backlog (the model is a stand-in here: no network, no AI credits)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nomeans-test-'))
process.env.WIKI_NOMEANS_PER_DAY = '30'
const claims = Array.from({ length: 45 }, (_, i) => `Claim number ${i + 1} about the topic holds.`)
fs.writeFileSync(path.join(process.env.DATA, 'pages.json'), JSON.stringify({ 'coffee.topic': { kind: 'topic', title: 'Coffee', claims, facts: [] }, 'batman-17.nearlytrade.near': { kind: 'token', claims: ['Hidden.'], facts: [] } }))
const { readNoMeans, noMeansDue } = await import('../wiki.mjs')

test('a reply is read by claim number; empty, echoed, unnumbered or overlong answers are dropped', () => {
  const batch = ['Coffee dehydrates habitual drinkers.', 'Pluto has five known moons.', 'Lightning never strikes twice.']
  const j = { no: [{ i: 1, text: 'Coffee does not cause net dehydration in people who drink it habitually.' }, { i: 2, text: 'Pluto has five known moons.' }, { i: 3, text: '' }, { text: 'no number' }, { i: 9, text: 'Out of range claim number here.' }, { i: 3, text: 'x'.repeat(300) }] }
  assert.deepEqual(readNoMeans(batch, j), [[batch[0], 'Coffee does not cause net dehydration in people who drink it habitually.']])
  assert.deepEqual(readNoMeans(batch, null), [])
})
test('20 claims a call, at most the daily cap, and nothing at all without a key', async () => {
  const calls = []
  const chat = async (messages) => { const { claims: cs } = JSON.parse(messages[1].content); calls.push(cs.length); return { json: { no: cs.map((c) => ({ i: c.i, text: `It is not so: ${c.claim.replace(' holds.', ' fails.')}` })) } } }
  assert.equal(await noMeansDue({ chat, live: false, all: async () => [] }), 0)
  assert.deepEqual(calls, [])
  assert.equal(await noMeansDue({ chat, live: true, all: async () => [] }), 30)
  assert.deepEqual(calls, [20, 10], 'the cap is 30 a day: the second call takes the 10 left')
  assert.equal(await noMeansDue({ chat, live: true, all: async () => [] }), 0, 'the day is spent')
  const kept = JSON.parse(fs.readFileSync(path.join(process.env.DATA, 'nomeans.json'), 'utf8'))
  assert.equal(Object.keys(kept).length, 30)
  assert.ok(Object.values(kept).every((t) => t.endsWith('fails.')))
})
