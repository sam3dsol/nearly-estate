// npm run measure: how often an encyclopedia line is wrong, and how often an AI without the web gets a fact wrong, measured on the
// wiki's own facts. Every topic page lists its facts, each with what the Wikipedia sentence itself says about it (true, false or
// silent, with the quote), the market's price, and, once ruled, the three AI judges' outcome on chain.
//   A (no keys): the source sentence against the market and against the judges.
//   B (NEARAI_KEY set): DeepSeek V4.1 Flash with no sources and no web answers each claim true or false; scored against the source
//     sentence and against the judges. About 1 cent of inference for every 300 claims.
//   node ops/measure.mjs [site] [--out docs/measure.json]
import fs from 'node:fs'
const args = process.argv.slice(2), SITE = args.find((a) => a.startsWith('http')) || 'https://nearly.trade'
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
const KEY = process.env.NEARAI_KEY || '', MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash-1017'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => { await sleep(250); const r = await fetch(SITE + p, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.json() }
const ruled = (f) => f.resolution?.outcome ?? (f.status && typeof f.status === 'object' ? Object.values(f.status)[0]?.outcome : undefined)

// ---- every fact on every topic page
const home = await get('/api/wiki/home'), facts = []
for (const p of home.pages.filter((x) => x.kind === 'topic')) {
  let page
  try { page = await get(`/api/wiki/${encodeURIComponent(p.token || p.slug)}`) } catch (e) { console.log('page unread (left out):', p.slug, e.message); continue }
  for (const f of page.facts || []) facts.push({ page: p.title, market: f.market, claim: f.claim, p_yes: f.p_yes, traded: !!f.traded, dated: f.resolves_at_ms != null || f.data != null, says: f.wiki?.says ?? null, quote: (f.wiki?.quote || '').slice(0, 240), ruled: ruled(f) ?? null })
}
const said = facts.filter((f) => f.says === 'true' || f.says === 'false')
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–')

// ---- A: the source sentence against the market and the judges
const yes = (f) => f.says === 'true'
const traded = said.filter((f) => f.traded)
const marketOff = traded.filter((f) => (f.p_yes >= 0.5) !== yes(f))
const judged = facts.filter((f) => f.ruled !== null)
const judgedSaid = judged.filter((f) => f.says === 'true' || f.says === 'false')
const judgesOff = judgedSaid.filter((f) => f.ruled !== yes(f))
// A3: what the market pays for a line, by what its source says: the market should doubt the lines that go beyond their source
const priced = (l) => { const p = l.filter((f) => f.traded && typeof f.p_yes === 'number').map((f) => f.p_yes); return p.length ? { traded: p.length, mean_p: Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 100) / 100, under_half: Math.round((100 * p.filter((x) => x < 0.5).length) / p.length) } : null }
const lines = facts.filter((f) => !f.dated)
const A3 = { source_true: priced(lines.filter((f) => f.says === 'true')), source_false: priced(lines.filter((f) => f.says === 'false')), beyond_the_source: priced(lines.filter((f) => f.says === 'silent')) }
const A = {
  facts: facts.length, pages: new Set(facts.map((f) => f.page)).size,
  source_says: { true: facts.filter((f) => f.says === 'true').length, false: facts.filter((f) => f.says === 'false').length, silent: facts.filter((f) => f.says === 'silent').length },
  // a dated market on chain data (a price, a volume) has no Wikipedia sentence by design; an undated line with none goes beyond its source
  dated_data_markets: facts.filter((f) => f.dated).length, lines_beyond_the_source: facts.filter((f) => f.says === 'silent' && !f.dated).length, encyclopedia_lines: facts.filter((f) => !f.dated).length,
  traded_with_a_source_statement: traded.length, market_against_the_source: marketOff.length,
  market_price_by_source: A3,
  ruled_by_the_judges: judged.length, ruled_with_a_source_statement: judgedSaid.length, judges_against_the_source: judgesOff.length,
}

