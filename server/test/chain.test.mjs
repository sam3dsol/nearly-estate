// the chain markets: each question maps to exactly one recipe, and a market is never read before its date
import test from "node:test"
import assert from "node:assert/strict"
process.env.DATA ||= "/tmp/chain-test-data"
const chain = await import("../chain.mjs")

test("every chain market names its source in the question and has a rule", () => {
  for (const [q, s] of Object.entries(chain.SPECS)) {
    assert.ok(q.includes(s.source) || q.includes("mempool.space"), q)
    assert.match(s.rule, /^true if /)
    assert.equal(typeof s.settle, "function"); assert.equal(typeof s.now, "function")
  }
})
test("a question is matched exactly, spacing aside", () => {
  const q = Object.keys(chain.SPECS)[0]
  assert.ok(chain.specOf(q)); assert.ok(chain.specOf(`  ${q.replace(/ /g, "  ")} `))
  assert.equal(chain.specOf(q.slice(0, -2)), null)
})
test("before its date the judge is told to wait, without reading anything", async () => {
  const q = Object.keys(chain.SPECS)[1]
  const r = await chain.judgeEvidence({ id: 1, question: q, resolves_at_ms: Date.now() + 864e5 })
  assert.equal(r.pending, true)
})
