/* Nearly Checkout: one script, one button, paid from any wallet on any chain through NEAR Intents (1Click).
 *   <script src="https://nearly.trade/widget/nearly-checkout.js"></script>
 *   <div data-nearly-checkout data-recipient="shop.near" data-asset="nep141:wrap.near" data-usd="5" data-label="Pay $5"></div>
 * or  NearlyCheckout.mount(el, { recipient, asset, usd | amount, label, onPaid(status) })
 * recipient = where the merchant receives (a NEAR account, or an address on any chain 1Click settles to) and asset = what
 * they receive (1Click asset id). The buyer picks their chain, gets a deposit address, pays; the widget watches the swap.
 * Catalogue tokens settle straight to the merchant. A nearly.trade launch token is not in 1Click yet, so for those the
 * widget settles wNEAR to the buyer and hands them to the token page, where the buy runs on our pool.
 * onPaid runs in the buyer's browser and is a convenience only: a merchant confirms an order from their own server with
 * GET https://nearly.trade/api/checkout/verify?deposit=<depositAddress>&recipient=<your account>&asset=<asset id>&min_out=<raw amount>
 * (the status straight from 1Click, checked against what you expect to receive).
 * the address is checked for the chosen chain before any quote, with a hint when it belongs to another
 * chain; NEAR accounts are lowercased; amounts show rounded with a copy button and the exact figure beside; errors stay in the
 * box (no alert); a launch buy reads "you get"; Bitcoin is not offered on a launch buy (a Bitcoin address has no Intents id);
 * on a computer the Solana step says what to do in Phantom instead of a link that opens nothing.
 */
