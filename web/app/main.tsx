// The Nearly Estate pages on their own: the same page files nearly.trade serves, mounted with a router and a small bar.
// On the site they sit inside the nearly.trade app; here web/lib, web/data and web/brand.ts hold just enough of it to run them.
import { StrictMode, Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router'
import '@fontsource-variable/geist'
import './app.css'
import { applyAccent } from '../lib/accent'
import { applyMode } from '../lib/theme'
import { short } from '../lib/format'
import { WalletProvider, useWallet } from '../lib/wallet'

const Wiki = lazy(() => import('../pages/Wiki').then((m) => ({ default: m.Wiki })))
const Keys = lazy(() => import('../pages/Keys').then((m) => ({ default: m.Keys })))
const KeyPage = lazy(() => import('../pages/KeyPage').then((m) => ({ default: m.KeyPage })))
const Swarm = lazy(() => import('../pages/Swarm').then((m) => ({ default: m.Swarm })))
const Agents = lazy(() => import('../pages/Agents').then((m) => ({ default: m.Agents })))
const Checkout = lazy(() => import('../pages/Checkout').then((m) => ({ default: m.Checkout })))
const Estate = lazy(() => import('../pages/Estate').then((m) => ({ default: m.Estate })))

/** the site's header, cut to the wordmark and the wallet (each page carries the Estate tabs) */
function Bar() {
  const { accountId, ready, signIn, signOut } = useWallet()
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 md:px-12">
        <Link to="/" className="shrink-0 text-[20px] font-semibold tracking-[-0.02em] text-fg">Nearly Estate</Link>
        <button
          onClick={() => (accountId ? void signOut() : signIn())}
          disabled={!ready}
          title={accountId ? 'Disconnect' : undefined}
          className="ml-auto shrink-0 rounded-full border border-line px-4 py-2 text-[14px] font-medium text-fg transition-colors hover:border-line-2 disabled:opacity-50"
        >
          {accountId ? short(accountId, 8) : 'Connect wallet'}
        </button>
      </div>
    </header>
  )
}

/** a link into the rest of nearly.trade (a token, a trader): those pages are not part of this repo */
function Elsewhere() {
  const { pathname, search } = useLocation()
  return (
    <div className="mx-auto max-w-[720px] px-6 pt-32 text-[15px] text-fg-2">
      <p className="text-fg">{pathname} is a nearly.trade page outside the Estate.</p>
      <p className="mt-2"><a className="text-accent underline" href={`https://nearly.trade${pathname}${search}`}>Open it on nearly.trade</a> or go back to the <Link className="text-accent underline" to="/wiki">wiki</Link>.</p>
    </div>
  )
}

function ScrollTop() { const { pathname } = useLocation(); useEffect(() => { window.scrollTo(0, 0) }, [pathname]); return null }

applyMode()
applyAccent()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <ScrollTop />
        <Bar />
        <main>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Estate />} />
              <Route path="/wiki" element={<Wiki />} />
              <Route path="/wiki/:token" element={<Wiki />} />
              <Route path="/wiki/m/:id" element={<Wiki />} />
              <Route path="/keys" element={<Keys />} />
              <Route path="/keys/:token" element={<KeyPage />} />
              <Route path="/swarm" element={<Swarm />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="*" element={<Elsewhere />} />
            </Routes>
          </Suspense>
        </main>
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>,
)
