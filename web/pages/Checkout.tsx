import { useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { Page, Head, Hero, Band, Flow, Show, useTitle, UsersLine, Log } from '../components/Market'

/** /checkout: "Universal checkout widget: any merchant/app can add a "checkout" button that enables paying with Intents
 *  from whatever wallet and blockchain that user has." nearly.trade is the site that added it: the two buttons below are the
 *  same script a merchant embeds (/widget/demo.html shows it on a plain page). */

const SRC = '/widget/nearly-checkout.js?v=1113b'   // feedback round 1: address checks, rounded amounts, copy buttons (b: Cloudflare cached ?v=1112 with the old file in the minute between the two deploys) // ?v: Cloudflare keeps the file 4 h; bump it when the widget changes // g: Phantom on a computer gets the whole serialized transaction; h: paid notification
type NC = { mount: (el: HTMLElement, o: Record<string, unknown>) => unknown }
let loading: Promise<NC> | null = null
export const loadWidget = () => (loading ??= new Promise<NC>((ok, bad) => {
  const w = window as unknown as { NearlyCheckout?: NC }
  if (w.NearlyCheckout) return ok(w.NearlyCheckout)
  const s = document.createElement('script'); s.src = SRC
  s.onload = () => (w.NearlyCheckout ? ok(w.NearlyCheckout) : bad(new Error('widget did not load')))
  s.onerror = () => { loading = null; bad(new Error('widget did not load')) }
  document.head.appendChild(s)
}))

/** the widget draws in its own shadow root; here it wears the cards' system (a merchant's page keeps its stock look) */
export const DRESS = `:host{font:14px/1.45 var(--mk-sans);color:var(--mk-fg);-webkit-font-smoothing:antialiased}
.box{background:transparent;border:0;border-radius:0;padding:0;max-width:none;display:flex;flex-direction:column;height:100%}
.box>div:first-child,.box>div:nth-child(2){display:none}
.muted{color:var(--mk-fg2);font-size:13px;font-weight:450}.ok{color:var(--mk-jade-t)}.bad{color:var(--mk-red)}
.chips{gap:6px;margin:12px 0}.chip{font:500 12px var(--mk-sans);padding:4px 9px;border:1px solid var(--mk-line);background:var(--mk-s2);color:var(--mk-fg);border-radius:999px}.chip.on{border-color:var(--mk-jade);background:var(--mk-jade);color:var(--mk-ink)}
.row small{color:var(--mk-fg3)}
input{height:40px;padding:0 12px;background:var(--mk-bg);color:var(--mk-fg);border:1px solid var(--mk-line);border-radius:10px;font:14px var(--mk-sans)}input::placeholder{color:var(--mk-fg3)}
.btn{height:40px;border-radius:10px;font:600 14px var(--mk-sans)}.btn.p{width:100%;margin-top:10px!important;background:var(--mk-jade);color:var(--mk-ink)}.btn.p:hover{background:var(--mk-jade-hi)}.btn.g{background:transparent;color:var(--mk-fg);border:1px solid var(--mk-line)}
.row{color:var(--mk-fg2)}.row b{color:var(--mk-fg);font-family:var(--mk-mono);font-weight:500}.addr{background:var(--mk-bg);border-color:var(--mk-line);font-family:var(--mk-mono);color:var(--mk-fg2)}`

export function Widget(o: { recipient?: string; asset: string; usd: number; label: string; onPaid?: (status: { status: string }, quote: { depositAddress?: string; amountOut?: string; quote?: { depositAddress?: string; amountOut?: string } } | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { __nc?: unknown }) | null
    if (!el || el.__nc || el.shadowRoot) return
    loadWidget().then((nc) => {
      if (el.__nc || el.shadowRoot) return
      el.__nc = nc.mount(el, o)
      const root = el.shadowRoot as unknown as ShadowRoot | null  // mount() just attached it
      const s = document.createElement('style'); s.textContent = DRESS; root?.appendChild(s)
    }).catch(() => { el.textContent = 'The checkout did not load. Refresh to try again.' })
  }, [o])
  return <div ref={ref} className="grow" />
}

