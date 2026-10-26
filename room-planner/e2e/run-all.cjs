// Runs every browser test against a running app. Usage:
//   npm run build && npx vite preview --port 5200 &   (or: npm run dev -- --port 5199)
//   APP_URL=http://127.0.0.1:5200/ npm run e2e
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
const { spawnSync } = require('node:child_process')
let failed = 0
for (const t of ['t1', 't2', 't3', 't4', 't5', 't7']) {
  console.log(`\n=== ${t}`)
  const r = spawnSync('node', [`${__dirname}/${t}.cjs`], { stdio: 'inherit', env: process.env })
  if (r.status !== 0) failed++
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nAll browser tests passed')
process.exit(failed ? 1 : 0)
