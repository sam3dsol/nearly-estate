# Will it last?

Measured on the morning of Nov 14, 2026 (399 markets then; the README's live numbers are from the evening), 10 days after the contract's first transaction (Nov 4). NEAR at $3.39. Every on-chain number is a view call on `keys.nearlyops.near` anyone can repeat.

## The short answer

Nobody's money needs the server: if it stopped tomorrow, every position could still be closed or paid with contract calls alone, and anyone can run the server from this repository. Users pay the variable costs themselves, and rulings and pages cost a fraction of a cent, paid from the 1% fee once a market trades. What is left is a fixed cost of about $70 a month, which about $7,000 of bets a month covers. It earns less than that today, and this page says by how much.

## Each action pays its own way

| Action | What the user pays | What it costs to serve |
|---|---|---|
| A bet or a sale on a market | 1% fee | gas only, paid by the user |
| A new market | 0.02 wNEAR for its own storage | the storage it pays for |
| A ruling by the 3 judges | nothing extra | about $0.003, covered by the fee on about $0.30 of bets on that market |
| A page version | nothing extra | about $0.005, covered by the fee on about $0.50 of bets on that page's markets |
| A swarm job | its own AI inference, capped by the poster and charged on chain call by call | nothing beyond what it pays |
| A hired agent | its own model calls, at most 0.05 wNEAR a day | nothing beyond what it pays |
| A key sale | 1% fee | gas only, paid by the buyer |

A market nobody trades still costs its ruling, about $0.003. The other costs users do not pay are the confidential VM and the house agents' views.

## What it costs

| | Per month at today's pace | Source |
|---|---|---|
| Confidential VM, Phala Cloud tdx.small (1 vCPU, 2 GB, 20 GB, the size in use) | $43 | Phala's public price, $0.06 an hour |
| NEAR AI Cloud, steady part: the house agents' views, the three judges' rulings, reviews | about $9 | call counts × list price (DeepSeek $0.30/$1.20 per M tokens); about $0.30 a day |
| Gas for the server's relay key | about $20 | measured on chain: 0.60 NEAR in the 3 days to Nov 14 (1,481 transactions), about 6 NEAR a month at $3.39; the relay key posts the rulings, settles markets and places the house agents' trades |
| RPC | $0 added | the FastNEAR plan the nearly.trade launchpad already pays for |
| **Running cost** | **about $70** | |

One-off so far:
- **AI:** under $15 of NEAR AI credit from Nov 4 to 12 (not re-read on Nov 14), mostly writing about 100 page versions and two model benchmark runs (estimate from call counts; the exact figure is on the NEAR AI dashboard).
- **Gas:** about 0.1 NEAR for 23 contract versions.

The site itself runs on the existing nearly.trade server, shared with the token launchpad, and is not counted.

## What it earned

| | NEAR | Source |
|---|---|---|
| Trade fees: 1% of every bet and sale | 0.148 | sum of `fees` over `get_markets` (399 markets) |
| Key fees: 1% of key sales (0.44 NEAR sold) | 0.004 | `get_keys`: price × sold |
| Hired desks paying for their own model calls | 0.061 | the treasury less the two lines above and the storage fees |
| **Earned** | **0.213 (about $0.72)** | |

Not income, so not counted:
- **Storage:** each new market pays 0.02 wNEAR for its own storage, 7.98 wNEAR over 399 markets (`get_config` treasury 8.19 = storage + fees + desk charges).
- **AI paid by users:** swarm jobs paid 0.087 NEAR for their own AI inference, charged on chain call by call.
- **Agents' earnings:** agents earned 2.32 NEAR from 13 approved jobs.

## Break-even

At a 1% fee, about **$7,000 a month of bets and sales** (about $235 a day) pays the running cost. In its first 10 days the wiki traded 14.6 NEAR, about $50, about 2% of that pace. This is a hackathon week, not a business yet.

What that pace looks like: 120 users a day betting about $2 each, or one busy topic a day.

## Why it can last anyway

1. **Costs follow use.** The table above: what a user does is paid by that user or by the fee on their trades.
2. **No token and no emissions.** The house money is on chain for anyone to read: the wiki fund that seeds new markets, and the house AI agents' bets.
3. **Nobody's money depends on the operator.**
   - Anyone can call `finalize`, or `void_market` on a dated market with no ruling 7 days after its date.
   - A holder calls `redeem` and `claim_owed` for their own payout.
   - Desks, agents, jobs and stakes are withdrawn by their own owners.
   - An open market can be sold back at its price until its date; after the date its ruling pays, or anyone voids it 7 days later.

   If the server stopped tomorrow, every position could still be closed or paid by contract calls alone; a challenged market waits at most 72 hours for the judges' final look, then anyone can finalize it.
4. **Anyone can run the server.** The enclave image is built from a clean archive of this repository (`Dockerfile`, `docker-compose.yml`). Its attestation is checked with `npm run attest`.
5. **The fixed cost is small enough to carry.** About $70 a month is one VM, the house agents and gas. It can run at today's volume for as long as it takes.

## What closes the gap

These are not built yet:
- **Checkout fee:** a fee through 1Click's app fee, for example 0.2% of each payment.
- **Swarm share:** a share of each swarm job.
- **Cheaper house agents:** let them re-view only the markets traded that day. That cuts most of the steady AI cost.
- **Sponsors:** let sponsors seed the wiki fund for their topics.

At 0.2% of checkout volume, $1,000 of payments a day would cover the VM on its own.
