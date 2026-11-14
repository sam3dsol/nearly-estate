# The keys server runs where nobody can read it

A viewing key hides a trading account. The seller's account and its salt sit in the keys server's data, and so does the secret behind every feed token. Running that server on an ordinary VM means the team could read who is behind a key. So the keys server runs inside a confidential VM: Intel TDX through Phala Cloud (dstack). The CPU encrypts the VM's memory, the disk is encrypted with a key that exists only inside the enclave, and the hardware signs a statement of exactly what booted. Anyone can check that statement. The host (Phala) and the team's other servers cannot read the enclave's memory or disk; what the code inside does with the data is fixed by the image this repo pins, which `npm run attest` checks.

Endpoint: https://10c7e8fdb53c82a2ed4be287b97e0149c434dd90-8830.dstack-pha1-prod5.phala.network
compose-hash: `aff1e64ad94eb38ed9bf5f27dc69410b21808ac4c91a25fe3c752f56b25961c1`
image digest: `sha256:f4315f4a2baa6cec4edf4f5dc8a7ca804e7c74d4020a05608600175756cee5ea`

## Verify it

```
npm run attest          # node ops/attest.mjs: 6 checks, public endpoints, no keys, ~5 s
```

What it proves, in order:

1. The server answers with a TDX **quote**: a hardware-signed report from the Intel CPU the enclave runs on.
2. The quote's event log carries a **compose-hash**, and the enclave's `/info` carries the `docker-compose.yml` it booted with (wrapped as app-compose by dstack).
3. `sha256(app-compose)` equals that compose-hash. The hardware measured the compose file at boot and extended it into RTMR3, so the file cannot be swapped afterwards without breaking the quote.
4. The compose-hash equals the one pinned above, so it is **this** compose: the image built from this repo's `Dockerfile` (pinned by digest), the data volume on the encrypted disk, the attestation sidecar, nothing else.
5. The quote is signed by genuine Intel TDX hardware (checked through Phala's verifier; `dcap-qvl` from the Phala trust-center repo gives the same answer offline, against Intel's collateral).
6. The 32 random bytes the checker sent are inside the quote's report data, so it was produced for this check, not replayed.

## What is inside and what is not

- Inside the enclave only: `keys.json` (hidden accounts and salts), `pages.json`, `reviews.json`, `settled.json`, `resolutions.json`, `agents.json` (mandates and knowledge bases), the feed-token HMAC secret (drawn at start, never stored, never passed in), the NEAR AI key and the operator's function-call key (passed as encrypted environment, decrypted only in the enclave). Plainly: the team keeps its own copies of those two keys outside the enclave, to redeploy it; what nobody outside can read is the data above (hidden accounts, salts, the feed secret), which never leaves it.
- Outside, unchanged: the contract on mainnet, which holds the commitment `sha256(hidden:salt)` for every key, the prices, the markets and the swarm; nearly.trade's public API, which the server reads like anyone else.
- What this does not cover: the NEAR Intents Agent API backend (the agents' wallets) still runs on the server; the three judges and the agents' models already run in NEAR AI Cloud's TEEs and sign their receipts.

## Moving in

The server's tables were moved in once, through a one-time import (`ops/tee-import.mjs`, with an `ADMIN_TOKEN` sealed into the enclave). So the hidden accounts of the two keys registered before the move had existed outside it, and keys 1 and 2 were registered again from inside: the sellers ran the register flow against the enclave's endpoint (`register_key` on chain with a fresh commitment, `reveal_key` retiring the old one). Anyone's key works the same way from the Keys page.