(function () {
  const OC = 'https://1click.chaindefuser.com'
  const ORIGINS = [
    { chain: 'sol', name: 'Solana', coin: 'SOL', asset: 'nep141:sol.omft.near', dec: 9 },
    { chain: 'base', name: 'Base', coin: 'ETH', asset: 'nep141:base.omft.near', dec: 18, evm: '0x2105' },
    { chain: 'eth', name: 'Ethereum', coin: 'ETH', asset: 'nep141:eth.omft.near', dec: 18, evm: '0x1' },
    { chain: 'arb', name: 'Arbitrum', coin: 'ETH', asset: 'nep141:arb.omft.near', dec: 18, evm: '0xa4b1' },
    { chain: 'bsc', name: 'BNB Chain', coin: 'BNB', asset: 'nep141:bnb.omdep.near', dec: 18, evm: '0x38' },   // the current 1Click id; the old nep245 one is marked deprecated
    { chain: 'sol', name: 'Solana', coin: 'USDC', asset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', dec: 6, token: true, mint: 'EPjFWdd5AuSoUBpy3V4QwjmFcHJSyRx6a1VvLQqXFsAw' },
    { chain: 'base', name: 'Base', coin: 'USDC', asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', dec: 6, evm: '0x2105', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    { chain: 'arb', name: 'Arbitrum', coin: 'USDC', asset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', dec: 6, evm: '0xa4b1', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    { chain: 'eth', name: 'Ethereum', coin: 'USDC', asset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', dec: 6, evm: '0x1', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { chain: 'eth', name: 'Ethereum', coin: 'USDT', asset: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', dec: 6, evm: '0x1', token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    { chain: 'btc', name: 'Bitcoin', coin: 'BTC', asset: 'nep141:btc.omft.near', dec: 8, manual: true },
    { chain: 'near', name: 'NEAR', coin: 'NEAR', asset: 'nep141:wrap.near', dec: 24, manual: true },
  ]
  const css = `
    :host{all:initial;font:14px/1.4 ui-monospace,Menlo,monospace;color:#EDE8DC}
    .box{background:#0F0E0C;border:1px solid #262420;border-radius:14px;padding:14px;max-width:360px}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 16px;border-radius:999px;border:0;cursor:pointer;font:inherit;font-weight:700;text-decoration:none}
    .p{background:#2DD4BF;color:#021714}.p:hover{background:#7EE8D8}.g{background:transparent;color:#EDE8DC;border:1px solid #3A362F}
    .chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.chip{padding:6px 10px;border-radius:999px;border:1px solid #3A362F;cursor:pointer;color:#A8A296}.chip.on{border-color:#2DD4BF;background:#2DD4BF;color:#021714}
    .row{display:flex;justify-content:space-between;gap:8px;margin:6px 0;color:#A8A296}.row b{color:#EDE8DC;text-align:right}.row small{display:block;font-weight:400;font-size:11px;color:#837D70;word-break:break-all}
    .addr{word-break:break-all;background:#131210;border:1px solid #262420;border-radius:10px;padding:8px;margin:8px 0;font-size:12px}
    .muted{color:#837D70;font-size:12px}.ok{color:#5FD08A}.bad{color:#C8635A}input{font:inherit;background:#131210;color:#EDE8DC;border:1px solid #262420;border-radius:10px;padding:8px;width:100%;box-sizing:border-box}
  `
  // the site this widget was loaded from (its own API), nearly.trade when the script tag has no origin to read
  const NC_API = (() => { try { return new URL((document.currentScript && document.currentScript.src) || 'https://nearly.trade/').origin } catch { return 'https://nearly.trade' } })()
  const j = async (path, init) => { const r = await fetch(OC + path, Object.assign({ headers: { 'content-type': 'application/json' } }, init || {})); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error([].concat(b.message || `1Click ${r.status}`).join(' ')); return b }
  const say = (e, org) => { const m = String((e && e.message) || e || '')
    if (/refundTo is not valid|bad Solana address/i.test(m)) return `that is not a ${org.name} address, check it and try again`
    if (/recipient is not valid/i.test(m)) return 'the shop\'s payout address is not valid, tell the shop'
    if (/too low|minimum|at least/i.test(m)) return `too small to send from ${org.name}, pick another coin`
    // "Failed to get quote" is 1Click's answer for the payment as a whole (today: every real quote to one recipient), not for the coin
    if (/failed to get quote/i.test(m)) return 'NEAR Intents did not give a quote for this payment right now. Try again in a few minutes, or another coin.'
    if (/no route|no quote/i.test(m)) return `no route from ${org.coin} right now, pick another coin`
    if (/user rejected|user denied|rejected the request|cancel/i.test(m)) return 'you said no in the wallet, nothing was sent'
    if (/insufficient funds/i.test(m)) return `not enough ${org.coin} in this wallet for the amount and the fee`
    if (/failed to fetch|networkerror|load failed|1Click 5\d\d/i.test(m)) return 'could not reach NEAR Intents, try again'
    if (/1Click 429|too many/i.test(m)) return 'busy right now, try again in a few seconds'
    return m }
  const raw = (amount, dec) => { const [i, f = ''] = String(amount).split('.'); return (BigInt(i || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec))).toString() }
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const solHex = (s) => { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad Solana address'); n = n * 58n + BigInt(i) } let h = n.toString(16); for (const c of s) { if (c === '1') h = '00' + h; else break } return h.padStart(64, '0') }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  // the address for the chosen chain, checked before any quote (i5022803831, xerofom, fesan52: every mistake read "bad Solana address")
  const IS = {
    near: (a) => /^([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*\.(near|tg)$|^[0-9a-f]{64}$/.test(a),
    evm: (a) => /^0x[0-9a-fA-F]{40}$/.test(a),
    sol: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
    btc: (a) => /^(bc1[02-9ac-hj-np-z]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a),
  }
  const kindOf = (org) => (org.chain === 'near' ? 'near' : org.evm ? 'evm' : org.chain === 'btc' ? 'btc' : 'sol')
  const looksLike = (a) => (IS.evm(a) ? 'an Ethereum-style address (Ethereum, Base, Arbitrum, BNB Chain)' : IS.near(a) ? 'a NEAR account' : IS.btc(a) ? 'a Bitcoin address' : IS.sol(a) ? 'a Solana address' : null)
  const what = (org) => (org.chain === 'near' ? 'NEAR account' : `${org.name} address`)
  // amounts for reading: the exact figure stays beside, and in the copy button
  const trim = (s) => String(s).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
  const nice = (s) => { const n = Number(s); if (!isFinite(n)) return String(s); if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); if (n >= 1) return trim(n.toFixed(4)); return trim(Number(n.toPrecision(4)).toFixed(10)) }
  // what to send, rounded up a hair (sending a little more is fine; less fails), so a wallet with few decimals can type it
  const up = (s) => { const n = Number(s); const d = n >= 1 ? 4 : 6; const f = 10 ** d; return trim((Math.ceil(n * f - 1e-9) / f).toFixed(d)) }
  const phone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  // Phantom on a computer (sergeserge1: the solana: link opened nothing there): a legacy System transfer built by hand, Phantom
  // signs and sends it (provider.request signAndSendTransaction with the base58 message). Native SOL only; a token needs its own program.
  const b58enc = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n } for (const b of bytes) { if (b === 0) out = '1' + out; else break } return out }
  const b58dec = (str) => Uint8Array.from(solHex(str).match(/../g).map((x) => parseInt(x, 16)))
  const cu16 = (n) => (n < 128 ? [n] : [(n & 127) | 128, n >> 7])
  // the site's paid dRPC relay (getLatestBlockhash is open there to a shop's own Origin, in a small rate-limited lane)
  const SOL_RPCS = ['https://nearly.trade/api/solrpc']
  const solTransferMessage = (from, to, lamports, blockhash) => {
    const data = new Uint8Array(12); const dv = new DataView(data.buffer); dv.setUint32(0, 2, true); dv.setBigUint64(4, BigInt(lamports), true)
    // header: 1 signer, 0 read-only signed, 1 read-only unsigned (the system program); keys: payer, recipient, system program
    return new Uint8Array([1, 0, 1, ...cu16(3), ...b58dec(from), ...b58dec(to), ...new Uint8Array(32), ...b58dec(blockhash), ...cu16(1), 2, ...cu16(2), 0, 1, ...cu16(12), ...data])
  }
  async function payWithPhantom(to, lamports) {
    const p = window.solana; if (!p) throw new Error('Phantom is not on this page')
    const from = (p.publicKey || (await p.connect()).publicKey).toString()
    let hash = null
    for (const u of SOL_RPCS) { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'finalized' }] }) }).then((x) => x.json()).catch(() => null); hash = r && r.result && r.result.value && r.result.value.blockhash; if (hash) break }
    if (!hash) throw new Error('could not reach Solana; send the amount from Phantom by hand')
    // Phantom reads that param as a whole transaction (signature count, one empty 64 byte signature, then the message);
    // the bare message came back "Reached end of buffer unexpectedly" before any popup
    const out = await p.request({ method: 'signAndSendTransaction', params: { message: b58enc(new Uint8Array([1, ...new Uint8Array(64), ...solTransferMessage(from, to, lamports, hash)])) } })
    return out && out.signature
  }
  const status = (s) => ({ PENDING_DEPOSIT: 'waiting for your deposit', KNOWN_DEPOSIT_TX: 'deposit seen, confirming', PROCESSING: 'swap running', SUCCESS: 'paid', REFUNDED: 'refunded to your address', FAILED: 'failed, the refund goes to your address', INCOMPLETE_DEPOSIT: 'deposit too small, send the rest' }[s] || String(s).toLowerCase().replace(/_/g, ' '))

  function mount(host, o) {
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
    const style = el('style'); style.textContent = css; root.appendChild(style)
    const box = el('div', 'box'); root.appendChild(box)
    const state = { origin: ORIGINS[0], refund: '', quote: null, status: null, tokens: null, direct: null, note: null }
    const nearly = /\.nearlytrade\.near$/.test(o.asset || '')
    const destAsset = nearly ? 'nep141:wrap.near' : (o.asset || 'nep141:wrap.near')
    // a launch buy or a market buy needs the payer's own Intents id: an EVM address, a NEAR account or a Solana key gives one; a Bitcoin address does not
    const needsId = nearly || !!o.onOwner || !!o.msgFor
    const nice4 = (n) => trim((Math.ceil(n * 1e4 - 1e-9) / 1e4).toFixed(4))
    const copy = (label, text) => { const b = el('button', 'btn g', label); b.onclick = () => { navigator.clipboard.writeText(text).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = label }, 1200) }).catch(() => {}) }; return b }

    const render = () => {
      box.innerHTML = ''
      box.appendChild(el('div', '', o.label || `Pay $${o.usd}`)).style.fontWeight = '700'
      box.appendChild(el('div', 'muted', nearly ? `${o.usd ? '$' + o.usd : o.amount + ' NEAR'} of ${o.asset.split('.')[0].toUpperCase()}: you pay from your wallet, the buy runs on nearly.trade` : `to ${o.recipient}`))
      if (state.status && state.status.status === 'SUCCESS') { box.appendChild(el('div', 'ok', 'Paid.')); if (nearly) { const a = el('a', 'btn p', 'Open the token page'); a.href = `https://nearly.trade/${o.asset}?buy=${state.quote.quote.amountOutFormatted}`; a.target = '_blank'; box.appendChild(a) } return }
      if (state.direct) {
        const d = state.direct
        if (d.to) {
          box.appendChild(el('div', 'muted', `${d.coin} paid in ${d.coin}: send it straight to the shop's account from any NEAR wallet, no swap in between.`))
          const r1 = el('div', 'row'); r1.append(el('span', '', 'send'), el('b', '', `${d.amount} ${d.coin}`)); box.appendChild(r1)
          const r2 = el('div', 'row'); r2.append(el('span', '', 'to'), el('b', '', d.to)); box.appendChild(r2)
          box.appendChild(el('div', 'addr', d.to))
          const acts = el('div', 'chips'); acts.appendChild(copy('Copy amount', d.amount)); acts.appendChild(copy('Copy account', d.to)); box.appendChild(acts)
          box.appendChild(el('div', 'muted', `at today's price; the shop sees it on chain the moment it lands`))
        } else {
          box.appendChild(el('div', 'muted', `you already hold ${d.coin}: the buy runs on nearly.trade's own pool, straight from your wallet.`))
          const a = el('a', 'btn p', `Buy with ${d.coin} on the token page`); a.href = `https://nearly.trade/${o.asset}?buy=${d.amount}`; a.target = '_blank'; a.style.marginTop = '10px'; box.appendChild(a)
        }
        const x = el('button', 'btn g', 'Start over'); x.style.marginTop = '8px'; x.onclick = () => { state.direct = null; render() }; box.appendChild(x)
        return
      }
      if (!state.quote) {
        const chips = el('div', 'chips')
        // Bitcoin's bridge minimum is about $6, so it is offered from $7 up; not at all where the payer needs an Intents id
        // no NEAR on NEAR for a market buy, a plain transfer would reach the contract with no BuyFor
        for (const org of ORIGINS.filter((x) => !(x.coin === 'BTC' && (needsId || (Number(o.usd) > 0 && Number(o.usd) < 7))) && !(o.msgFor && x.asset === destAsset))) { const c = el('span', 'chip' + (org === state.origin ? ' on' : ''), `${org.coin} on ${org.name}`); c.onclick = () => { state.origin = org; state.refund = ''; render() }; chips.appendChild(c) }
        box.appendChild(chips)
        const inp = el('input'); inp.placeholder = `Your ${what(state.origin)} (refunds go here)`; inp.value = state.refund; inp.oninput = () => { state.refund = inp.value.trim() }; box.appendChild(inp)
        const hint = el('div', 'muted', (state.origin.chain === 'near' ? 'A refund comes back to this account if the swap fails.' : `A refund comes back to this ${state.origin.name} address if the swap fails.`) + (o.msgFor ? ' Your shares and winnings belong to this address: use a wallet you control, not an exchange deposit address.' : '')); box.appendChild(hint)
        const go = el('button', 'btn p', 'Get a quote'); go.style.marginTop = '10px'
        go.onclick = async () => {
          try {
            go.disabled = true; hint.className = 'muted'; hint.textContent = 'quoting…'
            if (!state.refund) { if (state.origin.evm && window.ethereum) state.refund = (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0]; else if (!state.origin.evm && state.origin.chain === 'sol' && window.solana) state.refund = (await window.solana.connect()).publicKey.toString() }
            if (!state.refund && !(state.origin.asset === destAsset)) throw new Error(`enter your ${what(state.origin)} first`)
            if (state.origin.chain === 'near') { state.refund = state.refund.toLowerCase(); inp.value = state.refund }
            if (state.refund && !IS[kindOf(state.origin)](state.refund)) { const l = looksLike(state.refund); throw new Error(l ? `that is ${l}, not a ${what(state.origin)}: pick the matching coin above, or enter your ${what(state.origin)}` : `that is not a ${what(state.origin)}, check it and try again`) }
            state.tokens = state.tokens || await j('/v0/tokens')
            const t = state.tokens.find((x) => x.assetId === state.origin.asset); if (!t || !t.price) throw new Error('no price for ' + state.origin.coin)
            const dest = state.tokens.find((x) => x.assetId === destAsset); if (!dest || !dest.price) throw new Error('no price for the destination asset'); state.destSym = dest.symbol
            // the same coin on both sides is a transfer, not a swap: NEAR Intents has nothing to route, so the buyer pays on chain directly
            if (state.origin.asset === destAsset && o.msgFor) throw new Error('this box pays from another chain; with NEAR in a wallet, connect it and buy on this page')
            if (state.origin.asset === destAsset) { state.direct = { amount: o.amount ? trim(String(o.amount)) : nice4(Number(o.usd) / dest.price), coin: state.origin.coin, to: nearly ? null : o.recipient }; render(); return }
            // EXACT_OUTPUT: the merchant receives exactly this much; 1Click works out what the buyer must send
            const outAmount = o.amount ? raw(String(o.amount), dest.decimals) : raw((Number(o.usd) / dest.price).toFixed(dest.decimals), dest.decimals)
            // a Solana wallet's Intents account is the hex of its key; EVM is the lowercase address; a NEAR account is its own Intents id
            // only a launch buy or a market buy needs the payer's own Intents id; a merchant payment does not (computing it
            // for every chain would break the Bitcoin and NEAR chips with "bad Solana address")
            const intentsId = needsId ? (state.origin.evm ? state.refund.toLowerCase() : state.origin.chain === 'near' ? state.refund : solHex(state.refund)) : null
            const recipient = nearly ? (o.buyer || intentsId) : o.recipient
            // a token payment to a NEAR account that is not registered with that token would bounce and refund the payer
            if (!nearly && !o.msgFor && destAsset !== 'nep141:wrap.near' && /^nep141:/.test(destAsset) && /^[a-z0-9._-]{2,64}$/.test(String(o.recipient || '')) && /\./.test(String(o.recipient))) {
              const reg = await fetch(`${NC_API}/api/checkout/registered?account=${encodeURIComponent(o.recipient)}&token=${encodeURIComponent(destAsset.slice(7))}`).then((r) => r.json()).catch(() => null)
              if (reg && reg.registered === false) throw new Error(`${o.recipient} is not registered with this token on NEAR, so the payment would bounce: the shop registers the account (storage_deposit) or takes NEAR instead`)
            }
            // a market buy from any chain (the wiki): the payer's Intents id owns the shares; the page is told first so it can pay out later
            if (o.onOwner) await o.onOwner(intentsId)
            state.quote = await j('/v0/quote', { method: 'POST', body: JSON.stringify({ dry: false, swapType: 'EXACT_OUTPUT', slippageTolerance: 100, originAsset: state.origin.asset, depositType: 'ORIGIN_CHAIN', destinationAsset: destAsset, amount: outAmount, refundTo: state.refund, refundType: 'ORIGIN_CHAIN', recipient, recipientType: nearly && !o.buyer ? 'INTENTS' : 'DESTINATION_CHAIN', ...(o.msgFor ? { customRecipientMsg: o.msgFor(intentsId) } : {}), deadline: new Date(Date.now() + 3600e3).toISOString(), referral: o.referral || 'nearly-checkout', quoteWaitingTimeMs: 3000 }) })
            state.quotedAt = Date.now()
            render(); watch()
          } catch (e) { hint.textContent = say(e, state.origin); hint.className = 'bad'; go.disabled = false }
        }
        box.appendChild(go)
        return
      }
      const q = state.quote.quote
      const sendAmt = up(q.amountInFormatted), outSym = destAsset === 'nep141:wrap.near' ? 'NEAR' : state.destSym || ''
      const r1 = el('div', 'row'); r1.append(el('span', '', 'send'), el('b', '', `${sendAmt} ${state.origin.coin}`)); r1.lastChild.appendChild(el('small', '', `exactly ${trim(q.amountInFormatted)}; a little more is fine, less is not`)); box.appendChild(r1)
      const r2 = el('div', 'row'); r2.append(el('span', '', nearly ? 'you get' : 'they get'), el('b', '', `${nice(q.amountOutFormatted)} ${outSym} ($${Number(q.amountOutUsd).toFixed(2)})`)); box.appendChild(r2)
      if (nearly) box.appendChild(el('div', 'muted', `the ${outSym} lands in your NEAR Intents balance; the token page then buys ${o.asset.split('.')[0].toUpperCase()} with it`))
      box.appendChild(el('div', 'addr', q.depositAddress + (q.depositMemo ? `  memo ${q.depositMemo}` : '')))
      // the note outlives the 5 s status re-render: what the wallet step said stays readable
      const note = el('div', state.note ? state.note.cls : 'muted', state.note ? state.note.text : '')
      const say2 = (text, cls) => { state.note = { text, cls }; note.className = cls; note.textContent = text }
      const acts = el('div', 'chips')
      if (state.origin.token || state.origin.manual) { box.appendChild(el('div', 'muted', `send ${sendAmt} ${state.origin.coin} on ${state.origin.name} to the address above${state.origin.manual ? '' : ' (the token, not the native coin)'}; the swap runs when it lands`)) }
      if (state.origin.evm && window.ethereum && !state.origin.token) { const b = el('button', 'btn p', 'Pay with wallet'); b.onclick = async () => { try { say2('confirm in your wallet…', 'muted'); await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: state.origin.evm }] }).catch(() => {}); if (String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase() !== state.origin.evm.toLowerCase()) throw new Error(`switch your wallet to ${state.origin.name} first, then tap Pay with wallet again`); const from = (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0]; await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: q.depositAddress, value: '0x' + BigInt(q.amountIn).toString(16) }] }); say2('sent, waiting for it to land…', 'muted') } catch (e) { say2(say(e, state.origin), 'bad') } }; acts.appendChild(b) }
      if (state.origin.chain === 'sol') {
        if (phone()) { const a = el('a', 'btn p', 'Open in Phantom'); a.href = `solana:${q.depositAddress}?amount=${q.amountInFormatted}${state.origin.mint ? `&spl-token=${state.origin.mint}` : ''}`; acts.appendChild(a) }
        else if (window.solana && !state.origin.token) { const b = el('button', 'btn p', 'Pay with Phantom'); b.onclick = async () => { try { say2('confirm in Phantom…', 'muted'); const sig = await payWithPhantom(q.depositAddress, q.amountIn); say2(sig ? `sent (${sig.slice(0, 8)}…), waiting for it to land…` : 'sent, waiting for it to land…', 'muted') } catch (e) { say2(say(e, state.origin), 'bad') } }; acts.appendChild(b) }
        else box.appendChild(el('div', 'muted', `in your Solana wallet on this computer: send ${sendAmt} ${state.origin.coin} to the address above (copy both below).`))
      }
      acts.appendChild(copy('Copy amount', trim(q.amountInFormatted)))
      acts.appendChild(copy('Copy address', q.depositAddress))
      box.appendChild(acts)
      box.appendChild(note)
      const mins = Math.max(0, Math.round((60 * 60e3 - (Date.now() - (state.quotedAt || Date.now()))) / 60e3))
      box.appendChild(el('div', 'muted', state.status ? `status: ${status(state.status.status)}` : `waiting for the deposit… quote good for ${mins} min; NEAR Intents' fees are inside the amount you send`))
      // one tap allows a browser notification when it lands (asked here, on the buyer's own tap)
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') { const al = el('button', 'btn g', 'Alert me when it lands'); al.style.marginTop = '8px'; al.onclick = () => Notification.requestPermission().then(() => render()); box.appendChild(al) }
      const x = el('button', 'btn g', 'Start over'); x.style.marginTop = '8px'; x.onclick = () => { state.quote = null; state.status = null; state.note = null; render() }; box.appendChild(x)
    }
    const watch = async () => {
      while (state.quote) {
        try { state.status = await j(`/v0/status?depositAddress=${encodeURIComponent(state.quote.quote.depositAddress)}${state.quote.quote.depositMemo ? `&depositMemo=${encodeURIComponent(state.quote.quote.depositMemo)}` : ''}`); render() } catch {}
        if (state.status && ['SUCCESS', 'REFUNDED', 'FAILED'].includes(state.status.status)) {
          // a system notification when the tab is hidden and allowed
          try { if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(state.status.status === 'SUCCESS' ? 'Paid' : status(state.status.status), { body: `${o.label || 'Payment'}: ${status(state.status.status)}` }) } catch {}
          if (o.onPaid) o.onPaid(state.status, state.quote); return
        }
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    render()
    return { get status() { return state.status } }
  }
  window.NearlyCheckout = { mount, ORIGINS }
  const auto = () => document.querySelectorAll('[data-nearly-checkout]').forEach((h) => { if (h.__nc) return; h.__nc = mount(h, { recipient: h.dataset.recipient, asset: h.dataset.asset, usd: h.dataset.usd, amount: h.dataset.amount, label: h.dataset.label, buyer: h.dataset.buyer, referral: h.dataset.referral }) })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto()
})()
