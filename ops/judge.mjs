// One command for a judge: every check this repo makes, in order, then one table of PASS / FAIL.
//   npm run judge            unit tests, the chain proofs (verify), the enclave attestation, a TEE receipt, the contract tests
//   npm run judge -- --fast  the same without the contract build (cargo takes a few minutes the first time)
// Nothing here needs a key or moves money: every check reads public data (NEAR mainnet, Phala, NEAR AI) or runs locally.
import { spawnSync } from 'node:child_process'
const fast = process.argv.includes('--fast')
const steps = [
  ['unit tests (server)', 'npm', ['test']],
  ['chain proofs (verify)', 'npm', ['run', 'verify']],
  ['enclave attestation', 'npm', ['run', 'attest']],
  ['a TEE receipt, re-checked', 'npm', ['run', 'check']],
  ...(fast ? [] : [['contract tests (cargo)', 'cargo', ['test', '--release', '--quiet'], 'contracts']]),
]
const rows = []
for (const [name, cmd, args, cwd] of steps) {
  const t0 = Date.now()
  console.log(`\n=== ${name}: ${cmd} ${args.join(' ')}${cwd ? ` (in ${cwd})` : ''}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: cwd || process.cwd(), shell: process.platform === 'win32' })
  rows.push([name, r.status === 0 ? 'PASS' : r.error?.code === 'ENOENT' ? 'SKIP (not installed)' : 'FAIL', `${Math.round((Date.now() - t0) / 1000)} s`])
}
const w = Math.max(...rows.map((r) => r[0].length))
console.log('\n' + rows.map(([n, s, t]) => `${n.padEnd(w)}  ${s.padEnd(20)} ${t}`).join('\n'))
process.exit(rows.some((r) => r[1] === 'FAIL') ? 1 : 0)
