import { useEffect, useRef, useState } from 'react'
import { ChatCircleDots, X, PaperPlaneRight } from '@phosphor-icons/react'
import { useLocation } from 'react-router'
import { useWallet } from '../lib/wallet'

// the Estate helper, bottom right of every Estate page.
// It answers from the guide through /api/ask (NEAR AI, 400 answers a day for everyone); every answer links the guide.
type Msg = { role: 'user' | 'assistant'; content: string }
const STARTERS = ['How do I sell my key?', 'What does a Swarm bid cost?', 'How do I bet on the wiki?', 'What can my agent not do?']
const HELLO = 'Ask me anything about the five products. Short answers, from the guide.'
export function Ask() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  // the connected account and the page go with each question;
  // the server reads the account's public state (balance, key sold and held, wiki positions, swarm bids)
  const { accountId } = useWallet()
  const { pathname } = useLocation()
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy, open])
  // away while the page scrolls down,
  // back on the first scroll up; never while the panel is open
  const [away, setAway] = useState(false)
  useEffect(() => {
    let last = window.scrollY
    const on = () => { const y = window.scrollY; if (Math.abs(y - last) < 6) return; setAway(y > last && y > 80); last = y }
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const send = async (text: string) => {
    const t = text.trim(); if (!t || busy) return
    setQ(''); setBusy(true)
    const history = msgs.slice(-6)
    setMsgs((m) => [...m, { role: 'user', content: t }])
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: t, history, account: accountId || undefined, page: pathname }) })
      const j = (await r.json().catch(() => ({}))) as { answer?: string; error?: string }
      setMsgs((m) => [...m, { role: 'assistant', content: j.answer || j.error || 'No answer came back. The guide is at /docs#keys' }])
    } catch { setMsgs((m) => [...m, { role: 'assistant', content: 'Could not reach the helper. The guide is at /docs#keys' }]) } finally { setBusy(false) }
  }
  // paths in an answer become links
  const rich = (s: string) => s.split(/(\/(?:docs|keys|swarm|wiki|agents|checkout|picks|trust|estate)(?:[/#][\w/#-]*)?)/g).map((p, i) => (i % 2 ? <a key={i} href={p}>{p}</a> : p))
  return (
    <>
      <button type="button" className={`mk-ask-fab${open ? ' on' : away ? ' away' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Close the helper' : 'Ask about the Estate'}>
        {open ? <X size={18} weight="bold" /> : <ChatCircleDots size={20} weight="fill" />}<span>{open ? 'Close' : 'Ask'}</span>
      </button>
      {open && (
        <div className="mk-ask" role="dialog" aria-label="Estate helper">
          <div className="mk-ask-head"><b>Estate helper</b><span>{accountId ? `answers from the guide and ${accountId}'s own keys, bets and balance` : 'answers from the guide · connect a wallet for your own keys, bets and balance'} · <a href="/docs#keys">read it</a></span></div>
          <div className="mk-ask-log">
            <div className="a">{HELLO}</div>
            {msgs.map((m, i) => <div key={i} className={m.role === 'user' ? 'u' : 'a'}>{m.role === 'user' ? m.content : rich(m.content)}</div>)}
            {busy && <div className="a dim">thinking…</div>}
            {!msgs.length && <div className="mk-ask-starters">{STARTERS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>}
            <div ref={end} />
          </div>
          <form className="mk-ask-row" onSubmit={(e) => { e.preventDefault(); send(q) }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={400} placeholder="Your question" aria-label="Your question" autoFocus />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Send"><PaperPlaneRight size={16} weight="fill" /></button>
          </form>
        </div>
      )}
    </>
  )
}
