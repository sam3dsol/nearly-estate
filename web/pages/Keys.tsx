import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useWallet } from '../lib/wallet'
import { useSocialSession, friendlyError, getSession } from '../lib/social'
import { Page, Avatar, keyName, keyBadges, nearAmt, money, day, Hero, Head, Band, Flow, Show, Log, pnlText, pnlTone, Contract, useTitle, UsersLine } from '../components/Market'
import { CONTRACT, get, post, near, tx, yocto, myKeys, rememberKey, type KeyRow, type SwarmData } from '../lib/keys'
import { view } from '../lib/rpc'
import { notify, askNotify, notifyState } from '../lib/notify'

// the best record first (PnL, then buyers): a key with no record yet sorts after every key that has one
const rec = (k: KeyRow) => k.pnl?.pnl_usd ?? -1e9
// ROI beside PnL, five sorts
type Sort = 'pnl' | 'roi' | 'buyers' | 'price' | 'new'
const SORTS: [Sort, string][] = [['pnl', 'Best PnL'], ['roi', 'Best ROI'], ['buyers', 'Most buyers'], ['price', 'Cheapest'], ['new', 'Newest']]
const roiOf = (k: KeyRow) => k.pnl?.roi ?? null
export const roiText = (r: number | null | undefined) => (r == null ? 'not yet' : `${r > 0 ? '+' : ''}${Math.round(r * 100)}%`)   // the review: a dash read as broken
const by = (s: Sort) => (a: KeyRow, b: KeyRow) => (
  s === 'roi' ? (roiOf(b) ?? -1e9) - (roiOf(a) ?? -1e9) || rec(b) - rec(a)
  : s === 'buyers' ? b.sold - a.sold || rec(b) - rec(a)
  : s === 'price' ? near(a.price) - near(b.price) || rec(b) - rec(a)
  : s === 'new' ? b.created_ms - a.created_ms
  : rec(b) - rec(a) || b.sold - a.sold || b.created_ms - a.created_ms)
type Tab = 'buy' | 'sell'
const tabOf = (): Tab => (typeof location !== 'undefined' && location.hash === '#sell' ? 'sell' : 'buy')

/** /keys: a trader sells viewing keys to their own trades. Each key is a card: the price, what the trader has done, the way in.
 *  Account keys only: a key is a trader's own account, never a coin. The account behind a key is never on the page.
 * Buy and Sell are two tabs.*/
