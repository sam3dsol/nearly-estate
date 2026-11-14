import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Page, Hero, Band, Head, Contract, useTitle, UsersLine, DOORS } from '../components/Market'

/** /estate: the front door the reviews asked for (nearly.trade opens on the token launchpad). One line on what it is, the
 *  five products with the proof each one has on mainnet, the live numbers, and how to check all of it without trusting us. */
const NAME = 'Nearly Estate'
const NB = (tx: string) => `https://nearblocks.io/txns/${tx}`

/* one line a product; the art strip on each card is the same slice as its door in the hero (DOORS) */
const PRODUCTS: { to: string; name: string; line: string; proof: string; tx: string; href?: string }[] = [
  { to: '/wiki', name: 'Wiki', line: 'Every fact is a market. Three AI judges in sealed hardware rule it, two of three decide, and the contract checks their signed votes.', proof: 'Market 343 ruled by DeepSeek, Qwen and GLM', tx: 'NJTqdyxn1hswAu5DXiDivqdLcGuiEdBmMQvCWGzzET2' },
  { to: '/keys', name: 'Keys', line: 'Private trading, public PnL. A trader sells viewing keys; holders see every trade live and copy it with their own agent.', proof: 'A confidential swap, copied by a key holder', tx: 'HzqXi5M7uo6mCPNEND5LmbkVMsDngdCdvh9AzxrwBr6o', href: '/keys' },
  { to: '/swarm', name: 'Swarm', line: 'AI jobs paid on chain. Agents enter, three AI reviewers score them, and the contract pays the best one.', proof: 'Job 21 reviewed by AI on chain, 3 of 3 passed', tx: '6qhv3HCGmxmrxYFd5HqHkwmbWc84UvkKq8TTynKHXaVJ' },
  { to: '/agents', name: 'Agents', line: 'Agent wallets under rules the owner signs once on the NEAR Intents Agent API. A forged order or a withdrawal to a stranger is refused.', proof: 'Forged orders refused by the policy, live', tx: '', href: '/agents#break' },
  { to: '/checkout', name: 'Checkout', line: 'Payments from any chain. The buyer pays with what they hold; NEAR Intents delivers the exact amount in NEAR or USDC.', proof: '$5 in ETH from Base became 1.336 NEAR, verified', tx: '82b4ByhDd8XGqiKeE7uX9mpRgm6Z8K3NY35EntYLvear' },
]
/* five proof cards under the hero, one real event a product, today's numbers (copy by the copywriter round) */
/* the five screens on the wall carry the proof in real type (for the paper cards under the wall, and
   "make it look better professional"); the backdrop keeps the render's glass frames, the text is HTML over the baked screens. "yourkey.near", never a real account. */
type Screen = { to: string; tag: string; h: [string, string]; t: string; big: string; bk: string; tone?: 'pos' | 'neg'; rows: [string, string][]; res: string; bad?: boolean }
const SCREENS: Screen[] = [
  { to: '/wiki/m/343', tag: 'Wiki', h: ['Every fact', 'is a market'], t: 'Napoleon Bonaparte died on 5 May 1821 on Saint Helena.', big: '87%', bk: 'before the ruling', rows: [['AI judges', 'DeepSeek, Qwen, GLM'], ['Signed votes', '2 of 3 decide'], ['Challenge', '1 NEAR, 24 h']], res: 'Ruled True' },
  { to: '/keys', tag: 'Keys', h: ['Sell viewing keys', 'others follow and copy'] /* the words of the hackathon post, sell your viewing keys for people to follow and copy trade */, t: "Holders see and copy yourkey.near's trades live; the wallet stays private.", big: '+$60', bk: 'public PnL', tone: 'pos', rows: [['Key', '0.5 NEAR'], ['Trades', 'about 380'], ['Holders, all keys', '15']], res: 'Copy with your agent' },
  { to: '/swarm', tag: 'Swarm', h: ['Post a job,', 'agents compete'], t: 'Work and pay go on chain. AI agents enter, three AI reviewers score every entry, the contract pays the best one.', big: '0.08 NEAR', bk: 'paid to the winner', tone: 'pos', rows: [['Bids on chain', '21'], ['Paid after review', '12'], ['Reviewers', '3, two must agree']], res: 'Paid by the contract' },   // says what Swarm is, no reviewer or agent names
  { to: '/agents#break', tag: 'Agents', h: ['Your agent,', 'your rules'], t: 'A forged order to ignore the limits and sell $50 was refused.', big: 'Refused', bk: 'by the policy', tone: 'neg', rows: [['Signed rule', '$2 a trade'], ['Forged orders', '48 of 48 refused'], ['Honest orders', '20 of 20 passed']], res: 'Nothing moved', bad: true },
  { to: '/checkout', tag: 'Checkout', h: ['Get paid from', 'any chain'], t: 'A buyer on Base paid about $5 in ETH; the shop received NEAR.', big: '1.336 NEAR', bk: 'received', rows: [['Buyer sent', '0.0023 ETH'], ['Pay from', '7 chains'], ['Held in custody', 'nothing']], res: 'Verified with 1Click' },
]
const Screens = () => (
  <div className="mk-screens">
    {SCREENS.map((c, i) => (
      <Link key={c.to} to={c.to} className="scr" style={{ '--i': i } as CSSProperties}>
        <span className="chip">{c.tag}</span>
        <b className="h">{c.h[0]}<i>{c.h[1]}</i></b>
        <span className="t">{c.t}</span>
        <span className={`big${c.tone ? ` ${c.tone}` : ''}`}>{c.big}<small>{c.bk}</small></span>
        {/* the three detail rows left the wall (they stay on the product pages), so each screen is chip, headline, one line, the number and the result */}
        <span className={`res${c.bad ? ' bad' : ''}`}>{c.res}</span>
      </Link>
    ))}
  </div>
)

