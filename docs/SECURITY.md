# Security: what an attacker can try, and what stops it

The attacker in mind has 1 to 50 NEAR, a laptop and two days. Each row names the attack, what stops it, and where to check it. Contract checks are in `contracts/keys/src/lib.rs` and its tests (`cargo test --release`); server checks are in `server/` and `server/test/`.

## Rulings and disputes

| Attack | What stops it | Check |
|---|---|---|
| Bring a ruling the judges never signed, or move a real one to another market | Every ruling carries the judges' signed request and response; the contract verifies each signature under a registered key and that the request names this market and this contract | `a_ruling_names_this_contract`, `a_ruling_is_bound_to_its_market` |
| Have the judges sign under a steered prompt, a forced response format, extra turns, tools or free sampling | The judges' system prompt is pinned on chain; the contract parses each signed request, requires it to re-serialize byte for byte, and checks every field: model, prompt, market marker, temperature 0.3, the plain JSON format, nothing else | `the_pin_is_a_parsed_structure_sibling_shapes_and_free_sampling_are_refused`; `get_judge_prompt_hash` |
| Hide a second question inside the judge's JSON | The judge JSON is read into a strict struct: a duplicate or unknown field, escaped or not, is refused | `a_duplicate_question_inside_the_judge_json_is_refused_escaped_or_not` |
| Rule a claim "as of" another time, or with another model | `resolves_at` is the market's date to the millisecond (within a day of the block for a dateless claim), `now` within a day of the block; every voice's model is on the owner's list | `the_judges_json_values_are_held_to_the_market_and_the_block`, `get_judge_models` |
| Rule on one signature | Three judges, three keys, three models; two of three must agree; one may abstain; a single-signature ruling is refused | `one_judge_may_abstain_and_the_other_two_decide`, `two_abstentions_or_an_abstention_beside_a_split_is_no_ruling` |
| Outbid an honest ruling, or win by being the last one standing | One challenge of 1 NEAR, then the judges look again with everything both sides posted and their answer is final; a challenge never wins by default; a second bond is refused | `one_challenge_of_exactly_1_near_and_a_second_bond_is_refused`, `an_unanswered_challenge_does_not_win_at_24_hours_the_judges_answer` |
| Stall the final look, or post every bond yourself, to force a void | A market is void only when two judges sign that its wording cannot be settled; with no final answer in 72 h the relay's first ruling stands and every bond goes back; a ruling a user brought reopens | `a_ruling_someone_else_brought_reopens_at_the_timeout_and_every_bond_goes_back`, `rule_invalid_needs_two_invalid_voices_from_the_relay_after_the_challenge_within_72_hours` |
| Bring your own three-judge ruling built on evidence you wrote | An outside ruling carries exactly 1 NEAR at risk; the defender wallet re-asks the judges on the server's own evidence and challenges a ruling they do not confirm (up to 10 NEAR a day); every challenge alerts the owner | `server/markets.mjs` defendDue, `server/test/defend.test.mjs`; `/api/markets/defender` |
| Re-time a chain-number market after its date | The final look rules on the reading the first ruling was made on, and the market page says so | `pinned_reading` on `/api/markets/<id>` |
| Bury honest sources before the final look | The judges read the two oldest and the newest source a side, one per account; a source's text is kept as posted | `server/markets.mjs` |
| Copy a question to blind the judges | Every ruling is bound to its market id, so a copied question changes nothing | contract tests above |

## Money and storage

| Attack | What stops it | Check |
|---|---|---|
| Open thousands of cheap records until the contract cannot pay storage | Buys, `BuyFor`, new markets and wiki facts that open a record wait while free NEAR is under 1 NEAR plus the record fee; a first position pays its own 0.02 wNEAR; a question is at most 400 bytes; a key costs at least 0.01 NEAR; a position sold to nothing gives its record back | `*_while_the_contract_is_short_of_near*`, `a_first_position_pays_its_own_storage`, `a_position_sold_or_collected_to_nothing_gives_its_record_back` |
| Spend the bonds the contract holds for others | Held bonds are counted and kept out of free NEAR, so a refund is never paid from other users' money | `free_near_leaves_out_the_bonds_held_and_the_owner_can_recount_them`; `get_bonds_held` |
| Profit from a round trip on the market maker | LMSR with `b = subsidy / ln 2`, rounding toward the pool; the pot always covers every winning share, or half of every share if the market is void | contract market tests |
| Drain a hired desk with the server's trade key | That key may call `desk_buy`, `desk_sell` and `desk_charge` only, within each desk's balance and limits and 20 wNEAR a day across all desks; it cannot withdraw, change a limit or sell the owner's own shares | `a_desk_sells_only_what_it_bought_and_its_owner_still_holds`, `two_desks_of_one_owner_never_count_more_than_the_owner_holds` |
| Overpay or underpay a key | `buy_key` refunds an overpayment and takes the fee on the price | `a_key_overpaid_refunds_the_difference_and_the_fee_is_on_the_price` |