export function Keys() {
  const [rows, setRows] = useState<KeyRow[] | null>(null)
  const [err, setErr] = useState(false)
  const [nearUsd, setNearUsd] = useState<number | null>(null)
  useEffect(() => {
    let on = true
    const load = () => get<KeyRow[]>('/api/keys').then((r) => on && setRows(r)).catch(() => on && setErr(true))
    load(); const t = setInterval(load, 30_000)
    return () => { on = false; clearInterval(t) }
  }, [])
  useEffect(() => { get<{ near_usd?: number }>('/api/stats').then((s) => s.near_usd && setNearUsd(s.near_usd)).catch(() => {}) }, [])
  // the public copy record: counts and a day only (a copy mirrors a confidential trade)
  const [cr, setCr] = useState<{ copies_done: number; copiers: number; last_day: string | null } | null>(null)
  useEffect(() => { get<{ copies_done: number; copiers: number; last_day: string | null }>('/api/keys-copies').then(setCr).catch(() => {}) }, [])
  const [sort, setSort] = useState<Sort>('pnl')
  // coin keys are gone from the product; the filter stays as a guard while the server still lists one
  const keys = useMemo(() => (rows ?? []).filter((k) => !k.coin && k.live && !k.revealed).sort(by(sort)), [rows, sort])
  // a key the seller paused is not for sale: off the table (the seller still finds it on the Sell tab)
  const onSale = useMemo(() => keys.filter((k) => !k.paused), [keys])
  useTitle('Viewing keys')
  // the tabs follow the hash: the hero's two buttons and any #keys / #sell link land on them
  const [tab, setTab] = useState<Tab>(tabOf)
  useEffect(() => {
    const on = () => { setTab(tabOf()); document.getElementById('tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => { if (rows && location.hash) document.getElementById('tabs')?.scrollIntoView() }, [rows])
  const pick = (t: Tab) => { setTab(t); history.replaceState(null, '', t === 'sell' ? '#sell' : '#keys') }
  // keys unlocked in this browser (7178321377-hot: "I couldn't find which key I had bought"), and the keys the
  // connected wallet bought on chain: has_key per key on sale, so a second device shows the same list
  const w0 = useWallet()
  const [bought, setBought] = useState<string[]>([])
  useEffect(() => {
    const a = w0.accountId; if (!a || !rows) { setBought([]); return }
    let on = true
    Promise.all(rows.filter((k) => !k.coin && !k.revealed && k.token !== a).map((k) => view<boolean>(CONTRACT, 'has_key', { key: String(k.id), account: a }).then((yes) => (yes ? k.token : null)).catch(() => null)))
      .then((l) => { if (!on) return; const got = l.filter((t): t is string => !!t); setBought(got); got.forEach(rememberKey) })
    return () => { on = false }
  }, [w0.accountId, rows])
  const mine = useMemo(() => [...new Set([...bought, ...myKeys()])].filter((t) => onSale.some((k) => k.token === t)), [onSale, bought])
  const sold = keys.reduce((n, k) => n + k.sold, 0)
  const best = onSale.reduce<number | null>((m, k) => (k.pnl?.pnl_usd != null && (m == null || k.pnl.pnl_usd > m) ? k.pnl.pnl_usd : m), null)
  return (
    <Page>
      <Hero compact art="keys" eyebrow="Viewing keys" title={'Private trading.\nPublic PnL.'} sub="Trade in private. Sell viewing keys so your holders can follow and copy you." actions={[{ label: 'Buy a key', href: '#keys' }, { label: 'Sell your key', href: '#sell' }, { label: 'Read the guide', href: '/docs#keys' }]} />
      {/* the band shows at once; "–" until the keys load */}
      {!err ? <Band live={<>Live on NEAR mainnet · <Contract /></>} right={<UsersLine product="keys" />} items={[
        { v: rows ? onSale.length : '–', k: 'Keys listed' },
        // the coin key (key 1, a launch's holders key) is not a trader's key: the count says so, and matches the chain less that one
        { v: rows ? sold : '–', k: 'Holders' },
        { v: cr?.copies_done ?? '–', k: 'Trades copied', sub: cr?.last_day ? `last on ${day(Date.parse(cr.last_day))}` : undefined },
        { v: rows ? pnlText(best) : '–', k: 'Best key PnL', tone: pnlTone(best) },
      ]} /> : <div className="mk-card mk-after"><div className="mk-note">Could not reach the keys server.</div></div>}
      {/* users line folded into the band */}
      <Flow steps={[
        { t: 'Sell your key', d: 'Your account names it. The wallet you trade from stays hidden.' },
        { t: 'Buy a key', d: 'Paid to the trader on chain. The PnL is public first.' },
        { t: 'See every trade', d: 'Live, confidential NEAR Intents swaps included.' },
        { t: 'Copy within limits', d: 'Your agent copies at your ratio, inside its own rules.' },
      ]} />
      <Show tag="Proven on mainnet · a copied trade" title="An AI trader swapped in private. A key holder's agent copied it." right={<span className="mk-when">The first one: Nov 11, 09:42 UTC</span>}>
        {/* the proof as one quiet ledger, not four bubbles */}
        <Log cols="170px 250px minmax(0, 1fr)" colsSm="1fr 1.4fr" keep={[0, 1]} head={['Who', 'Swap', 'What happened']} rows={[
          { key: 'trader', cells: ["Trader's agent", <span className="mono">0.56 wNEAR → 2.00 USDC</span>, 'A confidential swap on NEAR Intents. Key holders see it, nobody else.'] },
          { key: 'copy', cells: ["Key holder's agent", <span className="mono">0.216 wNEAR → USDC, about $0.77</span>, 'Copied within its $2 a trade rule, checked by the Agent API; 0.216 wNEAR was all it held.'] },
        ]} />
        <div className="mk-sub">Both swaps settled on NEAR Intents' confidential shard: no public explorer shows them.<span className="hash">The copy's intent hash: HzqXi5M7uo6mCPNEND5LmbkVMsDngdCdvh9AzxrwBr6o</span></div>
      </Show>
      <section id="tabs" className="mk-sec scroll-mt-24">
        <div className="mk-row flex-wrap">
          <div className="mk-tabs" role="tablist" aria-label="Buy or sell">
            <button role="tab" aria-selected={tab === 'buy'} className={tab === 'buy' ? 'on' : ''} onClick={() => pick('buy')}>Buy a key</button>
            <button role="tab" aria-selected={tab === 'sell'} className={tab === 'sell' ? 'on' : ''} onClick={() => pick('sell')}>Sell your key</button>
          </div>
          {tab === 'buy' && onSale.length > 1 ? <div style={{ marginLeft: 'auto', width: 170 }}><select className="mk-in" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort traders">{SORTS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></div> : null}
        </div>
        {tab === 'buy' ? <div id="keys" className="mk-stack">
          <Head title="Traders" sub="The PnL is public, rounded to $10; trade counts are ranges. Exact numbers would match a key to a wallet. Key holders see every trade and the PnL line over time." />
          {mine.length ? <div className="mk-row flex-wrap"><span className="mk-sub">{w0.accountId ? 'Your keys:' : 'Your keys, unlocked in this browser:'}</span>{mine.map((t) => <Link key={t} to={`/keys/${t}`} className="mk-chip">{t}</Link>)}</div> : null}
          {onSale.length ? <Log cols="minmax(0, 1.5fr) 160px 100px 90px 110px 80px 90px" colsSm="minmax(0, 1fr) 92px 84px" keep={[0, 2, 3]} head={['Trader', 'Key', 'PnL', 'ROI', 'Trades', 'Buyers', 'Copying']} rows={onSale.map((k) => ({
            key: k.token, to: `/keys/${k.token}`,
            cells: [
              <span className="flex items-center gap-3 min-w-0"><Avatar icon={k.icon} name={keyName(k)} size="sm" /><span className="truncate">{keyName(k)}</span>{keyBadges(k).map((b) => <span key={b} className="mk-chip hide-sm">{b}</span>)}</span>,
              <span className="num">{nearAmt(near(k.price))}{nearUsd ? <span className="dim"> · {money(near(k.price) * nearUsd)}</span> : null}</span>,
              <span className={`num ${pnlTone(k.pnl?.pnl_usd) === 'pos' ? 'text-[var(--mk-jade-t)]' : pnlTone(k.pnl?.pnl_usd) === 'neg' ? 'text-[var(--mk-red)]' : 'dim'}`}>{pnlText(k.pnl?.pnl_usd)}</span>,
              <span className={`num ${(roiOf(k) ?? 0) > 0 ? 'text-[var(--mk-jade-t)]' : (roiOf(k) ?? 0) < 0 ? 'text-[var(--mk-red)]' : 'dim'}`}>{roiText(roiOf(k))}</span>,
              <span className="num dim">{k.stats?.trades_label ?? 'under 10'}</span>,
              <span className="num">{k.sold}</span>,
              <span className="num">{k.copying ?? 0}</span>,
            ],
          }))} /> : !rows && !err ? <div className="mk-card skel short" /> : <div className="mk-note">No key is on sale right now.</div>}
        </div> : <div className="mk-grid">
          <SellKey span={2} keys={keys} nearUsd={nearUsd} />
          <div className="mk-card">
            <div className="mk-name">What buyers see</div>
            <div>
              <div className="mk-tr"><span>Key name</span><span className="v">your account</span></div>
              <div className="mk-tr"><span>PnL</span><span className="v">public, to the nearest $10</span></div>
              <div className="mk-tr"><span>Every trade, live</span><span className="v">key holders only</span></div>
              <div className="mk-tr"><span>Wallet you trade from</span><span className="v">never shown</span></div>
              <div className="mk-tr"><span>Price</span><span className="v">paid to you, on chain</span></div>
            </div>
          </div>
        </div>}
      </section>
    </Page>
  )
}

/**
 * Selling a key. Two accounts:
 *   the connected account (A): buyers see it and pay it; the key is listed under it
 *   the wallet you trade from (B): never shown. The seller proves it is theirs by signing with it, so the form walks the
 *   switch: on A "1. Add the wallet you trade from" (A is remembered) -> connect B, "Sign as B" -> "Reconnect A" -> on A
 *   "2. Start selling". The signed message names A's key, so the proof is good for A only. A swarm agent of yours needs no signature.
 * the switch is explained before it starts, reconnecting the
 *   same account says so in plain words instead of looping, the price field shows what keys sell for, and an account that
 *   already sells a key sees its listing (price change, its page) instead of the empty form.
 */
type Proof = { accountId: string; publicKey: string; signature: string; message: string; nonce: string }
const keep = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* private window */ } }
const kept = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
function SellKey({ span, keys, nearUsd }: { span: number; keys: KeyRow[]; nearUsd: number | null }) {
  const w = useWallet()
  const { withSession } = useSocialSession('Make a key on nearly.trade')
  const [price, setPrice] = useState('0.1')
  const [proof, setProof] = useState<Proof | null>(() => { try { return JSON.parse(kept('nearly-key-proof') || 'null') } catch { return null } })
  const [seller, setSeller] = useState(() => kept('nearly-key-seller') || '')
  const [agent, setAgent] = useState('')
  const [agents, setAgents] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // which swarm agents are yours is private: it needs a signed session, asked for on the click
  const loadMine = () => withSession(async (session) => { const s = await get<SwarmData>(`/api/swarm?session=${encodeURIComponent(session)}`); setAgents(s.agents.filter((a) => a.mine).map((a) => a.account)) }).catch((e) => setMsg(friendlyError(e)))
  const me = (w.accountId || '').toLowerCase()
  const name = seller || me                               // the account the key is listed under
  const onB = !!seller && !!me && me !== seller           // mid switch: connected as the wallet you trade from
  const coin = /\.nearlytrade\.near$/.test(name)
  const signed = proof && proof.accountId !== name && proof.message.includes(`key ${name}\n`) ? proof.accountId : ''
  const trading = agent || signed
  const sameAgain = !!seller && !!me && me === seller && !trading   // came back from the switch with the same account
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
  const why = (e: unknown) => { const m = friendlyError(e); return /must sign the message/.test(m) ? 'Add the wallet you trade from first.' : /already has a key/.test(m) ? `${name} already sells a key.` : /must differ/.test(m) ? `That is ${seller || 'the account you sell from'}. Connect the wallet you trade from.` : m }
  // what keys sell for today, beside the price field (samanthalewis: "0.5 by default while the keys listed cost 0.01 and 0.1")
  const prices = keys.map((k) => near(k.price)).filter((p) => p > 0).sort((a, b) => a - b)
  const range = prices.length ? (prices[0] === prices[prices.length - 1] ? `Keys on sale now: ${nearAmt(prices[0])}` : `Keys on sale now: ${nearAmt(prices[0])} to ${nearAmt(prices[prices.length - 1])}`) : null
  const usd = nearUsd && Number(price) > 0 ? ` (${money(Number(price) * nearUsd)})` : ''
  const mineKey = me ? keys.find((k) => k.token === me) ?? null : null
  const [newPrice, setNewPrice] = useState('')
  // alerts: the list refreshes every 30 s; a higher buyer count is a sale
  const [, bump] = useState(0)
  const soldRef = useRef<number | null>(null)
  useEffect(() => {
    if (!mineKey) return
    if (soldRef.current != null && mineKey.sold > soldRef.current) notify('Your key sold', `${mineKey.sold} ${mineKey.sold === 1 ? 'buyer' : 'buyers'} now · ${nearAmt(near(mineKey.price))} each`, '/keys#sell')
    soldRef.current = mineKey.sold
  }, [mineKey?.sold])   // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = notifyState()
  // Telegram alert when the key sells: the same @NearlyBuyBot link as /messages; the box's
  // nearly-keyalerts watcher sends the message. Status is read only when this browser already holds a session (no surprise signature).
  const [tg, setTg] = useState<boolean | null>(null)
  const [tgWait, setTgWait] = useState(false)
  const tgStatus = () => withSession((s) => post<{ linked: boolean }>('/api/dm/tg', { session: s })).then((r) => { setTg(r.linked); return r.linked })
  useEffect(() => { if (mineKey && me && getSession(me)) tgStatus().catch(() => {}) }, [me, !!mineKey])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tgWait) return
    const t = setInterval(() => tgStatus().then((l) => { if (l) setTgWait(false) }).catch(() => {}), 4000), end = setTimeout(() => setTgWait(false), 180e3)
    return () => { clearInterval(t); clearTimeout(end) }
  }, [tgWait])   // eslint-disable-line react-hooks/exhaustive-deps
  const tgLink = async () => {
    const w = window.open('about:blank', '_blank')   // opened inside the tap, so popup blockers let it through
    try { const r = await withSession((s) => post<{ url: string }>('/api/dm/tg', { session: s, action: 'link' })); if (w) w.location.href = r.url; else location.href = r.url; setTgWait(true) } catch (e) { w?.close(); setMsg(why(e)) }
  }

  const switchTo = async (s: string) => { setMsg(null); setSeller(s); keep('nearly-key-seller', s); await w.signOut(); w.signIn() }
  const startOver = () => { setSeller(''); setProof(null); setAgent(''); keep('nearly-key-seller', null); keep('nearly-key-proof', null); setMsg(null) }
  const signProof = async () => {
    setBusy(true); setMsg(null)
    try {
      const nonce = crypto.getRandomValues(new Uint8Array(32))
      const message = `nearly.trade\nMy trades behind key ${seller}\nAccount: ${me}\nIssued: ${new Date().toISOString()}`
      const s = await w.signMessage({ message, recipient: 'nearly.trade', nonce })
      if (s.accountId.toLowerCase() === seller) throw new Error(`That is ${seller}. Connect the wallet you trade from.`)
      const p = { ...s, message, nonce: b64(nonce) }
      setProof(p); keep('nearly-key-proof', JSON.stringify(p))
    } catch (e) { setMsg(why(e)) } finally { setBusy(false) }
  }
  const register = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await withSession((session) => post<{ commitment: string; salt: string }>('/api/keys/prepare', { token: me, hidden: trading, session, proof: agent ? null : proof }))
      await w.send([tx.registerKey(me, r.commitment, '0', yocto(Number(price) || 0))])
      setMsg(`You're selling. Your key shows here within a minute. Save this code, it lets you retire the key on chain yourself: ${r.salt}`)
      setSeller(''); setProof(null); keep('nearly-key-seller', null); keep('nearly-key-proof', null)
    } catch (e) { setMsg(why(e)) } finally { setBusy(false) }
  }
  // pause the listing (lovelysugar, congos: "no way to stop selling"): a server flag; the key stays on chain, holders keep access.
  // The button shows once the server carries the flag (it answers paused: false), so nobody meets a 404 before then.
  const setPaused = async (paused: boolean) => {
    setBusy(true); setMsg(null)
    try { await withSession((session) => post(`/api/keys/${me}/pause`, { session, paused })); setMsg(paused ? 'Paused. Buyers no longer see your key; holders keep their access. Resume any time.' : 'Back on sale.') } catch (e) { setMsg(why(e)) } finally { setBusy(false) }
  }
  const changePrice = async () => {
    if (!mineKey || !(Number(newPrice) > 0)) return
    setBusy(true); setMsg(null)
    try { await w.send([tx.setPrice(mineKey.id, yocto(Number(newPrice)))]); setMsg(`Price changed to ${nearAmt(Number(newPrice))}. The list shows it within a minute.`); setNewPrice('') } catch (e) { setMsg(why(e)) } finally { setBusy(false) }
  }
  const ready = !!me && !onB && !coin && !!trading && Number(price) > 0
  const cls = `mk-card dash scroll-mt-24 ${span === 2 ? 'span2' : span === 3 ? 'span3' : ''}`
  const head = <div><div className="mk-name">Sell your viewing key</div><div className="mk-sub">People pay you to see your trades. They never see the wallet you trade from.</div></div>
  const foot = <>{seller ? <button className="mk-mute-link self-start" onClick={startOver}>Start over</button> : null}{msg ? <div className="mk-note">{msg}</div> : null}</>

  // this account already sells a key: its listing, not the empty form (congos: "my key was in the marketplace but the form still said Not added yet")
  if (mineKey && !seller) return (
    <div id="sell" className={cls}>
      {head}
      <div className="mk-row"><Avatar icon={mineKey.icon} name={keyName(mineKey)} size="lg" /><div className="min-w-0"><div className="mk-name lg">{keyName(mineKey)}</div><div className="mk-sub">{mineKey.paused ? 'Paused' : "You're selling"} · since {day(mineKey.created_ms)}</div></div><span className={`mk-pill end ${mineKey.paused ? '' : 'ok'}`}>{mineKey.paused ? 'Paused' : 'On sale'}</span></div>
      <div>
        <div className="mk-tr"><span>Price</span><span className="v">{nearAmt(near(mineKey.price))}{nearUsd ? ` · ${money(near(mineKey.price) * nearUsd)}` : ''}</span></div>
        <div className="mk-tr"><span>Buyers</span><span className="v">{mineKey.sold}</span></div>
        <div className="mk-tr"><span>Agents copying</span><span className="v">{mineKey.copying ?? 0}</span></div>
        <div className="mk-tr"><span>Public PnL</span><span className="v">{pnlText(mineKey.pnl?.pnl_usd)}</span></div>
      </div>
      <div className="mk-field"><label>Change the price</label><div className="flex flex-wrap gap-2"><div className="mk-affix" style={{ width: 180 }}><input className="mk-in" inputMode="decimal" placeholder={String(near(mineKey.price))} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} /><span className="suf">NEAR</span></div><button className="mk-btn auto ghost" disabled={busy || !(Number(newPrice) > 0)} onClick={changePrice}>Set the new price</button></div></div>
      <div className="flex flex-wrap gap-2"><Link to={`/keys/${me}`} className="mk-btn auto">Open your key page</Link>{mineKey.paused !== undefined ? <button className="mk-btn ghost auto" disabled={busy} onClick={() => setPaused(!mineKey.paused)}>{mineKey.paused ? 'Resume selling' : 'Pause selling'}</button> : null}</div>
      <div className="flex flex-wrap items-center gap-2">{tg ? <span className="mk-sub">Telegram alerts on: a message when your key sells. Turn off on /messages.</span> : <button className="mk-btn ghost auto" disabled={busy} onClick={tgLink}>Telegram alert when it sells</button>}{tgWait ? <span className="mk-sub">press Start in Telegram…</span> : null}</div>
      {alerts === 'default' ? <button className="mk-mute-link self-start" disabled={busy} onClick={() => askNotify().then(() => bump((n) => n + 1))}>Alert me when it sells</button> : alerts === 'granted' ? <div className="mk-sub">Alerts on: a sale shows here, and as a notification while a nearly.trade tab is open.</div> : null}
      <div className="mk-sub">{mineKey.paused !== undefined ? 'Paused, the key leaves the list and its page says so; holders keep their access. ' : ''}Retiring a key for good is done on chain with the code you saved when you started; it reveals the wallet you trade from.</div>
      {foot}
    </div>
  )

  // partway through adding the wallet you trade from
  if (seller && (onB || !me)) return (
    <div id="sell" className={cls}>
      {head}
      {!me ? <>
        <div className="mk-text">{signed ? <>Done. Reconnect <b>{seller}</b> to start selling.</> : <>Connect the wallet you trade from. It has to be a <b>different account</b> from {seller}.</>}</div>
        <div className="flex flex-wrap gap-2"><button className="mk-btn auto" onClick={w.signIn}>{signed ? `Reconnect ${seller}` : 'Connect the wallet you trade from'}</button></div>
        {!signed ? <div className="mk-sub">In the wallet, pick the other account (or add one), then come back here.</div> : null}
      </> : signed === me ? <>
        <div className="mk-text">Done. Reconnect <b>{seller}</b> to start selling.</div>
        <div className="flex flex-wrap gap-2"><button className="mk-btn auto" onClick={() => switchTo(seller)}>Reconnect {seller}</button></div>
      </> : <>
        <div className="mk-text">Now connected as <b>{me}</b>. Sign to prove it's yours.</div>
        <div className="flex flex-wrap gap-2"><button className="mk-btn auto" disabled={busy} onClick={signProof}>Sign as {me}</button></div>
        <div className="mk-sub">Free. Nothing is sent. After this you reconnect {seller} and start selling.</div>
      </>}
      {foot}
    </div>
  )
  return (
    <div id="sell" className={cls}>
      {head}
      {!me ? <div className="flex flex-wrap gap-2"><button className="mk-btn auto" onClick={w.signIn}>Connect wallet</button></div> : <>
        {sameAgain ? <div className="mk-err">That is <b>{seller}</b> again, the account buyers will pay. The wallet you trade from has to be a different account: in your wallet, switch to (or create) the other account, then tap the button below once more.</div> : null}
        <div className="mk-fields" style={{ ['--cols' as string]: span > 1 ? 2 : 1 }}>
          <div className="mk-field">
            <label>Wallet you trade from <span className="mk-chip" title="Never shown to anyone. Buyers see and pay the account you are connected with.">Private</span></label>
            <div className="mk-q">{trading || 'Not added yet'}</div>
            <div className="mk-sub">Never shown. Buyers see and pay <b>{me}</b>.</div>
            {agents == null ? <button type="button" className="mk-btn ghost sm auto self-start" onClick={loadMine}>Or use one of my AI agents</button>
              : agents.length ? <select className="mk-in" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Pick an agent</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select>
              : <div className="mk-sub">You have no AI agents yet. <Link className="mk-link" to="/agents">Make one</Link>, or add a wallet below.</div>}
          </div>
          <div className="mk-field"><label>Price</label><div className="mk-affix"><input className="mk-in" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /><span className="suf">NEAR</span></div><div className="mk-sub">Each buyer pays once{usd}.{range ? ` ${range}.` : ''}</div></div>
        </div>
        {coin ? <div className="mk-err">Connect your own account, not a coin's.</div> : null}
        {!trading && !sameAgain ? <ol className="mk-steps">
          <li>Connect the wallet you trade from: a <b>different account</b> from {me}. {me} is disconnected for a moment and remembered.</li>
          <li>Sign once with that wallet. Free, nothing is sent.</li>
          <li>Reconnect {me} and start selling. Buyers pay {me}; the other wallet is never shown.</li>
        </ol> : null}
        <div className="flex flex-wrap gap-2">
          {!agent ? <button className={`mk-btn auto ${trading ? 'ghost' : ''}`} disabled={busy || coin} onClick={() => switchTo(me)}>{trading ? 'Change wallet' : sameAgain ? 'Add the wallet you trade from, again' : '1. Add the wallet you trade from'}</button> : null}
          <button className={`mk-btn auto ${trading ? '' : 'ghost'}`} disabled={busy || !ready} onClick={register} title={ready ? undefined : 'Unlocks after step 1'}>{agent ? 'Start selling' : '2. Start selling'}</button>
        </div>
        <div className="mk-sub">{trading ? `Buyers pay ${me}. Starting costs 0.02 NEAR for storage.` : 'Step 2 unlocks after step 1.'}</div>
      </>}
      {foot}
    </div>
  )
}
