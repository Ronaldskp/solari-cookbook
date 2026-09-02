/**
 * Diagnostic v4 — recorded session WITHOUT the local loopback proxy.
 *
 * solari.launch() wraps the ws endpoint in a local proxy. This variant uses
 * sessions.create({ recording: true }) + a direct chromium.connect() to the
 * raw gateway endpoint. If a replay appears here but never via launch(),
 * the local proxy path interferes with recording. If it still 404s, the
 * recording pipeline itself is not producing replays for this account.
 *
 *   npx tsx scripts/diagnose-replay4.ts
 */
import { chromium } from "patchright-core"
import { Solari } from "@solarisdk/browser"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const solari = new Solari({ apiKey: requireSolariApiKey() })

const session = await solari.sessions.create({ recording: true })
console.log(`raw session created: ${session.id}`)
console.log(`wsEndpoint: ${redact(session.wsEndpoint)}`)

let browser
try {
  browser = await chromium.connect(session.wsEndpoint)
  const page = await browser.newPage()
  await page.goto("https://example.com", { timeout: 30_000 })
  console.log(`h1: ${await page.locator("h1").innerText()}`)
  await page.locator("a").first().click().catch(() => {})
  await sleep(2000)
} finally {
  if (browser) await browser.close().catch(() => {})
}

const releasedAt = Date.now()
await solari.sessions.releaseAndWait(session.id)
console.log(`released in ${Date.now() - releasedAt} ms`)

console.log("polling replay-url for 60s...")
for (let i = 1; i <= 20; i++) {
  await sleep(3000)
  const res = await solari
    .request("GET", `/sessions/${encodeURIComponent(session.id)}/replay-url`)
    .catch((e) => e)
  if (res instanceof Error) {
    console.log(`attempt ${i}: THREW ${redact(String(res))}`)
    continue
  }
  const body = await res.text().catch(() => "")
  console.log(`attempt ${i}: ${res.status} ${redact(body.slice(0, 160))}`)
  if (res.ok) break
}

await solari.close()
console.log("done")