## Swarm and agents

| Attack | What stops it | Check |
|---|---|---|
| Tell the reviewers to approve your entry | Results are untrusted text in a pinned prompt; three voices, two of three decide; a result that addresses the reviewer fails | job 16 on chain, `/api/swarm/review/16` |
| Forge or replay a review | Every review carries signed bytes the contract checks; the bytes name the job; the reviewers' prompt is pinned on chain; a receipt cannot be used twice | `a_signed_review_names_its_job_and_is_refused_on_another`, `with_judges_registered_an_unsigned_review_is_refused`, the `reviewer_prompt` tests |
| Copy an honest entry after the deadline, or win a tie by list order | An entry after the deadline is refused; the earliest entry wins a tie | `an_entry_after_the_deadline_is_refused` |
| Bill a job and never deliver | The billing is clawed back when the stake is released, and the worker is counted failed once | `a_worker_that_billed_and_never_delivered_loses_it_when_it_frees_its_stake`, `a_stake_freed_after_7_days_is_not_clawed_back_or_counted_again_at_settle` |
| Bill an agent past its owner's daily cap | Job billing counts against the cap as trades do | `the_daily_cap_bounds_what_a_bid_bills_an_agent` |
| Cancel a job to keep delivered work | A job with a delivered, unreviewed entry cannot be cancelled inside the review day; a submitted job is rejected only with a review on record | `a_delivered_entry_nobody_judged_is_not_cancelled_away_inside_the_review_day`, `a_submitted_job_is_rejected_only_after_a_review_or_a_day_past_the_deadline` |
| Talk an agent wallet into breaking its owner's rules | The NEAR Intents Agent API enforces the owner-signed policy, and the server checks the AI's decision first: 50 attacks fooled the model 50 times, all 48 rule-breaking orders were refused, $0 moved | [ATTACKS.md](ATTACKS.md), `server/redteam.mjs` |

## Keys and checkout

| Attack | What stops it | Check |
|---|---|---|
| Match a key's feed to public transactions and name the hidden account | Feed rows are rounded to the minute and three figures, carry no hash, totals or correlation id, and live frames arrive one to three minutes late; only confidential NEAR Intents swaps cannot be matched at all | `server/keys.mjs`, `server/test/keys.test.mjs` |
| Print a fake PnL with a swap at a made-up rate, or hide a loss | A swap more than 30% off today's rate is left out; the window is 120 transactions; hops merge only when the amounts chain | `server/trades.mjs`, `server/test/trades.test.mjs` |
| Claim a checkout payment that did not happen | `/api/checkout/verify` says `paid` only when the 1Click record's status, recipient, asset, amount and swap type all match | `server/index.mjs` |

## Server and enclave

| Attack | What stops it | Check |
|---|---|---|
| Read the hidden accounts from the server | The keys server runs in an Intel TDX enclave; `npm run attest` proves the compose and image | [ATTESTATION.md](../ATTESTATION.md) |
| Burn model credit through the open endpoints | Global caps counted before each call (questions, rulings, dry rulings, page writes); per-address caps on the paid endpoints | `server/limits.mjs`, `server/test/limits.test.mjs` |
| Skip the edge and write your own client address | A forwarded address is believed only on requests the edge marked with its shared header; the origin takes only Cloudflare's authenticated pulls | `server/ip.mjs`, `server/test/clientip.test.mjs` |
| Reach internal services through a posted source | One DNS lookup, the socket pinned to the checked address, private ranges and redirects refused, https only | `pinnedGet` in `server/wikipedia.mjs` |

## Open, and said so

- The API answers every origin (`Access-Control-Allow-Origin: *`; the checkout widget runs on merchants' pages); no cookie auth exists, so the impact is low. The CSP is report-only, since wallet connectors load from other origins.
- The relay and the operator share one function-call key; a ruling still needs the judges' signatures, so that key alone cannot bring one.
- The defender's account, caps and every challenge are public by design.
- A changed copy of an entry that scores higher than the original can still win a job (commit-reveal would close it).
- A swarm entry's 0.02 NEAR storage fee is a little under its cost.
- The judges are three models the team runs, and the owner sets their keys with no delay.
- Code changes need 2 of 3 votes of the council `nearly-estate.sputnik-dao.near` (`get_upgrade`), with no waiting period. The contract account has no access key, so there is no other way to change its code.
