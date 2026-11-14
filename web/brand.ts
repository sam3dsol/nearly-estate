// One place to rename the product. Everything reads from here.
export const BRAND = {
  name: 'Nearly',
  wordmark: 'nearly',
  tagline: 'nearly.trade',
  domain: 'nearly.trade',
  x: 'https://x.com/nearlytrade',
  tg: 'https://t.me/NearlyTrade',
  email: 'hello@nearly.trade',
} as const

export type Network = 'testnet' | 'mainnet'
export const NETWORK: Network = (import.meta.env.VITE_NETWORK as Network) || 'testnet'

export const NET = {
  testnet: {
    factory: 'dcl.nearpad-dev-4804.testnet',
    dcl: 'dclv2.ref-dev.testnet',
    wnear: 'wrap.testnet',
    rpc: ['https://near-testnet.drpc.org', 'https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com'], // public only; keyed endpoints never ship in the bundle
    explorer: 'https://testnet.nearblocks.io',
    rhea: 'https://testnet.rhea.finance',
  },
  mainnet: {
    factory: 'nearlytrade.near',
    dcl: 'dclv2.ref-labs.near',
    wnear: 'wrap.near',
    rpc: ['https://nearly.trade/api/rpc'], // our same-origin RPC proxy; the keyed endpoint stays server-side, never in the bundle
    explorer: 'https://nearblocks.io',
    rhea: 'https://dex.rhea.finance',
  },
}[NETWORK]

export const TOKEN_DECIMALS = 18
export const NEAR_DECIMALS = 24
export const SUPPLY = 1_000_000_000

/** King of the Hill: the market cap a token has to hold to take the hill. */
export const KOH_USD = 30_000