// the demo shop is the team's account: these two real payments landed there, and 1Click answers for each
const verify = (deposit: string, min: string) => `/api/checkout/verify?deposit=${deposit}&recipient=nearlyops.near&asset=nep141:wrap.near&min_out=${min}`
// the third one: a /pay link payment, exactly 5 USDC to the shop from a fresh Base wallet
export const LINK_PAID = { deposit: '0x6be4EDf96ACB2A77cc35D9fF0a9E2d6536Cb1059', paidTx: 'https://basescan.org/tx/0x09d4f7dded6fcff9d77836f9084605b3fdff4d45b1273ca974dbc790e3bac802', paid: '0.002467 ETH', gotTx: 'https://nearblocks.io/txns/22AyZN6NcULXBxRpnKXRi61EJpDYCY3fj1zFdXzBaWLM', got: '5.00 USDC' }
const PAID = [
  { chain: 'Base', paid: '0.002276 ETH', paidTx: 'https://basescan.org/tx/0xb8b77337608e4ea37c039219189b6baa239ccf56007bd15f627d706062e98edf', got: '1.336 NEAR', gotTx: 'https://nearblocks.io/txns/82b4ByhDd8XGqiKeE7uX9mpRgm6Z8K3NY35EntYLvear', check: verify('0x0dc7457FDdcD00e7DF887F331952c1cA5D15B8Fc', '1335827000000000000000000') },
  { chain: 'Solana', paid: '0.0564 SOL', paidTx: 'https://solscan.io/tx/2AYSjoxpGXvmgmtAxA2akbq3jEVEiWDmnEQvESuQEB72aqQwrUqa8DcTE45jteozUJTjzTKytjWtwUwadQwYfcyG', got: '1.340 NEAR', gotTx: 'https://nearblocks.io/txns/3Ym9NFJtGRjTcj5W1eLb6JqX2gKpKnYa1hdvpLm7i2uy', check: verify('DVueGZsLn6RzRkieZXxe1DXuSkxjhRzmGtMqMqvyF1Q7', '1340483000000000000000000') },
]
// the demo shop pays into shop.nearlyops.near (1Click stopped quoting real payments to nearlyops.near that day; the three paid examples above stay on it)
const SHOP = { recipient: 'shop.nearlyops.near', asset: 'nep141:wrap.near', usd: 5, label: 'Pay $5' }
const LAUNCH = { asset: 'nearly-993927.nearlytrade.near', usd: 5, label: 'Buy $5 of NEARLY' }
const SNIPPET = `<script src="https://nearly.trade/widget/nearly-checkout.js"></script>
<div data-nearly-checkout
  data-recipient="shop.near"
  data-asset="nep141:wrap.near"
  data-usd="5"></div>`
const SERVER = `NearlyCheckout.mount(el, { recipient, asset, usd, onPaid(status, quote) })

// confirm an order from your own server, straight from 1Click:
GET https://nearly.trade/api/checkout/verify?deposit=<depositAddress>
    &recipient=<your account>&asset=<asset id>&min_out=<raw amount>`

/** a code block with its copy button; it wraps on a phone (market.css) */
export function Code({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return <div className="mk-codebox"><pre className="mk-code">{text}</pre><button className="mk-btn ghost sm auto" onClick={() => navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) })}>{ok ? 'Copied' : 'Copy'}</button></div>
}

