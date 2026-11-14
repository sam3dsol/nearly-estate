// a URL segment named like an Object.prototype key ("constructor", "toString", "__proto__" ...) is not an existing
// topic, key or agent. GET /api/wiki/constructor answered with a new "Undefined" page and opened markets 424-430 from the wiki fund;
// now every such read is an own-key check, the tables have no prototype, it answers 404, writes no page and opens no market,
// and what the bug left on disk is pruned at start. No network: every outgoing call is recorded and refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import crypto from 'node:crypto'
const DATA = (process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-test-')))
process.env.SITE = 'http://127.0.0.1:9'
// what the bug left: a page under "constructor.topic" with its history, next to a real topic that must stay
fs.writeFileSync(path.join(DATA, 'pages.json'), JSON.stringify({ 'constructor.topic': { kind: 'topic', slug: 'constructor', title: 'Undefined', facts: [] }, 'pluto.topic': { kind: 'topic', slug: 'pluto', title: 'Pluto', facts: [] } }))
fs.writeFileSync(path.join(DATA, 'revisions.json'), JSON.stringify({ 'constructor.topic': [{ at: 1, why: 'First version' }] }))
fs.writeFileSync(path.join(DATA, 'topics.json'), JSON.stringify({ pluto: { slug: 'pluto', title: 'Pluto' } }))
const calls = []
globalThis.fetch = async (url, o = {}) => {
  calls.push({ url: String(url), body: String(o.body || '') })
  if (String(url).endsWith('/api/social/me')) return new Response(JSON.stringify({ account: 'alice.near' }), { headers: { 'content-type': 'application/json' } })
  throw new Error('offline test')
}
const { table, own, isProtoName, PROTO_NAMES } = await import('../store.mjs')
const wiki = await import('../wiki.mjs')
const keys = await import('../keys.mjs')
const swarm = await import('../swarm.mjs')
const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']
const is404 = (e) => e.status === 404

test('the prototype names are exactly the twelve keys of Object.prototype', () => {
  assert.deepEqual([...PROTO_NAMES].sort(), [...NAMES].sort())
  for (const n of NAMES) assert.ok(isProtoName(n))
  assert.ok(!isProtoName('pluto') && !isProtoName('Constructor'))
})

test('a table has no prototype: a prototype name reads as absent and writes as a plain key', () => {
  const t = table('proto-scratch', {})
  for (const n of NAMES) { assert.equal(t.v[n], undefined); assert.equal(own(t.v, n), undefined) }
  t.v.__proto__ = { x: 1 }
  assert.equal(Object.getPrototypeOf(t.v), null)
  assert.ok(Object.hasOwn(t.v, '__proto__'))
  t.save()
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(DATA, 'proto-scratch.json'), 'utf8'))), ['__proto__'])
  t.v = { a: 1 }   // a whole table replaced (the admin import) stays prototype-free
  assert.equal(Object.getPrototypeOf(t.v), null); assert.equal(t.v.constructor, undefined)
  assert.equal(own({ a: 1 }, 'constructor'), undefined); assert.equal(own({ a: 1 }, 'a'), 1); assert.equal(own(null, 'a'), undefined)
})

test('what the bug left is pruned at start; the real topic stays; the prune is idempotent', () => {
  assert.ok(!Object.hasOwn(table('pages').v, 'constructor.topic'))
  assert.ok(!Object.hasOwn(table('revisions').v, 'constructor.topic'))
  assert.ok(Object.hasOwn(table('pages').v, 'pluto.topic'))
  assert.ok(Object.hasOwn(table('topics').v, 'pluto'))
  assert.ok(!JSON.parse(fs.readFileSync(path.join(DATA, 'pages.json'), 'utf8'))['constructor.topic'])
  assert.equal(wiki.pruneProto(), 0)
  assert.ok(!wiki.cached().some((p) => p.slug === 'constructor' || p.title === 'Undefined'))
})

test('GET /api/wiki/<prototype name> (with or without .topic): 404, no page written, no market opened', async () => {
  const before = { pages: Object.keys(table('pages').v).sort(), topics: Object.keys(table('topics').v).sort() }
  calls.length = 0
  for (const n of NAMES) for (const x of [n, `${n}.topic`]) {
    await assert.rejects(wiki.page(x), is404, `page ${x}`)
    await assert.rejects(wiki.history(x), is404, `history ${x}`)
    await assert.rejects(wiki.receipt(x), is404, `receipt ${x}`)
    assert.equal(wiki.pageOf(`${n}.topic`), null)
  }
  assert.deepEqual({ pages: Object.keys(table('pages').v).sort(), topics: Object.keys(table('topics').v).sort() }, before)
  assert.equal(Object.getPrototypeOf(table('topics').v), null)
  assert.equal(Object.prototype.category, undefined); assert.equal(Object.category, undefined)   // the old path wrote onto Object itself
  // the only calls: the launch list on the site (a launch token is the other kind of page); nothing to the chain, nothing opened
  assert.ok(calls.every((c) => c.url.startsWith('http://127.0.0.1:9/api/launches-all')), JSON.stringify(calls.slice(0, 3)))
  assert.ok(!calls.some((c) => /open_fact|broadcast_tx|send_tx/.test(c.body)))
})

test('the keys and swarm reads take no prototype name for a record', async () => {
  const commitment = crypto.createHash('sha256').update('undefined:undefined').digest('hex')
  for (const n of NAMES) {
    assert.equal(keys.matches({ token: n, owner: undefined, commitment }), false)   // was true for "constructor": Object has no owner either
    await assert.rejects(keys.pause({ token: n, session: 's', paused: true }), is404)
    assert.deepEqual(swarm.logOf(n), [])
    assert.ok(!swarm.reviewReceipt(n))
  }
  assert.equal(Object.prototype.paused, undefined)
})
