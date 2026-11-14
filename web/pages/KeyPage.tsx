import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useWallet } from '../lib/wallet'
import { useSocialSession, friendlyError } from '../lib/social'
import { useIxWallet } from '../lib/ix'
import { getSolWallet } from '../lib/solTrade'
import { timeAgo, usdAmt } from '../lib/format'
import { Page, Stats, Avatar, Spark, pnlLine, keyName, keyBadges, nearAmt, money, signedUsd, tone, pnlText, pnlTone, useTitle } from '../components/Market'
import { KEYS_WS, KeysError, feedToken, get, keepFeedToken, post, near, tx, rememberKey, type Feed, type FeedTrade, type KeyRow, type SwarmData } from '../lib/keys'
import { roiText } from './Keys'
import { load as loadAgent } from '../lib/agents'
import { notify, askNotify, notifyState } from '../lib/notify'

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
/** a swap's USD value from its human amounts ("1.99 USDC" counts as $1.99; a NEAR side needs the price) */
const swapUsd = (o: { in?: string | null; out?: string | null }, nearUsd: number | null) => { for (const s of [o.in, o.out]) { const m = /^([\d.]+) (USDC|USDT)$/.exec(s || ''); if (m) return Number(m[1]) } for (const s of [o.in, o.out]) { const m = /^([\d.]+) w?NEAR$/.exec(s || ''); if (m && nearUsd) return Number(m[1]) * nearUsd } return null }

