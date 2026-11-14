import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp } from '../ip.mjs'

const req = (sock, headers = {}) => ({ socket: { remoteAddress: sock }, headers })
test('a direct connection is its socket', () => { assert.equal(clientIp(req('203.0.113.9', { 'x-forwarded-for': '198.51.100.1' })), '203.0.113.9') })
test("behind the proxies Cloudflare's header wins, then the last public hop, never the client's own first hop", () => {
  assert.equal(clientIp(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4, 198.51.100.7, 172.70.1.1' })), '198.51.100.7')
  assert.equal(clientIp(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4, 198.51.100.7, 10.0.0.2' })), '198.51.100.7')
  assert.equal(clientIp(req('127.0.0.1', { 'x-forwarded-for': 'junk, 10.0.0.2' })), '127.0.0.1')
})

test("with an edge key set, a forwarded address counts only on a request the edge marked; the rest share one bucket", async () => {
  process.env.EDGE_KEY = "k"
  const { clientIp: withKey } = await import("../ip.mjs?edge")
  assert.equal(withKey(req("127.0.0.1", { "cf-connecting-ip": "198.51.100.7", "x-nearly-edge": "k" })), "198.51.100.7")
  assert.equal(withKey(req("127.0.0.1", { "cf-connecting-ip": "198.51.100.7" })), "direct")
  assert.equal(withKey(req("127.0.0.1", { "cf-connecting-ip": "198.51.100.7", "x-nearly-edge": "wrong" })), "direct")
  delete process.env.EDGE_KEY
})