export function Checkout() {
  useTitle('Universal checkout')
  const [gets, setGets] = useState('The shop receives it in NEAR')
  // what the shop gets at today's price; the exact amount comes back in the quote
  useEffect(() => { fetch('/api/stats').then((r) => r.json()).then((s) => { if (s.near_usd) setGets(`The shop receives about ${(5 / s.near_usd).toFixed(2)} NEAR`) }).catch(() => {}) }, [])
  return (
    <Page>
      <Hero compact art="checkout" eyebrow="Universal checkout" title="Accept payments from any chain." sub="Add checkout to any site. Buyers pay from any chain; you receive the exact amount." actions={[{ label: 'Integrate now', href: '#integrate' }, { label: 'Make a payment link', href: '#link' }, { label: 'Read the guide', href: '/docs#checkout' }]} />
      <Band live="Live on NEAR mainnet · settled by NEAR Intents 1Click" right={<UsersLine />} items={[
        { v: 7, k: 'Chains to pay from', sub: 'Bitcoin, Solana, Ethereum, Base and more' },
        { v: 3, k: 'Payments verified', sub: 'each one below' },
        { v: '$15', k: 'Settled to the shop', sub: 'exact amounts' },
        { v: '$0', k: 'Held in custody, ever' },
      ]} />
      {/* users line folded into the band */}
      <Flow steps={[
        { t: 'Buyer picks a coin', d: 'Whatever they hold, on any chain.' },
        { t: 'Exact quote', d: '1Click prices the exact amount the shop gets.' },
        { t: 'One deposit', d: 'The buyer sends to a one-time address.' },
        { t: 'Solvers deliver', d: 'Swap and bridge in one step, to the shop.' },
        { t: 'Shop confirms', d: 'One call checks the payment with 1Click.' },
      ]} />
      <Show tag="Paid on mainnet · from Base" title="$5 in ETH on Base became 1.336 NEAR in the shop's account." right={<a className="mk-btn ghost sm auto" href={PAID[0].check} target="_blank" rel="noreferrer">Check it with 1Click</a>}>
        {/* the proof as one quiet ledger, not four bubbles */}
        <Log cols="170px 250px minmax(0, 1fr)" colsSm="1fr 1.4fr" keep={[0, 1]} head={['Who', 'Amount', 'What happened']} rows={[
          { key: 'paid', cells: ['Buyer on Base', <a className="mk-link mono" href={PAID[0].paidTx} target="_blank" rel="noreferrer">{PAID[0].paid}</a>, 'Sent to a one-time 1Click address, quote locked.'] },
          { key: 'got', cells: ['Shop', <a className="mk-link mono" href={PAID[0].gotTx} target="_blank" rel="noreferrer">{PAID[0].got}</a>, 'NEAR Intents solvers swapped and bridged it. The shop checked the payment with 1Click.'] },
        ]} />
        <div className="mk-sub">The second one came from Solana: <a className="mk-link" href={PAID[1].paidTx} target="_blank" rel="noreferrer">{PAID[1].paid}</a> in, <a className="mk-link" href={PAID[1].gotTx} target="_blank" rel="noreferrer">{PAID[1].got}</a> out, <a className="mk-link" href={PAID[1].check} target="_blank" rel="noreferrer">checked with 1Click</a>. Both from new wallets; non-custodial end to end. The third went through a payment link in USDC: <a className="mk-link" href={LINK_PAID.paidTx} target="_blank" rel="noreferrer">{LINK_PAID.paid}</a> in, <a className="mk-link" href={LINK_PAID.gotTx} target="_blank" rel="noreferrer">exactly {LINK_PAID.got}</a> out, <a className="mk-link" href={`/pay/receipt?deposit=${LINK_PAID.deposit}&to=nearlyops.near&get=usdc&usd=5&for=Payment%20link%20test`}>its receipt</a>.</div>
      </Show>
      <section id="pay" className="mk-sec scroll-mt-24">
        <Head title="Try it" sub="The same widget a merchant embeds. Pay from any chain. The address you enter is yours on that chain: a refund lands there if the swap fails." />
        <div className="mk-grid two">
          <div className="mk-card">
            <div className="mk-row"><span className="mk-name">A shop charges $5.00</span><span className="mk-sub end">{gets}</span></div>
            <Widget {...SHOP} />
          </div>
          <div className="mk-card">
            <div className="mk-row"><span className="mk-name">Buy a launch from any chain</span><span className="mk-sub end">$5 of NEARLY</span></div>
            <Widget {...LAUNCH} />
          </div>
        </div>
      </section>
      <section id="integrate" className="mk-sec scroll-mt-24">
        <Head title="Integrate" sub="One snippet on your page, one call on your server." />
        <div className="mk-grid two">
          <div className="mk-card">
            <div className="mk-name">1. Add it to your site</div>
            <Code text={SNIPPET} />
            <div className="mk-sub">Non-custodial: the deposit address and the settlement belong to NEAR Intents, never to this site. <a className="mk-link" href="/widget/demo.html">See it on a plain page</a></div>
          </div>
          <div className="mk-card">
            <div className="mk-name">2. Confirm the payment</div>
            <Code text={SERVER} />
            <div className="mk-sub">onPaid updates the page; confirm the order from your server with the verify call.</div>
          </div>
        </div>
      </section>
      <PayLink />
    </Page>
  )
}

