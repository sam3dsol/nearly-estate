# How often a line goes beyond its source

The problem the wiki works on: an encyclopedia line can say more than its source. Measured on the wiki's own facts on Nov 12, 2026, at 05:47 UTC. The numbers below are that snapshot; a rerun reads the live wiki, which keeps growing, so its counts move a little (by 06:30 UTC it read 49 of 335 lines beyond their source). Run it yourself with `npm run measure`. The data, one row per fact, is in [`measure-2026-11-12.json`](measure-2026-11-12.json).

Every topic page lists its facts. For each fact the page keeps the Wikipedia sentence it was written from, and what that sentence says about the fact: true, false (the page quotes a myth to debunk it), or silent. Each fact is also a market, and some are already ruled on chain by the three AI judges (DeepSeek V4.1 Flash, Qwen 3.8 27B, GLM 5.3 Flash, two of three decide).

| | Count |
|---|---|
| Facts on 40 topic pages | 348 |
| Dated data markets (a price, a volume; no Wikipedia sentence by design) | 14 |
| Encyclopedia lines | 334 |
| The source sentence states it true / false / nothing (8 lines have no source sentence) | 235 / 43 / 48 |

## The encyclopedia against its own source

- **48 of 334 lines (14%) are not stated by the Wikipedia sentence they cite.** These are the lines a reader should not take on trust, and why every line is a market.
- **The market prices 3 of 225 traded lines against their source (1%).**
- **In this sample, the market doubts the lines that go beyond their source.** On average it prices lines the source supports at 82% true (1% of them under 50%, 191 traded), lines the source debunks at 22% (94% under 50%, 34 traded), and the lines that go beyond their source at 54%, with 42% of them under 50% (36 traded). The lines a reader should not take on trust are the ones the market will not price as settled.
- **The judges ruled 12 facts; on the 7 with a source statement they never ruled against it.**

## What it means

The encyclopedia's own lines go beyond their source one time in seven, and the market prices those lines, on average, as unsettled. Pricing every line and settling it with three AI judges is the check an encyclopedia alone does not give.
