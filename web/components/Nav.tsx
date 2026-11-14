import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { ChartBar, RocketLaunch, TrendUp, Fire, Wallet, XLogo, TelegramLogo, Lightning, MagnifyingGlass, CaretDown, HandCoins, Coins, Intersect, ChartLineUp, DotsThreeOutline, Cube, Ticket, Sun, Moon, Key, Robot, BookOpenText, ShoppingCart } from '@phosphor-icons/react'
import { Mark } from './Mark'
import { ThemePanel } from './AccentPicker'
import { mode, onModeChange, setMode, type Mode } from '../lib/theme'
import { WalletMenu } from './WalletMenu'
import { PhantomMenu } from './PhantomMenu'
import { SolLinkNote } from './SolPicker'
import { BRAND, NETWORK } from '../brand'
import { useWallet } from '../lib/wallet'
import { refreshLaunches } from '../data/useLaunches'
import { useRheaClaims } from '../lib/rheaClaims'
import { useLimitOrders } from '../lib/limitClaims'

// Board opens /board (the board alone); / is the hero homepage, reached by the logo
// the pill was too full (it ran into the wallet button when logged in), so Stocks, Burn and Referrals moved under More
// Multichain in the pill, Portfolio first under More
// Builders in the pill, Multichain moved under More
const ITEMS: [string, string, boolean][] = [['/board', 'Board', true], ['/launch', 'Launch', false], ['/presales', 'Presales', false], ['/analytics', 'Analytics', false], ['/feed', 'Feed', false], ['/builders', 'Builders', false]]
const MORE: [string, string, typeof ChartBar][] = [['/keys', 'Keys', Key], ['/swarm', 'Swarm', Robot], ['/wiki', 'Wiki', BookOpenText], ['/agents', 'Agents', Robot], ['/checkout', 'Checkout', ShoppingCart], ['/portfolio', 'Portfolio', Wallet], ['/multichain', 'Multichain', Intersect], ['/stocks', 'Stocks', TrendUp], ['/burn', 'Burn', Fire], ['/referral', 'Referrals', HandCoins], ['/rewards', 'Rewards', Coins]]
const PILL = 'display rounded-full px-2.5 py-2 text-[14px] font-medium min-[1440px]:px-4 min-[1440px]:text-[15px] tracking-[-0.005em] transition-colors'
const TokenSearch = lazy(() => import('./TokenSearch').then((m) => ({ default: m.TokenSearch })))
/** Hover or focus on a search button starts the chunk and the token list, so the panel opens full instead of loading. */
let warmed = false
// the warm-up also starts the user list (trader boards), so the panel opens with people in
const warm = () => { if (warmed) return; warmed = true; void import('./TokenSearch').then((m) => m.warmUsers()); refreshLaunches() }