type Home = { stats?: { claims: number; trades: number; volume_near: number; open_all?: number }; pages?: { slug: string; kind: string }[] }

export function Estate() {
  useTitle(NAME)
  const [h, setH] = useState<Home | null>(null)
  useEffect(() => {
    fetch('/api/wiki/home').then((r) => (r.ok ? r.json() : null)).then(setH).catch(() => {})
  }, [])
  const s = h?.stats
  // the same count the wiki board shows as "open markets", every open market, a launch claim too
  const open = s?.open_all ?? null
  return (
    <Page>
      {/* the front door shows all five, in the headline and in the art (five doors, one a product) */}
      {/* no sub paragraph; the proof lives on the screens; the hero fits one screen */}
      <Hero wall equal art="estate" scene={<Screens />} eyebrow="" title="An AI encyclopedia, private trading, agent wallets, swarm jobs and checkout on NEAR." sub="" actions={DOORS.map((d) => ({ label: d.name, href: d.to }))} />{/* the five doors are the buttons; no wiki/picks/verify buttons on the front door */}
      <Band live={<>Live on NEAR mainnet · <Contract /></>} right={<UsersLine />} items={[
        { v: open ?? '–', k: 'Open markets' },
        { v: s ? s.trades : '–', k: 'Trades on them' },
        { v: 3, k: 'AI judges per ruling', sub: 'DeepSeek, Qwen, GLM' },
        { v: 5, k: 'Products on NEAR', sub: 'one contract and NEAR Intents' },
      ]} />
      {/* users line folded into the band */}
      <section className="mk-sec">
        <Head title="The five products" sub="Each one names its proof on mainnet; open the transaction to check it." />
        <div className="mk-grid">
          {/* a numbered editorial card, short jade rule under the name, the proof on a hairline, a quiet arrow link */}
          {PRODUCTS.map((p, i) => (
            <div key={p.to} className="mk-card mk-ecard">
              <div className="mk-num">0{i + 1}</div>
              <div className="mk-name">{p.name}</div>
              <div className="mk-text">{p.line}</div>
              <div className="grow" />
              <div className="mk-sub"><span className="lbl">Proof on mainnet</span>{p.tx.length > 20 ? <a className="mk-link" href={NB(p.tx)} target="_blank" rel="noreferrer">{p.proof} ↗</a> : p.href ? <Link className="mk-link" to={p.href}>{p.proof} →</Link> : p.proof}</div>
              <Link to={p.to} className="mk-go">Open {p.name} <i>→</i></Link>
            </div>
          ))}
          {/* the sixth is the proof of all of it */}
          <div className="mk-card mk-ecard">
            <div className="mk-num">06</div>
            <div className="mk-name">All of it, checked</div>
            <div className="mk-text">One command re-reads every claim above from NEAR mainnet; another re-checks every user. No keys, no server to trust.</div>
            <div className="grow" />
            <div className="mk-sub"><span className="lbl">From a clone</span><span className="mono">npm run verify · npm run users</span></div>
            <a href="#check" className="mk-go">Verify on chain <i>→</i></a>
          </div>
        </div>
      </section>
      <section id="check" className="mk-sec">
        <Head title="Verify on chain" sub="Check every claim yourself. From a clone of the repository:" />
        <div className="mk-card">
          <div className="mk-code">npm run verify    # every claim in the README against the chain{'\n'}npm run users     # every user on chain, re-read from NEAR{'\n'}npm run measure   # how often a page line goes beyond its source{'\n'}npm run attest    # the server's TEE attestation</div>
          <div className="mk-sub">The contract is <Contract literal />. The server runs in a Phala Cloud confidential VM (Intel TDX); its attestation is at <a className="mk-link" href="/api/attestation" target="_blank" rel="noreferrer">/api/attestation</a>.</div>
        </div>
      </section>
    </Page>
  )
}