/** /keys/:token: the key as one big card, its trades as a board. Locked, the board is blurred and the way in sits on it. */
// behind the blur: made-up trades shaped like real ones
const LOCKED: [string, string, string, string][] = [['buy', '1.20 wNEAR', '4.31 USDC', '$4.31'], ['sell', '820K NEARLY', '0.94 wNEAR', '$3.38'], ['buy', '2.50 USDC', '0.69 wNEAR', '$2.50'], ['buy', '0.40 wNEAR', '310K BATMAN', '$1.44'], ['sell', '1.10 wNEAR', '3.95 USDC', '$3.95'], ['buy', '5.00 USDC', '1.39 wNEAR', '$5.00'], ['sell', '2.1M DRAGON', '0.52 wNEAR', '$1.87'], ['buy', '0.75 wNEAR', '2.70 USDC', '$2.70'], ['sell', '3.20 USDC', '0.89 wNEAR', '$3.20']]
export function KeyPage() {
  const { token = '' } = useParams()
  const w = useWallet()
  const ix = useIxWallet()
  const { withSession } = useSocialSession('Unlock a key on nearly.trade')
  const [k, setK] = useState<KeyRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ft, setFt] = useState<string | null>(() => feedToken(token))
  const [feed, setFeed] = useState<Feed | null>(null)
  const [live, setLive] = useState<FeedTrade[]>([])
  const [alerts, setAlerts] = useState(notifyState())   // a trade on a key you hold, as a notification while the tab is hidden
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [nearUsd, setNearUsd] = useState<number | null>(null)
  const sock = useRef<WebSocket | null>(null)
  const nav = useNavigate()
  // an old /keys/2 link (the chain calls keys by number): send it to the key's own page, named by its account
  const byId = /^\d{1,9}$/.test(token)
  useEffect(() => {
    if (!byId) return
    let on = true
    get<KeyRow[]>('/api/keys').then((ks) => { const m = ks.find((x) => String(x.id) === token); if (!on) return; if (m) nav(`/keys/${m.token}`, { replace: true }); else setErr(`No key number ${token}`) }).catch((e) => on && setErr(e instanceof Error ? e.message : 'failed'))
    return () => { on = false }
  }, [byId, token, nav])
  useEffect(() => { setFt(feedToken(token)) }, [token])
  useEffect(() => { get<{ near_usd?: number }>('/api/stats').then((s) => s.near_usd && setNearUsd(s.near_usd)).catch(() => {}) }, [])
  useEffect(() => {
    if (byId) return
    let on = true; setK(null); setErr(null)
    const load = () => get<KeyRow>(`/api/keys/${token}`).then((r) => on && setK(r)).catch((e) => on && setErr(e instanceof Error ? e.message : 'failed'))
    load(); const t = setInterval(load, 30_000)
    return () => { on = false; clearInterval(t) }
  }, [token, byId])
  // unlocked: the history, then the live socket
  useEffect(() => {
    if (!ft) return
    let on = true
    get<Feed>(`/api/keys/${token}/feed?ft=${encodeURIComponent(ft)}`).then((f) => on && setFeed(f)).catch((e) => { if (e instanceof KeysError && e.status === 401) setFt(null); else setNote(e.message) })
    const s = new WebSocket(`${KEYS_WS}/api/keys/${token}/live?ft=${encodeURIComponent(ft)}`)
    s.onmessage = (ev) => { try { const m = JSON.parse(ev.data) as FeedTrade & { type: string }; if (m.type === 'trade') { setLive((l) => [m, ...l].slice(0, 50)); if (document.hidden) notify('New trade on a key you hold', `${m.side === 'buy' ? 'Bought' : 'Sold'} ${m.symbol} · ${usdAmt(m.usd)}`, location.pathname) } } catch { /* ignore */ } }
    sock.current = s
    return () => { on = false; s.close() }
  }, [ft, token])

  const unlock = async (how: 'near' | 'sol') => {
    setBusy(true); setNote(null)
    try {
      let r: { ft: string; exp: number }
      if (how === 'near') r = await withSession((session) => post<{ ft: string; exp: number }>(`/api/keys/${token}/unlock`, { session }))
      else {
        const p = getSolWallet(); if (!p?.signMessage || !ix) throw new Error('Connect Phantom first')
        const { message } = await post<{ message: string }>(`/api/keys/${token}/challenge`, { address: ix.addr })
        const s = await p.signMessage(new TextEncoder().encode(message), 'utf8'); const sig = s instanceof Uint8Array ? s : s.signature
        r = await post<{ ft: string; exp: number }>(`/api/keys/${token}/unlock`, { sol: { address: ix.addr, signature: b64(sig), message } })
      }
      keepFeedToken(token, r.ft, r.exp); setFt(r.ft); rememberKey(token)   // listed under "Your keys" on /keys
    } catch (e) { setNote(e instanceof KeysError && e.status === 402 ? e.message : friendlyError(e)) } finally { setBusy(false) }
  }
  // buy the viewing key on chain (the price goes to the trader), then unlock with the same wallet
  const buy = async () => {
    if (!k) return
    if (!w.accountId) { w.signIn(); return }
    setBusy(true); setNote(null)
    try { await w.send([tx.buyKey(k.id, k.price)]); await new Promise((r) => setTimeout(r, 2500)); await unlock('near') } catch (e) { setNote(friendlyError(e)) } finally { setBusy(false) }
  }

  useTitle(k ? `${k.token}'s viewing key` : 'Viewing key')
  const crumb = <Link to="/keys" className="mk-crumb">← Viewing keys</Link>
  if (err && !k) return <Page>{crumb}<div className="mk-card"><div className="mk-name">{/no key/i.test(err) ? 'No viewing key for this account' : 'This key did not load'}</div><div className="mk-text">{/no key/i.test(err) ? 'The account sells no key, or it was retired.' : `${err}.`}</div><Link to="/keys" className="mk-btn ghost auto self-start">See the keys on sale</Link></div></Page>
  if (!k) return <Page>{crumb}<div className="mk-split key"><div className="mk-card skel" /><div className="mk-card skel" /></div></Page>
  // only account keys are sold; any other key's page says so instead of selling it
  if (k.coin) return <Page>{crumb}<div className="mk-grid"><div className="mk-card"><div className="mk-name">This key is not on sale</div><div className="mk-text">A viewing key is a trader's own account.</div><Link to="/keys" className="mk-btn ghost">See the keys on sale</Link></div></div></Page>

  const price = near(k.price)
  const name = keyName(k)
  const pnl = k.pnl?.pnl_usd ?? null
  const trades = [...live, ...(feed?.trades ?? [])]
  // its NEAR Intents swaps and its Rhea swaps, newest first
  const intents = [...(feed?.intents ?? []), ...(feed?.rhea ?? [])].sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0))
  const line = feed ? pnlLine(feed, nearUsd) : []
  const rows = intents.length + trades.length
  return (
    <Page>
      {crumb}
      <div className="mk-split key">
        <div className="mk-stack">
          {/* the key */}
          <div className="mk-card">
            <div className="mk-row">
              <Avatar icon={k.icon} name={name} size="lg" />
              <div className="min-w-0"><div className="mk-name lg">{name}</div><div className="mk-sub">trades on {k.confidential ? 'NEAR Intents' : 'nearly.trade'}</div></div>
              {keyBadges(k).length ? <span className="mk-badges end">{keyBadges(k).map((b) => <span key={b} className="mk-chip">{b}</span>)}</span> : null}
            </div>
            <div><div className="mk-big">{nearAmt(price)}</div><div className="mk-sub">{nearUsd ? `${money(price * nearUsd)} to see every trade, paid to the trader` : 'paid to the trader'}</div></div>
            {line.length > 1 ? <Spark points={line} /> : <div className="mk-spark-none">{ft ? 'No swaps yet behind this key.' : 'The PnL is public; its line over time is for key holders.'}</div>}
            <Stats items={[
              { k: 'Trades', v: k.stats?.trades_label ?? 'under 10' },
              { k: 'PnL', v: pnlText(pnl), tone: pnlTone(pnl) },
              // the return on what the trader put in, beside the PnL
              { k: 'ROI', v: roiText(k.pnl?.roi), tone: (k.pnl?.roi ?? 0) > 0 ? 'pos' : (k.pnl?.roi ?? 0) < 0 ? 'neg' : '' },
              { k: 'Active', v: k.stats?.active ? 'this week' : 'quiet' },
              { k: 'Buyers', v: k.sold },
              { k: 'Copying', v: k.copying ?? 0 },
              { k: 'Win rate', v: k.stats?.win_rate != null ? `${Math.round(k.stats.win_rate * 100)}%` : 'not yet', txt: k.stats?.win_rate == null },   /* */
            ]} />
            {k.revealed ? <div className="mk-note">Retired: the trader revealed <Link to={`/u/${k.revealed}`} className="mk-link">{k.revealed}</Link>.</div> : null}
            {ft ? <div className="mk-row"><span className="mk-dot" /><span className="mk-sub">Unlocked in this browser</span></div> : null}
          </div>
          <CopyBox token={k.token} name={name} ft={ft} onBuy={buy} />
          {feed?.bags.length ? (
            <div className="mk-card">
              <div className="mk-name">Open bags</div>
              <div>{feed.bags.map((b) => <Link key={b.token} to={`/${b.token}`} className="mk-tr"><span className="v">{b.symbol}</span><span>{usdAmt(b.open_usd)}</span><span className={tone(b.pnl_usd) === 'pos' ? 'text-[var(--mk-jade-t)]' : tone(b.pnl_usd) === 'neg' ? 'text-[var(--mk-red)]' : ''}>{signedUsd(b.pnl_usd)}</span></Link>)}</div>
            </div>
          ) : null}
        </div>

        {/* the trades */}
        <div className="mk-card mk-board">
          <div className="hd"><span className="mk-name">Trades</span>{ft && alerts === 'default' ? <button type="button" className="mk-chip" onClick={() => askNotify().then(() => setAlerts(notifyState()))}>Alert me</button> : null}{k.confidential ? <span className="mk-chip">NEAR Intents, confidential</span> : null}<span className="mk-sub end">{ft ? (feed ? `${rows} ${rows === 1 ? 'swap' : 'swaps'}, live` : 'loading') : `${k.sold} ${k.sold === 1 ? 'buyer sees' : 'buyers see'} these`}</span></div>
          <div className="mk-cols"><span>Side</span><span>Trade</span><span className="text-right">USD</span><span className="text-right">Ago</span></div>
          {!ft ? (
            <div className="mk-locked">
              {/* shaped like the real feed, with no symbol, size or side a reader could take as a trade */}
              <div className="mk-blur" aria-hidden style={{ userSelect: 'none' }}>{LOCKED.map((t, i) => <div key={i} className="mk-trade"><span className="side">{t[0]}</span><span className="tok">{t[1]} <em>→</em> {t[2]}</span><span className="r">{t[3]}</span><span className="r dim">{i + 1}h</span></div>)}</div>
              <div className="mk-door"><div>
                {/* paused by the trader: no sale until it resumes (holders and the seller unlock as before) */}
                {k.paused ? <div className="mk-pill">Paused by the trader</div> : null}
                <div className="mk-name">{k.paused ? 'Not on sale right now' : 'Every trade behind this key'}</div>
                {/* what one payment covers */}
                <div className="mk-sub">Pay once: the trade history and every new trade, live, with the size, for as long as the key is sold. Confidential NEAR Intents swaps can't be matched to an account; a public trade shows rounded. PnL covers the last 40 transactions.</div>
                {k.paused ? null : <button className="mk-btn" disabled={busy} onClick={buy}>Buy the key for {nearAmt(price)}</button>}
                {w.accountId ? <button className="mk-btn ghost" disabled={busy} onClick={() => unlock('near')}>I have it, unlock</button> : null}
                {/* the review: a Solana unlock can never pass (the key is bought with native NEAR, the unlock gets 402), so the button is gone */}
                {note ? <div className="mk-err">{note}</div> : null}
              </div></div>
            </div>
          ) : <>
            {!feed ? <div className="h-40 animate-pulse" /> : null}
            {feed && !rows ? <div className="mk-trade"><span /><span className="dim">No trades yet from behind this key.</span><span /><span /></div> : null}
            {intents.map((o, i) => { const usd = swapUsd(o, nearUsd), sell = o.venue === 'rhea' ? /^[\d.]+ (w?NEAR|USDC|USDT)$/.test(o.out || '') : /USDC|USDT/.test(o.out || ''); return (
              <div key={`${o.id ?? o.tx}-${i}`} className="mk-trade">
                <span className={`side ${sell ? 'sell' : 'buy'}`}>{sell ? 'sell' : 'buy'}</span>
                <span className="tok">{o.in || (o.origin || '?').replace(/^nep141:/, '').split('.')[0]} <em>→</em> {o.out || (o.destination || '?').replace(/^nep141:/, '').split('.')[0]}{o.status && o.status !== 'SUCCESS' ? <span className="mk-state red">{o.status.toLowerCase()}</span> : null}{o.venue === 'rhea' ? <span className="mk-chip">Rhea</span> : null}</span>
                <span className="r">{usd == null ? '' : usdAmt(usd)}</span>
                <span className="r dim">{o.ts_ms ? timeAgo(o.ts_ms) : ''}</span>
              </div>
            ) })}
            {trades.map((t, i) => (
              <Link key={`${t.ts_ms}-${i}`} to={`/${t.token}`} className={`mk-trade ${i < live.length ? 'new' : ''}`}>
                <span className={`side ${t.side}`}>{t.side}</span>
                <span className="tok"><Avatar icon={t.icon} name={t.symbol} size="sm" />{t.symbol}<em className="max-sm:hidden">at {usdAmt(t.mcap_usd)} mcap</em></span>
                <span className="r">{usdAmt(t.usd)}</span>
                <span className="r dim">{timeAgo(t.ts_ms)}</span>
              </Link>
            ))}
            {note ? <div className="mk-trade"><span /><span className="mk-err">{note}</span><span /><span /></div> : null}
          </>}
        </div>
      </div>
    </Page>
  )
}

