import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useWallet } from '../lib/wallet'
import { friendlyError } from '../lib/social'
import { get, post, tx } from '../lib/keys'
import { hashOf } from '../lib/pool'
import '../wiki-claim.css'
import { type Home, txLink } from './Wiki'
import { Shell } from './WikiPress'
import { Top } from './WikiGrid'

/** Anyone opens a market: a Yes or No question on a topic page (one we have, or
 *  any Wikipedia topic, written now), open-ended or with an end date, seeded with the creator's own NEAR. The contract opens it,
 *  the AI agents price it, the judge rules it; it gets its own page at once. /wiki/new */

type Hit = { title: string; slug: string; description: string; have: boolean }
const SEEDS = ['0.1', '0.5', '1', '2']
/** the market id the contract logged ("market 301 created"), read from the transaction's outcome */
const createdId = (res: unknown) => { const m = /market (\d+) created/.exec(JSON.stringify(res ?? '')); return m ? Number(m[1]) : null }

export function WikiCreate() {
  const w = useWallet()
  const nav = useNavigate()
  const [h, setH] = useState<Home | null>(null)
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState<{ key: string; slug: string; title: string } | null>(null)
  const [find, setFind] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [dated, setDated] = useState(true)
  const [when, setWhen] = useState(() => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10))
  const [seed, setSeed] = useState('0.5')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [txh, setTxh] = useState<string | null>(null)
  useEffect(() => { get<Home>('/api/wiki/home').then(setH).catch(() => {}) }, [])
  useEffect(() => {
    const s = find.trim(); if (s.length < 2) { setHits([]); return }
    let on = true; const t = setTimeout(() => { get<Hit[]>(`/api/wiki/search?q=${encodeURIComponent(s)}`).then((x) => on && setHits(x.slice(0, 6))).catch(() => {}) }, 220)
    return () => { on = false; clearTimeout(t) }
  }, [find])
  const topics = useMemo(() => (h?.pages ?? []).filter((p) => p.kind === 'topic').sort((a, b) => a.title.localeCompare(b.title)), [h])
  // a topic we do not have yet gets its page written first (from its Wikipedia article), then the market goes on it
  const pick = async (x: Hit) => {
    setMsg(null)
    if (x.have) { setTopic({ key: `${x.slug}.topic`, slug: x.slug, title: x.title }); setFind(''); setHits([]); return }
    setBusy('page')
    try { const r = await post<{ slug: string; page: { key: string; title: string } }>('/api/wiki/new', { q: x.title }); setTopic({ key: r.page.key, slug: r.slug, title: r.page.title }); setFind(''); setHits([]) }
    catch (e) { setMsg(friendlyError(e)) } finally { setBusy(null) }
  }
  const endMs = dated ? Date.parse(`${when}T23:59:00Z`) : null
  const sd = Number(seed)
  // words, not digits; no repeats
  const qt = q.trim(), half = qt.length >> 1
  const repeats = half >= 8 && qt.slice(0, half).trim().replace(/[?.!]+$/, '') === qt.slice(half).trim().replace(/[?.!]+$/, '')
  const bad = !qt ? 'Write the question to continue.' : qt.length < 12 ? `At least 12 characters (${qt.length} so far).` : q.length > 300 ? 'Questions are 300 characters at most.' : /[\r\n\t]/.test(q) ? 'One line, please.'
    : !/[a-z\u00C0-\u024F]{3,}[^a-z\u00C0-\u024F]+[a-z\u00C0-\u024F]{2,}/i.test(qt) ? 'Write it in words: a claim anyone can check, like "Will BTC close above $100,000 on Dec 31?".' : repeats ? 'The question repeats itself. Say it once.'
    : !topic ? 'Pick the topic it belongs to.' : dated && !(endMs! > Date.now() + 36e5) ? 'The end date must be in the future.' : !(sd >= 0.1) ? 'The smallest seed is 0.1 NEAR.' : null
  const create = async () => {
    if (!w.accountId) return w.signIn()
    if (bad || !topic) return
    setBusy('tx'); setMsg(null); setTxh(null)
    try {
      const res = await w.send([tx.createMarket(sd, q.trim(), topic.key, endMs)])
      const id = createdId(res)
      setTxh(hashOf(res) ?? null)
      if (id) nav(`/wiki/m/${id}`); else setMsg('Created. It shows on the topic page in a moment.')
    } catch (e) { setMsg(friendlyError(e)) } finally { setBusy(null) }
  }
  return (
    <Shell>
      <Top />
      <div className="wh">
        <div className="wh-intro">
          <h1 className="wc-q">Create a market</h1>
          <p>Ask one Yes or No question. Your NEAR seeds it; the AI agents price it within minutes, anyone can trade it, and three AI judges rule it from its sources.</p>
        </div>
        <div className="wh-grid">
          <section className="wc-box wh-form">
            <label className="mk-lbl">Question <span className="mk-sub">12 to 300 characters, one line; a question mark is optional</span></label>
            <textarea className="mk-in" rows={3} maxLength={300} value={q} onChange={(e) => setQ(e.target.value.replace(/[\r\n\t]+/g, ' '))} placeholder="Will Bitcoin close above $100,000 on Dec 31?" />
            <div className="mk-sub" style={{ marginTop: -6 }}>{q.length}/300</div>
            <label className="mk-lbl">Topic</label>
            {topic ? <div className="wn-topic"><b>{topic.title}</b><button className="mk-mute-link" onClick={() => setTopic(null)}>change</button></div> : <>
              <input className="mk-in" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search any topic" />
              {hits.length ? <div className="wn-hits">{hits.map((x) => <button key={x.slug} disabled={!!busy} onClick={() => pick(x)}><span>{x.title}</span><i>{busy === 'page' ? 'writing…' : x.have ? 'pick' : 'write it'}</i></button>)}</div>
                : null}
              {busy === 'page' ? <div className="mk-sub">Writing the page from its Wikipedia article. This takes about a minute; the topic appears here when it is done.</div> : null}
              {!busy && msg && !topic ? <div className="mk-err">{msg}</div> : null}
              {hits.length ? null
                : <div className="wk-chips txt">{topics.slice(0, 40).map((p) => <button key={p.slug} onClick={() => setTopic({ key: p.key, slug: p.slug, title: p.title })}>{p.title}</button>)}</div>}
            </>}
            <label className="mk-lbl">Ends</label>
            <div className="wk-chips txt"><button className={!dated ? 'on' : ''} onClick={() => setDated(false)}>No end date</button><button className={dated ? 'on' : ''} onClick={() => setDated(true)}>On a date</button></div>
            {dated ? <input className="mk-in" type="date" value={when} min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)} onChange={(e) => setWhen(e.target.value)} /> : <div className="mk-sub">It trades until someone asks the judges to rule. Anyone can ask, on the market's page, for free; a ruling can be challenged for 24 hours with a 1 NEAR bond.</div>}
            <label className="mk-lbl">Seed</label>
            <div className="mk-affix"><input className="mk-in" inputMode="decimal" value={seed} onChange={(e) => setSeed(e.target.value)} /><span className="suf">NEAR</span></div>
            <div className="wk-chips">{SEEDS.map((v) => <button key={v} className={seed === v ? 'on' : ''} onClick={() => setSeed(v)}>{v}</button>)}</div>
            <div className="mk-sub">The seed is the market maker's stake: more seed, steadier prices. It stays in the market to pay the traders who beat it, so count it as the cost of opening the question. It does not come back to you.</div>
            {bad ? <div className={qt && bad !== 'Pick the topic it belongs to.' ? 'mk-err' : 'mk-sub'}>{bad}</div> : null}
            <button className="mk-btn" disabled={!!w.accountId && (!!bad || !!busy)} onClick={create}>{!w.accountId ? 'Connect wallet to create' : busy === 'tx' ? 'Creating…' : `Create it for ${seed} NEAR`}</button>
            {msg ? <div className="mk-note">{msg}{txh ? <> <a className="mk-link" href={txLink(txh)} target="_blank" rel="noreferrer">View tx</a></> : null}{topic && msg.startsWith('Created') ? <> <Link className="mk-link" to={`/wiki/${topic.slug}`}>Open {topic.title}</Link></> : null}</div> : null}
          </section>
          <section className="wh-side">
            <div className="wc-box wn-prev">
              <div className="mk-lbl">How it will look</div>
              <div className="wn-card">
                <span className="q">{q.trim() || 'Your question'}</span>
                <span className="n"><b>50%</b> chance</span>
                <span className="yn"><span className="y">Yes 50%</span><span className="no">No 50%</span></span>
                <span className="f"><span>{topic?.title ?? 'Topic'}</span><span>{dated ? `Ends ${new Date(endMs ?? Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : 'No end date'}</span></span>
              </div>
            </div>
            <div className="wc-box">
              <div className="mk-lbl">Good questions</div>
              <div className="mk-sub">One clear outcome anyone can check: a number, a date, a public record. “Will X happen by Dec 31?” beats “Is X good?”. The judges read the topic page, its sources and what traders post.</div>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  )
}
