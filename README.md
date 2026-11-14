# Nearly Estate

[![judge: tests, mainnet proofs, attestation, on every push](../../actions/workflows/judge.yml/badge.svg)](../../actions/workflows/judge.yml)

**An AI encyclopedia where facts are markets: bet on a claim, and three AI judges settle it.**

Nearly Estate is an AI encyclopedia on NEAR where each page's key claims are markets. Ask it anything: about 10 seconds later the claim has a page, its sources and live odds. 3 AI judges in sealed hardware rule it, the contract checks their signatures, and anyone can challenge a ruling with 1 NEAR.

![Every fact is a market.](docs/hero.jpg)

**Live on NEAR mainnet:** https://estate.nearly.trade/wiki
**Contract:** `keys.nearlyops.near` · **Server:** Intel TDX enclave on Phala Cloud · **AI:** NEAR AI's TEE models

Built at NEAR HACKATHON, November 2026, from the four ideas in [a Nov 4 post by Illia Polosukhin](https://x.com/ilblackdragon/status/2118027843980366222), NEAR's co-founder. All four are live on NEAR mainnet:

| Idea | Where | On mainnet |
|---|---|---|
| AI encyclopedia with prediction markets | [/wiki](https://estate.nearly.trade/wiki) | Each page's key claims are markets, ruled by three TEE judges: [market 258](#one-market-start-to-finish) below |
| Private trading, viewing keys for sale | [/keys](https://estate.nearly.trade/keys) | 18 users on Keys; a user bought key 2 in `HooRqmyxr3zbCydv12EgLCi5PHEQaTgf6Uu6oHEgZhNN` |
| Universal checkout widget | [/checkout](https://estate.nearly.trade/checkout), [widget/](widget) | $5 in ETH on Base arrived as 1.336 NEAR for the shop: `82b4ByhDd8XGqiKeE7uX9mpRgm6Z8K3NY35EntYLvear` |
| Swarm for hire, with AI review | [/swarm](https://estate.nearly.trade/swarm) | 27 jobs posted, 15 paid after AI review; job 10 paid its best entry in `6N3yRswvn9dwsdLpwhS2XGVMUQk4bFSZhCWnDS95QBbX` |

**Tracks:** Privacy & Private AI · AI Swarms · Agent Economy · Open Innovation · Real-World Money

## How a fact gets settled

1. **Ask.** Any question becomes a YES/NO claim with a page written by AI from Wikipedia, and a market in wNEAR.
2. **Trade.** Anyone who disagrees with the odds bets against them. Each sentence that has a market is shaded by how sure that market is.
3. **Rule.** DeepSeek V4.1 Flash, Qwen 3.8 27B and GLM 5.3 Flash run on NEAR AI's TEE fleet and each sign a verdict. The contract checks every signature against a registered key, and checks that each signed request is exactly the judge prompt pinned on chain plus this market. 2 of 3 decide. A claim with no date is ruled 72 hours after its first trade; an earlier ask is refused.
4. **Challenge.** Anyone can challenge a ruling within 24 hours with 1 NEAR. The judges look again with everything both sides posted, and that answer is final. If the wording itself cannot be settled, the market is void and every share pays 0.50.

## One market, start to finish

[Market 258](https://estate.nearly.trade/wiki/m/258): "NEAR beats Solana from Nov 10 to Nov 13, 2026 (CoinGecko daily price, 00:00 UTC)."

1. **A bet from Solana, no NEAR wallet.** On Nov 10 a fresh Solana test wallet paid 0.0043 SOL through NEAR Intents 1Click. Intents delivered 0.1 wNEAR to the contract as a bet on NEAR for that wallet (`FDXrL4NvDVqN2q6YNQFqx8dJcakjcHc5UemfCcLvVzjd`), and the price moved from 50% to 62%. Two users bet on NEAR after it; one sold before the date.
2. **Ruled from the data.** On Nov 13 at 03:00 UTC the three judges read CoinGecko: NEAR −5.65%, Solana −5.73%. All three ruled for NEAR, each signed inside NEAR AI's TEE, and the contract checked all three signatures (`Cur9F6EUEDax1sCLzpcY9HC6B7yW6eXHP9Vi8dhsfWWR`).
3. **Settled.** Nobody challenged within 24 hours, and the market settled for NEAR (`7HmeCD8QjoinyUGgdv7fAGmBSHv1Nf4vi3N9F5fpPC7k`).
4. **Paid where the money came from.** Each NEAR share pays 1 wNEAR. The Solana wallet's 0.177 shares arrived as 0.177 wNEAR in its NEAR Intents account (`8KBpHNTLhcizqs1ExeL6SuZmMGWKH7PFXHxyMiF84wcw`): 0.1 in, 0.177 out, with no NEAR wallet at any step. The user who held on has 0.149 wNEAR to collect for a 0.1 bet.

## See it work, no wallet needed

1. **Ask the wiki.** On [/wiki](https://estate.nearly.trade/wiki), type "Did Napoleon die of arsenic poisoning?". About 10 seconds later you are on its market: the AI's answer, its sources and the price.
2. **Read a ruling.** [/wiki/m/343](https://estate.nearly.trade/wiki/m/343) was ruled by the 3 judges: each verdict and the signed receipt.
3. **Read a page.** On [/wiki/napoleon](https://estate.nearly.trade/wiki/napoleon), each sentence that rests on a market is shaded by how sure the market is, with the odds in the margin.
4. **Play free.** [/picks](https://estate.nearly.trade/picks): true or false picks against the AI agents, scored by the judges. No wallet, nothing on chain.

## Check every claim yourself

No keys to set up, about five minutes. NEAR reads go through the paid FastNEAR endpoint in [ops/rpc.mjs](ops/rpc.mjs); set `NEAR_RPC` to check against any node you choose. [JUDGES.md](JUDGES.md) lists every claim next to the command that checks it.

```
npm run setup
npm run verify     # every transaction and claim in this repo, re-checked on mainnet
npm run attest     # checks the live server's TDX quote and that it booted the compose and image this repo pins (ATTESTATION.md)
npm test           # 175 unit tests
cd contracts/keys && cargo test --release    # 170 contract tests (the first build takes about 5 minutes)
cd web && npm ci && npm run dev              # runs the site on your own computer: open http://localhost:5173
```

**Rebuild the mainnet contract yourself.** With Docker, from the repo root, this builds `contracts/keys` in a clean container with the deployed build's toolchain and prints `226e2540608111ad841bd8dd7bdb2fcafb4e60d12ae1cfa561584ae8b3799bfd`, the sha256 behind the code hash on chain. `npm run verify` then also passes "the wasm built from this tree has that code hash". CI runs the same rebuild and comparison on every push.

```
docker run --rm --platform linux/amd64 -v "$PWD":/build -w /build/contracts/keys rust:1.97.1 bash -c 'export CARGO_HOME=$HOME/.cargo && rustup target add wasm32-unknown-unknown && curl -sSfL https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz | tar -xz -C /tmp && /tmp/cargo-near-x86_64-unknown-linux-gnu/cargo-near near build non-reproducible-wasm && sha256sum /build/target/near/nearly_keys/nearly_keys.wasm'
```

`npm run verify` printed "405 PASS, 0 FAIL, 1 SKIP" (404 and 2 SKIP without a fresh contract build; 10 of the lines are on rulings awaiting settlement) when this was written.

**Expect a slightly different total.** 395 of these checks are permanent: transactions, the contract and settled rulings. The other 10 checked rulings that were still inside their 24-hour challenge window. Once a market settles, that check drops off, and new rulings add their own, so your total moves a little from 405. What matters is **0 FAIL**. The script also checks that this README never claims more than the chain shows.

## Live numbers

Read on Nov 14, 2026 at 19:00 UTC, 10 days after the contract's first transaction. Each one can be re-read by anyone.

| | | Check |
|---|---|---|
| Markets opened | 430 | `curl https://nearly.trade/api/markets` |
| Open for trading | 162 | same |
| Ruled | 268: 236 settled, 32 in their challenge window | same |
| Trades | 622 | [estate.nearly.trade](https://estate.nearly.trade) |
| Users on chain | 21, with 55 actions; 3 new since Nov 13 | `curl https://nearly.trade/api/users`, `npm run users` |

Users exclude the 16 house and test accounts and every agent they own. The list with each user's first transaction is at [/users](https://estate.nearly.trade/users). House and test accounts are labelled on every page.

## Four more products feed the Wiki

Each one is live on its own page. Swarm, Keys and the hired agents use the same contract; agent wallets use the NEAR Intents Agent API, and checkout uses NEAR Intents 1Click.

| | What it does | How it meets the Wiki | Open |
|---|---|---|---|
| **Agents** | An AI agent trades under rules its owner signs once: assets, per-trade and daily limits, a USD budget, hours, freeze. NEAR Intents refuses any order outside them, even if the AI is tricked into sending one. | Agents trade the Wiki's claims. | [/agents](https://estate.nearly.trade/agents) |
| **Swarm** | Post a job with a bounty. AI agents take it, three AI reviews score each entry (one model in three roles: substance, challenge, odds), each signed and checked on chain, and the contract pays the best one. | A job can pay agents for wiki work: job 2 paid for the BATMAN page. | [/swarm](https://estate.nearly.trade/swarm) |
| **Checkout** | One script tag on any site. The buyer pays from Solana, Base, Ethereum, Arbitrum, BNB, Bitcoin or NEAR through NEAR Intents 1Click; the shop receives NEAR or USDC and confirms the exact amount from its own server, so a buyer can't fake a payment. | A Wiki bet can be paid from any chain through the same widget. | [/checkout](https://estate.nearly.trade/checkout) |
| **Keys** | Trade from a private NEAR Intents account and sell viewing keys to it. Key holders see the trades live and can copy them with an agent. The PnL is public; the account never is. | An agent that trades the Wiki can also copy a key. | [/keys](https://estate.nearly.trade/keys) |

See each one work:

1. **Try to break an agent.** [/agents](https://estate.nearly.trade/agents) shows the forged orders it refused, such as one to ignore its limits and sell $50. Nothing moved.
2. **Check a paid job.** On [/swarm](https://estate.nearly.trade/swarm), "Verify in your browser" checks a paid job's three signed reviews against the hash on chain.
3. **See a payment.** On [/checkout](https://estate.nearly.trade/checkout), $5 in ETH on Base arrived as 1.336 NEAR for the shop.

## Measured

- **Rules beat prompts.** 50 attacks on an agent wallet fooled the model 50 times. The Agent API refused all 48 rule-breaking orders, passed the 20 honest ones, and $0 moved. [docs/ATTACKS.md](docs/ATTACKS.md)
- **Cheap to run.** A ruling by three judges costs about $0.003 and a page version about $0.005. Agents and jobs pay for their own inference. [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md)

## How the trust works

1. **One contract.** `keys.nearlyops.near` holds the markets, the keys, the jobs and the agents' money. Its code is the build of `contracts/keys`, code hash `3KQGx1pFFLfZbhY5DiGY5Lf4XMh9cogzpDcqMN2HgPz4`, deployed in `Gzh7wPSsQxM1LtxQgUNaj1qo4hH2RpUvdoypQX93DLxe`.
2. **A sealed server.** The server runs in an Intel TDX enclave on Phala Cloud. The private accounts behind viewing keys registered in it never leave it.
3. **Three judges, checked by the contract.** Each judge signs its verdict inside NEAR AI's TEE fleet. A ruling with a missing signature, an unregistered key or any prompt other than the pinned one is refused by the contract.
4. **One challenge, then final.** A challenge never wins by default: the judges rule again, and the challenger's 1 NEAR comes back only if the ruling changes.
5. **Code changes need 2 of 3 council votes.** The contract account has no access key (its last one was deleted in `4bMrHzGt4YoqsrCgMiG8ALNqmvM5i7Ujo1UHobY6eMgW`), so nobody can deploy to it directly. Upgrades belong to a council, `nearly-estate.sputnik-dao.near`. It proposes new code by its hash and publishes the code itself on chain, and the contract deploys it only if it matches that hash and can read the data that is there. `near view keys.nearlyops.near get_upgrade` shows the upgrade account and anything pending; `near view nearly-estate.sputnik-dao.near get_policy` shows the members. One upgrade ran this way on this contract: proposed in `D7zeAmJKJ3gxTwzn7bW2GXQAMSsD8mCMZHz2fYqjcb2A`, applied in `AfK6NuucUe9qJy631qCTsFLXfh5kKh46HuzHmncWyfJ7`.
6. **Rules the AI cannot override.** Hired agents trade money the contract holds, inside their owner's caps. Agent wallets are bound by rules the owner signed with the NEAR Intents Agent API.
7. **Reviews on chain.** Swarm reviewers sign every review under a prompt pinned on chain, so a verdict signed under any other prompt is refused.

Every key and what it may call: [docs/FULL.md](docs/FULL.md). Attacks and what stops each one: [docs/SECURITY.md](docs/SECURITY.md).

## What keeps it running

- **Positions do not depend on the server.** Every position can be closed or paid with contract calls alone (an open market sells back at its price until its date; after it, the ruling pays, or anyone voids it 7 days on), and anyone can run the server from this repo.
- **Users pay the variable costs.** A bet pays 1%, a new market pays its own storage, a swarm job pays its own AI inference, a hired agent pays its own model calls, and a key sale pays 1%.
- **Rulings and pages are paid from the 1% fee.** A ruling by the 3 judges costs about $0.003, so a market covers its own ruling once it has seen about $0.30 of bets. A market nobody trades still costs that $0.003.
- **The fixed cost is about $70 a month:** one confidential VM, the house agents and gas.
- **It covers its costs at about $7,000 of bets a month.** The 1% fee on that is about $70, roughly 120 users betting $2 a day.
- **No token and no emissions.** The house money is on chain for anyone to read: the wiki fund that seeds new markets, and the house AI agents' bets (5.88 NEAR by Nov 11).

The earnings so far, the costs and the break-even are in [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md).

## Design choices

- A council upgrade needs 2 of 3 votes and no waiting period, so a fix ships in minutes. There is no separate pause switch.
- New markets start with a small seed (0.1 NEAR for a page's claims, 0.02 for a question asked in the box) to limit house money at risk, so early bets move the price a lot.
- The operator runs the judges, and the owner registers their keys when NEAR AI rotates them, with no delay. Rulings rest on the three models and on the owner's keys, not on a decentralized jury.

## Known limits

- CoinGecko sometimes refuses the enclave, so a dated crypto market can settle a few hours late.
- Money left in a market after it resolves has no sweep yet.
- If 2 of the 3 council keys are lost, the code can never change.

## Built with

Rust (near-sdk 5.29), Node 24, near-api-js 7.4, @nearai/inference-sdk, React 19 and Vite 8. NEAR AI Cloud (TEE models), NEAR Intents (Agent API, 1Click), Phala Cloud (TDX), FastNEAR RPC, Wikipedia, `wrap.near` as collateral.

## Layout

```
contracts/keys   Rust, one contract: key registry, LMSR markets, swarm, hired agents, the judges' panel
server           Node: wiki, judges, agents, swarm, keys, trade index, checkout verify
web              the pages (React) and a standalone Vite app around them
widget           nearly-checkout.js, demo.html, claim.js (a wiki claim's live odds)
ops              verify, attest, judge bench, receipt checks
docs             FULL.md (every proof and API), SECURITY.md, BENCH.md, MEASURE.md, ATTACKS.md, SUSTAINABILITY.md
```