// ---- B: an AI with no web, no sources
async function ask(claim) {
  const body = { model: MODEL, temperature: 0, max_tokens: 40, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'system', content: 'Answer from your own knowledge only; you have no web and no sources. Reply as JSON only: {"answer": true} if the statement is true, {"answer": false} if it is false, {"answer": null} if you cannot tell.' }, { role: 'user', content: claim }] }
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://cloud-api.near.ai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      if (!r.ok) throw new Error(`near ai ${r.status}`)
      const d = await r.json(), a = JSON.parse((d.choices?.[0]?.message?.content || '{}').replace(/^```(json)?|```$/g, '')).answer
      return { answer: a === true || a === false ? a : null, usage: d.usage }
    } catch (e) { if (i === 2) return { answer: undefined, error: e.message }; await sleep(1500) }
  }
}
let B = null
if (KEY) {
  const todo = facts.filter((f) => f.says === 'true' || f.says === 'false' || f.ruled !== null)
  let inTok = 0, outTok = 0
  for (const f of todo) { const r = await ask(f.claim); f.ai_no_web = r.answer; inTok += r.usage?.prompt_tokens || 0; outTok += r.usage?.completion_tokens || 0; await sleep(150) }
  const answered = (l) => l.filter((f) => f.ai_no_web === true || f.ai_no_web === false)
  const vsSource = said.filter((f) => f.ai_no_web !== undefined), vsJudges = judged.filter((f) => f.ai_no_web !== undefined)
  B = {
    model: MODEL, asked: todo.length, failed_calls: todo.filter((f) => f.ai_no_web === undefined).length,
    against_the_source: { claims: vsSource.length, wrong: answered(vsSource).filter((f) => f.ai_no_web !== yes(f)).length, cannot_tell: vsSource.filter((f) => f.ai_no_web === null).length },
    against_the_judges: { claims: vsJudges.length, wrong: answered(vsJudges).filter((f) => f.ai_no_web !== f.ruled).length, cannot_tell: vsJudges.filter((f) => f.ai_no_web === null).length },
    usd: Math.round(((inTok * 0.3 + outTok * 1.2) / 1e6) * 10000) / 10000,
  }
}

console.log(`${A.facts} facts on ${A.pages} topic pages (${SITE}, ${new Date().toISOString().slice(0, 16)}Z)`)
console.log(`the Wikipedia sentence says: true ${A.source_says.true}, false ${A.source_says.false}, silent ${A.source_says.silent}`)
console.log(`A0 ${A.encyclopedia_lines} encyclopedia lines (${A.dated_data_markets} dated data markets aside): ${A.lines_beyond_the_source} go beyond their source sentence (${pct(A.lines_beyond_the_source, A.encyclopedia_lines)})`)
console.log(`A1 traded facts the source states: ${A.traded_with_a_source_statement}; the market prices ${A.market_against_the_source} of them against the source (${pct(A.market_against_the_source, A.traded_with_a_source_statement)})`)
const p3 = (x) => (x ? `${Math.round(x.mean_p * 100)}% on average, ${x.under_half}% of them under 50% (${x.traded} traded)` : '–')
console.log(`A3 the market prices lines the source supports at ${p3(A3.source_true)}; lines it debunks at ${p3(A3.source_false)}; lines beyond the source at ${p3(A3.beyond_the_source)}`)
console.log(`A2 facts the three judges ruled: ${A.ruled_by_the_judges} (${A.ruled_with_a_source_statement} with a source statement); the judges ruled against the source on ${A.judges_against_the_source}`)
if (B) {
  console.log(`B1 ${MODEL} with no web, on ${B.against_the_source.claims} claims the source states: wrong ${B.against_the_source.wrong} (${pct(B.against_the_source.wrong, B.against_the_source.claims)}), cannot tell ${B.against_the_source.cannot_tell}`)
  console.log(`B2 the same model with no web, on ${B.against_the_judges.claims} claims the judges ruled: wrong ${B.against_the_judges.wrong} (${pct(B.against_the_judges.wrong, B.against_the_judges.claims)}), cannot tell ${B.against_the_judges.cannot_tell}`)
  console.log(`cost about $${B.usd} at list price; failed calls ${B.failed_calls}`)
} else console.log('B skipped: set NEARAI_KEY to ask the model')
if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), site: SITE, A, B, facts }, null, 1)); console.log('written', OUT) }