/** no code: a payment link and its QR code. The buyer opens /pay, picks any chain, and NEAR Intents delivers the exact
 *  amount to the merchant's account, in NEAR or in USDC. Nothing is stored: the link carries the order. */
export const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
export const payTarget = (to: string) => /^([a-z0-9][a-z0-9_-]*\.)*[a-z0-9_-]+\.(near|tg)$|^[0-9a-f]{64}$/.test(to)
function PayLink() {
  const [to, setTo] = useState('')
  const [usd, setUsd] = useState('25')
  const [get, setGet] = useState<'usdc' | 'near'>('usdc')
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState(false)
  const ok = payTarget(to.trim()) && Number(usd) >= 1 && Number(usd) <= 10000
  const link = `https://nearly.trade/pay?${new URLSearchParams({ to: ok ? to.trim() : 'shop.nearlyops.near', usd: String(ok ? Number(usd) : 5), get: ok ? get : 'near', ...(label.trim() ? { for: label.trim().slice(0, 60) } : ok ? {} : { for: 'Order 42' }) })}`
  const svg = useMemo(() => { if (!link) return ''; const q = qrcode(0, 'M'); q.addData(link); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }, [link])
  const copy = () => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }
  return (
    <section id="link" className="mk-sec scroll-mt-24">
      <Head title="No code: a payment link" sub="Send it in a chat, print the QR on a counter. The buyer pays from any chain; you get the exact amount." />
      <div className="mk-grid two">
        <div className="mk-card">
          <div className="mk-field"><label>Your NEAR account</label><input className="mk-in" placeholder="shop.near" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="mk-field"><label>Amount in USD</label><input className="mk-in" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.includes('-') ? '' : e.target.value.replace(/[^\d.]/g, ''))} /></div>   {/* a minus clears the field instead of turning -5 into $5 */}
          <div className="mk-field"><label>You receive</label><div className="mk-picks">{(['usdc', 'near'] as const).map((g) => <button key={g} onClick={() => setGet(g)} className={`mk-pick ${get === g ? 'on' : ''}`}>{g === 'usdc' ? 'USDC' : 'NEAR'}</button>)}</div></div>
          <div className="mk-field"><label>What it is for (optional)</label><input className="mk-in" placeholder="Order 42" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          {get === 'usdc' ? <div className="mk-sub">USDC lands in your NEAR account; it must have held USDC once (token storage).</div> : null}
        </div>
        <div className="mk-card">
          <div className="mk-row"><span className="mk-name">{ok ? 'Your payment link' : 'Example'}</span>{ok ? null : <span className="mk-sub end">{to.trim() && !payTarget(to.trim()) ? 'not a NEAR account: name.near, name.tg or 64 hex' : usd && (Number(usd) < 1 || Number(usd) > 10000) ? 'amount: $1 to $10,000' : 'the demo shop: fill in your account to make yours'}</span>}</div>
          <div className={ok ? '' : 'opacity-50'}>
            <div className="mx-auto w-44 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <div className="mk-code wrap">{link}</div>
          {ok ? <div className="mk-btns"><button className="mk-btn" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button><a className="mk-btn ghost" href={link.replace('https://nearly.trade', '')} target="_blank" rel="noreferrer">Open it</a></div> : null}
        </div>
      </div>
    </section>
  )
}