export function Nav() {
  const { accountId, ready, signIn } = useWallet()
  const rhea = useRheaClaims(accountId) // tokens waiting in this wallet's Rhea balance (portfolio has Claim all)
  const lim = useLimitOrders(accountId) // limit orders with something filled, waiting for Claim (portfolio #orders)
  const toClaim = rhea.items.length + lim.ready.length
  // token search: ⌘K / Ctrl+K anywhere, or "/" when not typing
  const [find, setFind] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) { e.preventDefault(); setFind(true) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-[2px]">
      <div className="relative mx-auto flex h-[68px] max-w-[1640px] items-center px-5 md:px-7">
        <Link to="/" className="flex items-center gap-2.5 text-fg" aria-label={BRAND.name}>
          <Mark size={27} />
          <span className="display text-[23px] font-semibold tracking-[-0.015em]">{BRAND.wordmark}<span className="text-accent">.</span></span>
        </Link>
        {/* a real bar only where it fits between the logo and the centred pill (1440+); below that it is the icon on the right */}
        {/* the mono label (165 px) left no room in the 200 px row, so the / badge sat on the pill border at 1440; shorter label, 8 px wider pill, and the span truncates rather than pushing the badge out */}
        <button onClick={() => setFind(true)} onPointerEnter={warm} onFocus={warm} className="ml-4 hidden h-9 w-[236px] items-center gap-2 whitespace-nowrap rounded-full border border-edge bg-white/[0.03] px-3.5 text-[12.5px] text-fg-3 transition-colors hover:border-fg-2 hover:text-fg min-[1440px]:flex">
          <MagnifyingGlass size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate text-left">Search tokens, users</span><kbd className="num rounded-[4px] border border-line px-1.5 text-[10.5px] leading-[18px]">/</kbd>
        </button>
        {/* Centred in the header, not trailing the logo: the pill is the page's anchor, and a
            sentence-case sans label reads as navigation rather than as a data column header. */}
        {/* from md to xl the pill sits in the flow between the logo and the
            wallet keys (mx-auto), so it can never run under them; from xl it is centred on the header as before */}
        <nav className="mx-auto hidden items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.045] p-1.5 backdrop-blur-sm md:flex xl:absolute xl:left-1/2 xl:mx-0 xl:-translate-x-1/2" aria-label="Primary">
          {ITEMS.map(([to, label, end]) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={(e) => e.currentTarget.blur()}
              className={({ isActive }) => `${PILL} ${isActive ? 'bg-fg/[0.1] text-fg' : 'text-fg-2 hover:bg-fg/[0.07] hover:text-fg'}`}
            >
              {label}
            </NavLink>
          ))}
          <MoreMenu />
        </nav>
        {/* 8 px tighter on phones so NEAR + Phantom keys fit a 360 px screen */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
          <button onClick={() => setFind(true)} onPointerEnter={warm} onFocus={warm} title="Search tokens or users (/)" aria-label="Search tokens or users" className="flex size-9 items-center justify-center rounded-sm border key-i min-[1440px]:hidden"><MagnifyingGlass size={17} weight="bold" /></button>
          {/* one tap flips light and dark; the full picker stays under More */}
          <ThemeKey />
          <a href={BRAND.x} target="_blank" rel="noreferrer" title="Follow @nearlytrade on X" aria-label="Follow @nearlytrade on X" className="hidden size-9 items-center justify-center rounded-sm border key-i sm:flex md:hidden xl:flex"><XLogo size={16} weight="bold" /></a>
          <a href={BRAND.tg} target="_blank" rel="noreferrer" title="Join the Nearly Telegram" aria-label="Join the Nearly Telegram" className="hidden size-9 items-center justify-center rounded-sm border key-i sm:flex md:hidden xl:flex"><TelegramLogo size={17} weight="bold" /></a>
          {NETWORK === 'testnet' && <span className="lbl hidden items-center gap-1.5 text-fg-3 md:inline-flex"><span className="inline-block size-1.5 rounded-full bg-accent" />testnet</span>}
          {accountId && toClaim > 0 && (
            <Link to={rhea.items.length ? '/portfolio#rhea' : '/portfolio#orders'} title={lim.ready.length ? 'Filled limit orders and tokens waiting for you on Rhea: claim them in one approval' : 'Tokens waiting for you on Rhea: claim them in one approval'} className="btn-a px-4">Claim {toClaim}</Link>
          )}
          <PhantomMenu />
          <SolLinkNote />
          {accountId ? (
            <WalletMenu tight={toClaim > 0} />
          ) : (
            <button onClick={signIn} disabled={!ready} className="btn-a px-5 disabled:opacity-50">Connect</button>
          )}
        </div>
      </div>
      {find && <Suspense fallback={null}><TokenSearch onClose={() => setFind(false)} /></Suspense>}
    </header>
  )
}

/** the header's light / dark key: follows the mode live (the picker under More changes it too) */
function ThemeKey() {
  const [m, setM] = useState<Mode>(() => mode())
  useEffect(() => onModeChange(setM), [])
  const light = m === 'light'
  return (
    <button type="button" onClick={() => setMode(light ? 'black' : 'light')} title={light ? 'Switch to dark' : 'Switch to light'} aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'} className="hidden size-9 items-center justify-center rounded-sm border key-i sm:flex">
      {light ? <Moon size={17} weight="bold" /> : <Sun size={17} weight="bold" />}
    </button>
  )
}

