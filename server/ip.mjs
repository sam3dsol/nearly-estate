// the client's address behind our proxies, for rate limits (its own module so a test can import it without starting the server)
/** the client's address for rate limits: behind our proxy (Caddy on nearly.trade, then the enclave's edge) every socket is the
 * proxy's, so the first hop of X-Forwarded-For is the client; a direct connection keeps its socket address*/
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|fc|fd)/i
const IP = /^[0-9a-f.:]{3,45}$/i
const EDGE_KEY = process.env.EDGE_KEY || ''
export function clientIp(req) {
  const sock = String(req?.socket?.remoteAddress || '')
  if (sock && !PRIVATE.test(sock)) return sock
  // the enclave's own endpoint is reachable without our edge, and there a client writes any header it likes: the forwarded
  // address counts only on a request our edge (Caddy) marked with the shared key; the rest share one bucket, 'direct'
  if (EDGE_KEY && String(req?.headers?.['x-nearly-edge'] || '') !== EDGE_KEY) return 'direct'
  // behind our proxies: Cloudflare sets cf-connecting-ip on every request it forwards (a client cannot); otherwise the hops
  // our proxies appended are at the END of X-Forwarded-For, so the last public one is the client, never the first (a client writes that)
  const cf = String(req?.headers?.['cf-connecting-ip'] || '').trim(); if (IP.test(cf)) return cf
  const hops = String(req?.headers?.['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter((x) => IP.test(x) && !PRIVATE.test(x))
  return hops.length ? hops[hops.length - 1] : sock
}
