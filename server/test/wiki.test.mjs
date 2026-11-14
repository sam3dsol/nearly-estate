// the wiki: wording bands, topic slugs, source passages, the source reader refusing private or plain-http links, and the fact
// desk sizing a trade with the market maker\x27s own maths (no network)
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"; import os from "node:os"; import path from "node:path"
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-test-"))
const { band, deepEnough, yoctoOf, FACT_SEED_NEAR } = await import("../wiki.mjs")
const wp = await import("../wikipedia.mjs")
const { costTo } = await import("../desk.mjs")

test("a price maps to the wording the page uses", () => {
  assert.equal(band(0.97, "Open"), "established")
  assert.equal(band(0.85, "Open"), "very likely")
  assert.equal(band(0.65, "Open"), "likely")
  assert.equal(band(0.5, "Open"), "disputed")
  assert.equal(band(0.3, "Open"), "unlikely")
  assert.equal(band(0.1, "Open"), "very unlikely")
  assert.equal(band(0.02, "Open"), "rejected")
})
test("a market nobody traded is not disputed: its 50% is only the opening price", () => {
  assert.equal(band(0.5, "Open", false), "untraded")
  assert.equal(band(0.5, "Open", true), "disputed")
})
test("a settled or void market reads as settled, whatever its last price", () => {
  assert.equal(band(0.5, { Resolved: { outcome: true } }), "settled true")
  assert.equal(band(0.5, { Resolved: { outcome: false } }), "settled false")
  assert.equal(band(0.5, { Invalid: { at_ms: 1 } }), "void")
  assert.equal(band(null, "Unpriced"), "unpriced")
  assert.equal(band(0.5, { Proposed: { outcome: false, at_ms: 1 } }), "proposed false")   // the judge ruled; open to challenge
  assert.equal(band(0.5, { Challenged: { outcome: true, round: 1 } }), "challenged")
})
test("a topic slug is a valid NEAR account part; its markets sit under <slug>.topic", () => {
  assert.equal(wp.slugOf("Great Wall of China"), "great-wall-of-china")
  assert.equal(wp.slugOf("Pokémon: Gotta Catch ’Em All!"), "pokemon-gotta-catch-em-all")
  assert.ok(wp.slugOf("x".repeat(200)).length <= 56)
  assert.equal(wp.subjectOf("pluto"), "pluto.topic")
  assert.ok(wp.isTopicSubject("pluto.topic"))
  assert.ok(!wp.isTopicSubject("nearly-993927.nearlytrade.near"))
})
test("the judge reads the passages that share the claim\x27s words", () => {
  const text = "Intro paragraph about the wall and its long history in northern China and beyond.\nMarco Polo did not mention the Great Wall in his accounts of travels through China in the 13th century.\nUnrelated paragraph about bricks, mortar, rammed earth and the logistics of supplying garrisons."
  const p = wp.passages(text, "Marco Polo mentioned the Great Wall in his writings.")
  assert.match(p, /Marco Polo did not mention/)
  assert.doesNotMatch(p, /bricks/)   // a paragraph that shares none of the claim's words is left out
})
test("a posted source must be public https: plain http, raw IPs, ports and credentials are refused before any fetch", async () => {
  assert.equal(await wp.readSource("http://example.com/"), null)
  assert.equal(await wp.readSource("https://127.0.0.1/"), null)
  assert.equal(await wp.readSource("https://example.com:8443/"), null)
  assert.equal(await wp.readSource("https://user:pw@example.com/"), null)
  assert.equal(await wp.readSource("not a url"), null)
})
test("the desk sizes a trade with the LMSR cost: moving YES from 50% to 70% at b = 1 costs ln(0.5/0.3)", () => {
  assert.ok(Math.abs(costTo(1, 0.5, 0.7) - Math.log(0.5 / 0.3)) < 1e-12)
  assert.ok(Math.abs(costTo(1, 0.5, 0.3) - Math.log(0.5 / 0.3)) < 1e-12)
  assert.ok(costTo(0.0289, 0.5, 0.6) < 0.01)   // a seeded fact market moves 10 points for under a cent of NEAR
})
test("the market against Wikipedia: agrees, split, disagrees; silent or untraded says nothing", async () => {
  const { versus } = await import("../wiki.mjs")
  assert.equal(versus({ band: "rejected", wiki: { says: "false" } }), "agrees")
  assert.equal(versus({ band: "likely", wiki: { says: "false" } }), "disagrees")
  assert.equal(versus({ band: "proposed false", wiki: { says: "true" } }), "disagrees")
  assert.equal(versus({ band: "disputed", wiki: { says: "true" } }), "split")
  assert.equal(versus({ band: "untraded", wiki: { says: "true" } }), null)
  assert.equal(versus({ band: "likely", wiki: { says: "silent" } }), null)
  assert.equal(versus({ band: "likely", wiki: null }), null)
})

test("a thin market never reads as fact: under 0.2 NEAR and under 3 traders the wording is capped at likely, disputed or unlikely", () => {
  assert.equal(band(0.97, "Open", true, false), "likely")
  assert.equal(band(0.85, "Open", true, false), "likely")
  assert.equal(band(0.5, "Open", true, false), "disputed")
  assert.equal(band(0.3, "Open", true, false), "unlikely")
  assert.equal(band(0.03, "Open", true, false), "unlikely")
  assert.equal(band(0.5, "Open", false, false), "untraded")
  assert.equal(band(0.97, "Open", true, true), "established")
  assert.equal(band(0.5, { Resolved: { outcome: true } }, true, false), "settled true")   // a ruling is not a price
  assert.equal(band(0.5, { Proposed: { outcome: false, at_ms: 1 } }, true, false), "proposed false")
  assert.equal(deepEnough({ collateral_near: 0.05, volume_near: 0.03, traders: 1 }), false)   // a fresh fact market after one 0.03 bet
  assert.equal(deepEnough({ collateral_near: 0.2 }), true)
  assert.equal(deepEnough({ collateral_near: 0.05, volume_near: 0.2 }), true)
  assert.equal(deepEnough({ collateral_near: 0.05, traders: 3 }), true)
  assert.equal(deepEnough({}), false)
})

test("a fact seed goes to open_fact as an exact yocto string (WIKI_FACT_SEED_NEAR, 0.02 unless the compose says more)", () => {
  assert.equal(FACT_SEED_NEAR, 0.02)
  assert.equal(yoctoOf(0.02), "20000000000000000000000")
  assert.equal(yoctoOf("0.15"), "150000000000000000000000")
  assert.equal(yoctoOf(0.15), "150000000000000000000000")   // 0.15 * 1e24 as a float is 149999999999999991611392
  assert.equal(yoctoOf(1), "1000000000000000000000000")
  assert.equal(yoctoOf("1.5"), "1500000000000000000000000")
})
