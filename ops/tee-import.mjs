// the move into the enclave: send the server's 6 tables, whole, to the CVM's one-time import route. Run with the OLD server's
// loops stopped so nothing is written after the snapshot. dry (prints sizes) unless --go
//   node ops/tee-import.mjs <data dir> <cvm url> [--go]      ADMIN_TOKEN from the env (the same value sealed into the CVM)
import fs from 'node:fs'
import path from 'node:path'
const [dir, url] = process.argv.slice(2), ADMIN = process.env.ADMIN_TOKEN || ''
if (!dir || !url || !ADMIN) { console.error('usage: ADMIN_TOKEN=… node ops/tee-import.mjs <data dir> <cvm url> [--go]'); process.exit(2) }
const tables = {}
for (const name of ['keys', 'agents', 'pages', 'resolutions', 'reviews', 'settled']) { const f = path.join(dir, name + '.json'); if (fs.existsSync(f)) tables[name] = JSON.parse(fs.readFileSync(f, 'utf8')) }
console.log(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, Object.keys(v).length + ' records'])))
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const r = await fetch(url.replace(/\/$/, '') + '/api/admin/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': ADMIN }, body: JSON.stringify({ tables }) })
console.log(r.status, (await r.text()).slice(0, 300))
