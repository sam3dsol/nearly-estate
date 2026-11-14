import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useWallet } from '../lib/wallet'
import { friendlyError } from '../lib/social'
import { timeAgo } from '../lib/format'
import { get, tx } from '../lib/keys'
import { hashOf } from '../lib/pool'
import '../wiki-claim.css'
import { words, pct, txLink } from './Wiki'
import { Shell } from './WikiPress'
import { Top } from './WikiGrid'

/** Hire an AI agent to trade the wiki. The NEAR stays in the contract in the agent's own
 *  balance; our server may only buy for it, within the caps the owner set, and the contract checks every buy; the shares land
 *  in the owner's wallet; the owner closes it any time and the rest comes back. /wiki/hire */

type View = { market: number; claim: string; p: number; price: number; note: string; at: number; trade?: { side: 'yes' | 'no'; near: number; tx: string } | null }
/** a desk as the server shapes it: amounts in NEAR, today's spend already reset at UTC midnight, its latest views */
type Hired = { id: number; owner: string; name: string; style: string; open: boolean; created_ms: number; trades: number; balance_near: number; max_trade_near: number; daily_near: number; spent_today_near: number; spent_near: number; views?: View[] }
const STYLES: [string, string][] = [
  ['Careful', 'Trust the encyclopedia and expert consensus. Bet only when the page and the sources clearly agree, and size small when unsure.'],
  ['Contrarian', 'Look for claims the crowd prices too high or too low. Bet against hype and viral stories when the evidence is thin.'],
  ['Base rates', 'Start from how often claims like this turn out true, then move only as far as the evidence pushes. Avoid extremes.'],
  ['Crypto data', 'Prefer markets settled by on-chain numbers. Read the live reading and the trend, and bet on what the data says will happen.'],
]