/** copy the key with your agent: an agent wallet from the Agents page, or a swarm agent of yours, copies every trade behind
 *  the key at your ratio, up to your cap per trade, inside the wallet's own NEAR Intents rules. Shown to everyone, usable with the key. */
type MyCopy = { agent: string; name?: string; ratio_bps: number; max_usd: number; since: number; n: number; last: { t: number; trade: string; usd: number; result: string }[] }
function CopyBox({ token, name, ft, onBuy }: { token: string; name: string; ft: string | null; onBuy: () => void }) {
  const w = useWallet()
  const { withSession } = useSocialSession('Copy a key with my agent')
  const wallet = loadAgent()?.agent_id ?? null   // the agent wallet made on the Agents page in this browser
  const [agents, setAgents] = useState<{ account: string; name: string }[]>(() => (wallet ? [{ account: wallet, name: 'My agent wallet' }] : []))
  const [agent, setAgent] = useState(wallet ?? '')
  const [ratio, setRatio] = useState(5000)
  const [cap, setCap] = useState(5)
  const [mine, setMine] = useState<MyCopy[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  // the holder's own copies and what each did last, read with the feed token
  const refresh = () => { if (ft) get<MyCopy[]>(`/api/keys/${token}/copy?ft=${encodeURIComponent(ft)}`).then((m) => setMine(Array.isArray(m) ? m : [])).catch(() => {}) }
  useEffect(() => { refresh(); if (!ft) return; const t = setInterval(refresh, 30_000); return () => clearInterval(t) }, [token, ft])   // eslint-disable-line react-hooks/exhaustive-deps
  const loadSwarm = () => withSession(async (session) => {
    const s = await get<SwarmData>(`/api/swarm?session=${encodeURIComponent(session)}`)
    const more = s.agents.filter((a) => a.mine && a.brain === 'set')
    setAgents((x) => [...x, ...more.filter((m) => !x.some((y) => y.account === m.account))]); if (!agent && more[0]) setAgent(more[0].account)
    setMsg(more.length ? null : 'No swarm agent of yours yet.')
  }).catch((e) => setMsg(friendlyError(e)))
  const save = async (r: number, who = agent) => {
    setMsg(null)
    try { await withSession((session) => post(`/api/keys/${token}/copy`, { session, ft, agent: who, ratio_bps: r, max_usd: cap })); setMsg(r ? `Copying at ${r / 100}%, up to $${cap} a trade.` : 'Copy off.'); refresh() } catch (e) { setMsg(friendlyError(e)) }
  }
  return (
    <div className="mk-card">
      <div><div className="mk-name">Copy with your agent</div><div className="mk-sub">Your agent copies each of {name}'s trades at your ratio, up to your cap, inside its NEAR Intents rules. No agent yet? <Link className="mk-link" to="/agents">Set one up on Agents</Link>.</div></div>
      {mine.map((c) => (
        <div key={c.agent}>
          <div className="mk-tr"><span className="v">{c.name || 'Agent'} · {c.ratio_bps / 100}% · up to ${c.max_usd}</span><span>{c.n} copied</span></div>
          {c.last.slice(0, 5).map((l, i) => <div key={i} className="mk-tr"><span>{l.trade} {usdAmt(l.usd)}</span><span className="mk-sub">{l.result} · {timeAgo(l.t)}</span></div>)}
          <button className="mk-btn ghost sm auto" onClick={() => save(0, c.agent)}>Stop</button>
        </div>
      ))}
      {!ft ? <button className="mk-btn ghost" onClick={onBuy}>Buy the key to copy</button>
        : !w.accountId ? <button className="mk-btn" onClick={w.signIn}>Connect NEAR wallet</button>
        : <>
          {agents.length ? <select className="mk-in" value={agent} onChange={(e) => setAgent(e.target.value)}>{agents.map((a) => <option key={a.account} value={a.account}>{a.name}</option>)}</select> : null}
          <div className="mk-btns">
            {!wallet ? <Link to="/agents" className="mk-btn ghost">Make an agent wallet</Link> : null}
            <button className="mk-btn ghost" onClick={loadSwarm}>Use a swarm agent</button>
          </div>
          {agents.length ? <>
            <div className="mk-lbl">Copy size</div>
            <div className="mk-picks">{[1000, 2500, 5000, 10000].map((r) => <button key={r} onClick={() => setRatio(r)} className={`mk-pick ${ratio === r ? 'on' : ''}`}>{r / 100}%</button>)}</div>
            <div className="mk-lbl">Most per trade</div>
            <div className="mk-picks">{[2, 5, 20, 100].map((c) => <button key={c} onClick={() => setCap(c)} className={`mk-pick ${cap === c ? 'on' : ''}`}>${c}</button>)}</div>
            <button className="mk-btn" onClick={() => save(ratio)}>Copy at {ratio / 100}%, up to ${cap}</button>
          </> : null}
        </>}
      <div className="mk-sub">$1 minimum, one copy a minute, never the trader's own coins or new thin coins. The Agent API refuses anything over your wallet's limits.</div>
      {msg ? <div className="mk-note">{msg}</div> : null}
    </div>
  )
}
