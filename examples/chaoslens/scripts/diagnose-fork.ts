/**
 * Diagnostic — fromSnapshot fork as the clean-state restore path.
 *
 * In-place revert is rejected (409 "Not revertable") and pause 404s for this
 * account's pool VMs. The documented alternative is booting a fresh sandbox
 * from the snapshot. This verifies: fork boots, files restored, the running
 * app process restored, and preview reachable.
 *
 *   npx tsx scripts/diagnose-fork.ts
 */
import { SolariClient } from "@solarisdk/sdk"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

process.on("uncaughtException", (error) => {
  console.error(`[teardown race] ${redact(String(error))}`)
})
process.on("unhandledRejection", (reason) => {
  console.error(`[teardown race] ${redact(String(reason))}`)
})

const PORT = 4173

const SERVER_JS = `
const http = require("node:http");
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<h1>fork test</h1>");
}).listen(${PORT}, "0.0.0.0", () => console.log("listening"));
`.trim()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const client = new SolariClient({ apiKey: requireSolariApiKey() })
  const sandboxA = await client.sandboxes.create({ template: "base", timeoutMs: 15 * 60_000 })
  await sandboxA.connect()
  console.log(`sandbox A: ${sandboxA.sandboxId}`)

  let fork
  try {
    await sandboxA.files.write("/tmp/marker.txt", "clean-state-marker\n")
    await sandboxA.files.write("/tmp/server.js", SERVER_JS)
    const serverHandle = await sandboxA.commands.start("node", { args: ["/tmp/server.js"] })
    await sleep(2000)
    const healthA = await sandboxA.commands.run("node", {
      args: ["-e", `fetch("http://127.0.0.1:${PORT}/health").then(r=>r.text()).then(console.log).catch(e=>{console.error(String(e));process.exit(1)})`],
      timeoutMs: 20_000,
    })
    console.log(`A in-guest health: exit=${healthA.exitCode} ${healthA.stdout.trim()}`)

    const snapId = await sandboxA.snapshot("fork-diag")
    console.log(`snapshot: ${snapId}`)
    await sleep(2000)

    // Free plan allows 1 concurrent sandbox: kill A before booting the fork.
    // Stop the streamed server first so the channel close stays clean.
    await serverHandle.kill().catch(() => {})
    await sandboxA.kill()
    console.log("sandbox A killed (state lives on in the snapshot)")

    fork = await client.sandboxes.create({ template: "base", fromSnapshot: snapId, timeoutMs: 15 * 60_000 })
    await fork.connect()
    console.log(`sandbox B (from snapshot): ${fork.sandboxId}`)

    const marker = await fork.commands.run("cat", { args: ["/tmp/marker.txt"], timeoutMs: 15_000 })
    console.log(`B marker file: exit=${marker.exitCode} content=${marker.stdout.trim()}`)

    let healthy = false
    for (let i = 0; i < 10; i++) {
      const probe = await fork.commands.run("node", {
        args: ["-e", `fetch("http://127.0.0.1:${PORT}/health").then(r=>r.text()).then(console.log).catch(()=>process.exit(1))`],
        timeoutMs: 15_000,
      }).catch(() => undefined)
      if (probe && probe.exitCode === 0 && probe.stdout.includes('"ok":true')) {
        healthy = true
        break
      }
      await sleep(1500)
    }
    console.log(`B app process restored + healthy: ${healthy}`)

    const preview = await fork.previewUrl(PORT).catch((e) => e)
    if (preview instanceof Error) {
      console.log(`B previewUrl: FAILED ${redact(String(preview))}`)
    } else {
      const res = await fetch(preview.url).catch((e) => e)
      console.log(`B preview fetch: ${res instanceof Error ? redact(String(res)) : res.status}`)
    }
  } finally {
    await fork?.kill().catch(() => {})
    await sandboxA.kill().catch(() => {})
    console.log("both sandboxes killed")
  }
}

await main()
console.log("done")
