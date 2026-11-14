import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The pages read live data: /api (and its websocket feed) and the checkout widget go to nearly.trade, as do the static files the
// pages point at and this repo does not carry (the wiki's art and serif font, wallet logos). `vite preview` uses the same proxy.
const LIVE = 'https://nearly.trade'
const live = { target: LIVE, changeOrigin: true, ws: true, headers: { origin: LIVE, referer: `${LIVE}/` } }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @solana/web3.js (loaded only for a Solana deposit) reads `global`
  define: { global: 'globalThis' },
  server: { proxy: { '/api': live, '/widget': live, '/wiki-art': live, '/fonts': live, '/logos': live } },
  build: { target: 'es2022' },
})
