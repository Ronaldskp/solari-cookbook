/**
 * Diagnostic — why does replay retrieval 404 forever?
 *
 * Mirrors the cookbook browser-session-recording example as closely as
 * possible, then probes the raw gateway endpoints for state:
 *   - POST /sessions { recording: true } full response body
 *   - GET /sessions/:id after release
 *   - GET /sessions/:id/replay-url error bodies during the poll window
 *
 *   npx tsx scripts/diagnose-replay.ts
 */
import { Solari, BrowserSession } from "@solarisdk/browser"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function probe(solari: Solari, label: string, method: string, path: string): Promise<void> {
  try {
    const res = await solari.request(method, path)
    const body = await res.text().catch(() => "")
    console.log(`  ${label}: ${res.status} ${redact(body.slice(0, 400))}`)
  } catch (error) {
    console.log(`  ${label}: THREW ${redact(String(error))}`)
  }
}

async function main(): Promise<void> {
  const apiKey = requireSolariApiKey()
  const solari = new Solari({ apiKey })

  // Raw create to see the FULL response body (SDK normally drops extras).
  console.log("== raw POST /sessions { recording: true } ==")
  const createRes = await solari.request("POST", "/sessions", { recording: true })
  const createBody = await createRes.text()
  console.log(`  status: ${createRes.status}`)
  console.log(`  body  : ${redact(createBody.slice(0, 800))}`)
  if (!createRes.ok) {
    await solari.close()
    return
  }
  const created = JSON.parse(createBody) as { sessionId?: string }
  const rawSessionId = created.sessionId ?? ""

  // Release the raw session immediately — we only needed the response shape.
  await probe(solari, "release raw session", "DELETE", `/sessions/${encodeURIComponent(rawSessionId)}`)

  // Now the full cookbook flow via launch().
  console.log("== launch({ recording: true }) + example.com ==")
  let browser: BrowserSession | undefined
  let sessionId = ""
  try {
    browser = await solari.launch({ recording: true })
    sessionId = browser.id
    console.log(`  sessionId: ${sessionId}`)
    console.log(`  session object: ${redact(JSON.stringify(browser.session).slice(0, 400))}`)
    const page = await browser.newPage()
    await page.goto("https://example.com", { timeout: 30_000 })
    console.log(`  h1: ${await page.locator("h1").innerText()}`)
    await sleep(2000)
    const closedAt = Date.now()
    await browser.close()
    browser = undefined
    console.log(`  closed+released in ${Date.now() - closedAt} ms`)
  } catch (error) {
    console.log(`  browser flow error: ${redact(String(error))}`)
    if (browser) {
      try {
        await browser.close()
      } catch {
        // best-effort
      }
    }
  }

  if (sessionId) {
    console.log("== post-release probes ==")
    await probe(solari, "GET /sessions/:id        ", "GET", `/sessions/${encodeURIComponent(sessionId)}`)
    console.log("== polling replay-url for 60s ==")
    for (let i = 1; i <= 20; i++) {
      await sleep(3000)
      const res = await solari
        .request("GET", `/sessions/${encodeURIComponent(sessionId)}/replay-url`)
        .catch((e) => e)
      if (res instanceof Error) {
        console.log(`  attempt ${i}: THREW ${redact(String(res))}`)
        continue
      }
      const body = await res.text().catch(() => "")
      console.log(`  attempt ${i}: ${res.status} ${redact(body.slice(0, 300))}`)
      if (res.ok) {
        const data = JSON.parse(body) as { url?: string }
        if (data.url) {
          const blob = await fetch(data.url)
          console.log(`  download: ${blob.status} content-length=${blob.headers.get("content-length")}`)
        }
        break
      }
    }
  }

  await solari.close()
}

await main()
console.log("done")
