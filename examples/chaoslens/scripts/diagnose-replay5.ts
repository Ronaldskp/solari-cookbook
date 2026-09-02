/**
 * Diagnostic v5 — TRULY direct connection (no loopback proxy at all).
 *
 * Raw POST /sessions { recording: true } returns the real gateway
 * wss:// endpoint. Connect patchright-core straight to it, exercise the
 * page, release via DELETE, then poll replay-url. This is the last
 * SDK-usage variant: if this still 404s, the recording pipeline itself is
 * not producing replays for this account right now.
 *
 *   npx tsx scripts/diagnose-replay5.ts
 */
import { chromium } from "patchright-core"
import { Solari } from "@solarisdk/browser"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const solari = new Solari({ apiKey: requireSolariApiKey() })

const res = await solari.request("POST", "/sessions", { recording: true })
const body = await res.text()
if (!res.ok) {
  console.log(`POST /sessions failed: ${res.status} ${redact(body)}`)
  await solari.close()
  process.exit(1)
}
const created = JSON.parse(body) as { sessionId: string; wsEndpoint: string }
console.log(`session: ${created.sessionId}`)
console.log(`direct wsEndpoint: ${redact(created.wsEndpoint)}`)

let direct = false
let browser
try {
  browser = await chromium.connect(created.wsEndpoint)
  direct = true
  console.log(`connected directly: ${browser.version()}`)
  const page = await browser.newPage()
  await page.goto("https://example.com", { timeout: 30_000 })
  console.log(`h1: ${await page.locator("h1").innerText()}`)
  await page.locator("a").first().click().catch(() => {})
  await sleep(2000)
} catch (error) {
  console.log(`direct connect failed: ${redact(String(error))}`)
} finally {
  if (browser) await browser.close().catch(() => {})
}

if (direct) {
  const releasedAt = Date.now()
  await solari.sessions.releaseAndWait(created.sessionId)
  console.log(`released in ${Date.now() - releasedAt} ms`)

  console.log("polling replay-url for 90s...")
  for (let i = 1; i <= 30; i++) {
    await sleep(3000)
    const r = await solari
      .request("GET", `/sessions/${encodeURIComponent(created.sessionId)}/replay-url`)
      .catch((e) => e)
    if (r instanceof Error) {
      console.log(`attempt ${i}: THREW ${redact(String(r))}`)
      continue
    }
    const text = await r.text().catch(() => "")
    console.log(`attempt ${i}: ${r.status} ${redact(text.slice(0, 160))}`)
    if (r.ok) break
  }
} else {
  // release anyway
  await solari.sessions.releaseAndWait(created.sessionId).catch(() => {})
}

await solari.close()
console.log("done")