/** Portfolio, Stocks, Burn, Referrals + the theme: opens on hover with a mouse, on tap otherwise */
function MoreMenu() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const shut = useRef<number | undefined>(undefined)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const on = MORE.some(([to]) => pathname.startsWith(to))
  return (
    <div ref={box} className="relative"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { clearTimeout(shut.current); setOpen(true) } }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') shut.current = window.setTimeout(() => setOpen(false), 180) }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={`${PILL} flex items-center gap-1.5 ${on || open ? 'bg-fg/[0.1] text-fg' : 'text-fg-2 hover:bg-fg/[0.07] hover:text-fg'}`}>
        More<CaretDown size={12} weight="bold" className={`text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="wm-in absolute right-0 top-full z-50 pt-3">
          <div className="w-[240px] rounded-sm border border-line bg-bg-1 p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]">
                        {MORE.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} role="menuitem"
                className={({ isActive }) => `display flex items-center gap-3 rounded-[6px] px-3 py-2.5 text-[14.5px] font-medium transition-colors ${isActive ? 'bg-fg/[0.08] text-fg' : 'text-fg-2 hover:bg-fg/[0.06] hover:text-fg'}`}>
                <Icon size={17} className="shrink-0 text-fg-3" />{label}
              </NavLink>
            ))}
            <ThemePanel />
          </div>
        </div>
      )}
    </div>
  )
}

/** Phones: the header has room for the logo and Connect only, so the sections live in a tab bar at the
 *  thumb, the way every trading app does it. Hidden from md up, where the centred pill takes over. */
// 4 tabs + More, which opens the rest above the bar. Multichain icon = Intersect
// Builders in the bar, Multichain under More (same as the desktop pill)
// a usability round: Portfolio in the bar, Builders under More
const TABS: [string, string, boolean, typeof ChartBar][] = [['/board', 'Board', true, ChartBar], ['/feed', 'Feed', false, Lightning], ['/launch', 'Launch', false, RocketLaunch], ['/portfolio', 'Portfolio', false, Wallet]]
const TAB_MORE: [string, string, typeof ChartBar][] = [['/keys', 'Keys', Key], ['/swarm', 'Swarm', Robot], ['/wiki', 'Wiki', BookOpenText], ['/agents', 'Agents', Robot], ['/checkout', 'Checkout', ShoppingCart], ['/builders', 'Builders', Cube], ['/presales', 'Presales', Ticket], ['/multichain', 'Multichain', Intersect], ['/analytics', 'Analytics', ChartLineUp], ['/stocks', 'Stocks', TrendUp], ['/burn', 'Burn', Fire], ['/referral', 'Referrals', HandCoins], ['/rewards', 'Rewards', Coins]]
export function TabBar() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  const moreOn = open || TAB_MORE.some(([to]) => pathname.startsWith(to))
  const cell = (on: boolean) => `flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold tracking-[0.02em] transition-colors ${on ? 'text-accent' : 'text-fg-3 active:text-fg'}`
  return (
    <nav ref={box} aria-label="Sections" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.35)] md:hidden">
      {open && (
        <div role="menu" className="wm-in absolute bottom-full right-2 mb-2 w-[240px] rounded-sm border border-line bg-bg-1 p-1.5 shadow-[0_-18px_40px_-12px_rgba(0,0,0,0.9)]">
          {TAB_MORE.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} role="menuitem"
              className={({ isActive }) => `display flex items-center gap-3 rounded-[6px] px-3 py-3 text-[15px] font-medium transition-colors ${isActive ? 'bg-fg/[0.08] text-fg' : 'text-fg-2 active:bg-fg/[0.06]'}`}>
              <Icon size={18} className="shrink-0 text-fg-3" />{label}
            </NavLink>
          ))}
          <ThemePanel />
        </div>
      )}
      <div className="mx-auto grid h-[60px] max-w-[560px] grid-cols-5">
        {TABS.map(([to, label, end, Icon]) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cell(isActive)}>
            {({ isActive }) => (<><Icon size={21} weight={isActive ? 'fill' : 'regular'} /><span>{label}</span></>)}
          </NavLink>
        ))}
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cell(moreOn)}>
          <DotsThreeOutline size={21} weight={moreOn ? 'fill' : 'regular'} /><span>More</span>
        </button>
      </div>
    </nav>
  )
}
