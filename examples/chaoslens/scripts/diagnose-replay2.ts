/**
 * Diagnostic v2 — longer recorded session + full state probes.
 *
 * Recent service deploys (Sep 1-2, 2026) changed recording + status
 * reporting behavior; this re-tests with a longer, busier session and
 * prints full (redacted) endpoint bodies.
 *
 *   npx tsx scripts/diagnose-replay2.ts
 */
import { Solari, type BrowserSession } from "@solarisdk/browser"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const apiKey = requireSolariApiKey()
  const solari = new Solari({ apiKey })
  let browser: BrowserSession | undefined
  let sessionId = ""

  try {
    browser = await solari.launch({ recording: true })
    sessionId = browser.id
    console.log(`sessionId: ${sessionId}`)

    const page = await browser.newPage()
    await page.goto("https://example.com", { timeout: 30_000 })
    console.log(`h1: ${await page.locator("h1").innerText()}`)
    // Busier session: follow the link, come back, scroll a bit.
    await page.locator("a").first().click()
    await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {})
    await page.goBack({ waitUntil: "load", timeout: 30_000 }).catch(() => {})
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await sleep(3000) // give rrweb time to batch + flush events
    console.log("session active for ~10s; closing")
  } catch (error) {
    console.log(`flow error: ${redact(String(error))}`)
  }

  const closedAt = Date.now()
  if (browser) {
    await browser.close()
    console.log(`close (incl. releaseAndWait) took ${Date.now() - closedAt} ms`)
  }

  if (!sessionId) {
    await solari.close()
    return
  }

  const state = await solari
    .request("GET", `/sessions/${encodeURIComponent(sessionId)}`)
    .catch((e) => e)
  if (!(state instanceof Error)) {
    console.log(`GET /sessions/:id → ${state.status}`)
    console.log(redact(await state.text()))
  }

  console.log("polling replay-url for 90s...")
  for (let i = 1; i <= 30; i++) {
    await sleep(3000)
    const res = await solari
      .request("GET", `/sessions/${encodeURIComponent(sessionId)}/replay-url`)
      .catch((e) => e)
    if (res instanceof Error) {
      console.log(`attempt ${i}: THREW ${redact(String(res))}`)
      continue
    }
    const body = await res.text().catch(() => "")
    console.log(`attempt ${i}: ${res.status} ${redact(body.slice(0, 200))}`)
    if (res.ok) break
  }

  await solari.close()
}

await main()
console.log("done")
