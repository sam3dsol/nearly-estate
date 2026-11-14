// The repo's NEAR RPC: FastNEAR's paid endpoint with the Estate key, so every check here runs on it with no setup.
// NEAR_RPC (and NEAR_ARCHIVAL_RPC) still override it.
export const KEY = '21fd4c27ca2f75b1f7525268d7126f141c61c887c079dd9d7b3c74203068eff6'
export const RPC = process.env.NEAR_RPC || `https://rpc.mainnet.fastnear.com?apiKey=${KEY}`
export const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC || `https://archival-rpc.mainnet.fastnear.com?apiKey=${KEY}`
/** FastNEAR's transaction index takes the same key as a Bearer header */
export const fxHeaders = (url) => (String(url).startsWith('https://tx.main.fastnear.com') ? { authorization: `Bearer ${KEY}` } : {})