export function WikiHire() {
  const w = useWallet()
  const [all, setAll] = useState<Hired[] | null>(null)
  const [mine, setMine] = useState<Hired[]>([])
  const [name, setName] = useState('')
  const [style, setStyle] = useState(STYLES[0][1])
  const [maxT, setMaxT] = useState('0.05')
  const [daily, setDaily] = useState('0.25')
  const [dep, setDep] = useState('1')
  const [msg, setMsg] = useState<string | null>(null)
  const [txh, setTxh] = useState<string | null>(null)
  const load = () => {
    get<{ desks: Hired[] | null }>('/api/wiki/hire').then((x) => setAll(x.desks ?? [])).catch(() => setAll([]))
    if (w.accountId) get<{ desks: Hired[] | null }>(`/api/wiki/hire/of/${w.accountId}`).then((x) => setMine(x.desks ?? [])).catch(() => setMine([]))
  }
  useEffect(load, [w.accountId]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (t: ReturnType<typeof tx.hireDesk>, ok: string) => {
    setMsg(null); setTxh(null)
    try { const res = await w.send([t]); setMsg(ok); setTxh(hashOf(res) ?? null); setTimeout(load, 4000) } catch (e) { setMsg(friendlyError(e)) }
  }
  const m = Number(maxT), d = Number(daily), dp = Number(dep)
  const bad = !name.trim() ? 'Give it a name.' : name.length > 40 ? 'Names are 40 characters at most.' : !style.trim() ? 'Tell it how to trade.'
    : !(m >= 0.01 && m <= 1) ? 'Per trade: 0.01 to 1 NEAR.' : !(d >= m && d <= 5) ? 'Per day: at least the per-trade cap, at most 5 NEAR.' : !(dp >= 0.5) ? 'The smallest deposit is 0.5 NEAR.' : null
  return (
    <Shell>
      <Top />
      <div className="wh">
        <div className="wh-intro">
          <h1 className="wc-q">Hire an AI agent</h1>
          <p>It reads the claims, says how likely each one is, bets when the market is wrong, and sells when its view turns against what it holds. Its NEAR stays in the contract, which checks every trade against your caps, and it pays for its own AI calls from that NEAR (at most 0.05 a day). The shares go to your wallet, and you can close it any time to take the rest back.</p>
        </div>
        <div className="wh-grid">
          <section className="wc-box wh-form">
            <label className="mk-lbl">Name</label>
            <input className="mk-in" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Owl" />
            <label className="mk-lbl">How it trades</label>
            <div className="wk-chips txt">{STYLES.map(([k, v]) => <button key={k} className={style === v ? 'on' : ''} onClick={() => setStyle(v)}>{k}</button>)}</div>
            <textarea className="mk-in" rows={4} maxLength={400} value={style} onChange={(e) => setStyle(e.target.value)} />
            <div className="wh-row">
              <div><label className="mk-lbl">Most per trade</label><div className="mk-affix"><input className="mk-in" inputMode="decimal" value={maxT} onChange={(e) => setMaxT(e.target.value)} /><span className="suf">NEAR</span></div></div>
              <div><label className="mk-lbl">Most per day</label><div className="mk-affix"><input className="mk-in" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} /><span className="suf">NEAR</span></div></div>
            </div>
            <label className="mk-lbl">Deposit</label>
            <div className="mk-affix"><input className="mk-in" inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} /><span className="suf">NEAR</span></div>
            <div className="wk-chips">{['0.5', '1', '2', '5'].map((v) => <button key={v} className={dep === v ? 'on' : ''} onClick={() => setDep(v)}>{v}</button>)}</div>
            {/* the figures, then the reason */}
            <div className="mk-sub">Deposit {dep || '…'} NEAR. Up to {maxT || '…'} NEAR a trade and {daily || '…'} a day. AI calls cost it up to 0.05 NEAR a day. Close it any time and the rest comes back.</div>
            {bad ? <div className={name ? 'mk-err' : 'mk-sub'}>{bad}</div> : null}
            <button className="mk-btn" disabled={!!w.accountId && !!bad} onClick={() => (w.accountId ? send(tx.hireDesk(dp, name.trim(), style.trim(), m, d), `${name.trim()} is hired. It starts on the next round.`) : w.signIn())}>{w.accountId ? `Hire it for ${dep} NEAR` : 'Connect wallet to hire'}</button>
            {msg ? <div className="mk-note">{msg}{txh ? <> <a className="mk-link" href={txLink(txh)} target="_blank" rel="noreferrer">View tx</a></> : null}</div> : null}
          </section>
          <section className="wh-side">
            {w.accountId ? <div className="wc-box">
              <div className="mk-lbl">Your agents</div>
              {!mine.length ? <div className="mk-sub">None yet.</div> : mine.map((x) => (
                <div key={x.id} className="wh-mine">
                  <div className="l1"><b>{x.name}</b><span className={x.open ? 'on' : 'off'}>{x.open ? 'working' : 'closed'}</span></div>
                  <div className="mk-sub mk-mono">{x.balance_near.toFixed(3)} NEAR left · {x.spent_today_near.toFixed(3)} of {x.daily_near.toFixed(2)} today · {x.trades} trades</div>
                  {x.open ? <div className="mk-btns">
                    <button className="mk-btn ghost sm" onClick={() => send(tx.fundDesk(x.id, 0.5), 'Added 0.5 NEAR.')}>Add 0.5 NEAR</button>
                    <button className="mk-btn ghost sm" onClick={() => send(tx.closeDesk(x.id), `${x.name} is closed. ${x.balance_near.toFixed(3)} NEAR is on its way back.`)}>Close and take {x.balance_near.toFixed(3)} back</button>
                  </div> : null}
                </div>
              ))}
            </div> : null}
            <div className="wc-box">
              <div className="mk-lbl">Agents at work</div>
              {all == null ? <div className="mk-sub">Loading…</div> : !all.length ? <div className="mk-sub">Nobody has hired one yet. Be the first.</div> : all.slice(0, 12).map((x) => (
                <div key={x.id} className="wh-agent">
                  <div className="l1"><b>{x.name}</b><span className="mono">{x.trades} trades · {x.spent_near.toFixed(2)} NEAR bet</span></div>
                  <div className="mk-sub">“{x.style.length > 120 ? `${x.style.slice(0, 120)}…` : x.style}”</div>
                  {(x.views ?? []).slice(0, 2).map((v) => { const wd = words(v.claim); return (
                    <Link key={`${v.market}-${v.at}`} to={`/wiki/m/${v.market}`} className="wh-view">
                      <span>{v.trade ? <>bought <em className={v.trade.side}>{v.trade.side === 'yes' ? wd.yes : wd.no}</em> {v.trade.near.toFixed(3)} NEAR</> : <>says {pct(v.p)}</>} · {timeAgo(v.at)} ago</span>
                      <span className="q">{wd.title}</span>
                    </Link>
                  ) })}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  )
}
