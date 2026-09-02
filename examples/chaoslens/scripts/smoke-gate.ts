/**
 * Phase 0 — Solari Capability Smoke Gate.
 *
 * Real Solari SDK + real account. No mocks, no fallbacks. Runs Smoke-01
 * through Smoke-08 from docs/CHAOSLENS_PLAN.md and persists a redacted
 * transcript to artifacts/smoke/<timestamp>/smoke-result.json.
 *
 *   npm run smoke
 *
 * Exits 0 only when every smoke step PASSes.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SolariClient, Sandbox, type CommandHandle } from "@solarisdk/sdk"
import { Solari, SolariError, BrowserSession } from "@solarisdk/browser"
import { requireSolariApiKey } from "../src/env.js"
import { redact, redactDeep } from "../src/redact.js"

/**
 * Teardown races: when the remote VM dies, the control channel can emit an
 * async close error after our own cleanup already finished. Never let that
 * kill the process silently — log it and include it in the transcript.
 */
const teardownEvents: string[] = []
process.on("uncaughtException", (error) => {
  teardownEvents.push(redact(String(error?.stack ?? error)))
  console.error(`[teardown race] uncaught: ${redact(String(error))}`)
})
process.on("unhandledRejection", (reason) => {
  teardownEvents.push(redact(String(reason)))
  console.error(`[teardown race] unhandled rejection: ${redact(String(reason))}`)
})

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SMOKE_PORT = 4173

/** Minimal Node HTTP server written into the sandbox for Smoke-03. */
const SMOKE_SERVER_JS = `
const http = require("node:http");
const PAGE =
  "<!doctype html><html><head><title>ChaosLens Smoke</title></head><body>" +
  '<h1 id="title">Solari smoke server</h1>' +
  '<button id="ping">Ping</button>' +
  '<p id="out"></p>' +
  "<script>" +
  'document.getElementById("ping").addEventListener("click", function () {' +
  '  document.getElementById("out").textContent = "pong";' +
  "});" +
  "</script>" +
  "</body></html>";
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "chaoslens-smoke" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
server.listen(${SMOKE_PORT}, "0.0.0.0", () => console.log("smoke server listening on ${SMOKE_PORT}"));
`.trim()

interface SmokeEntry {
  id: string
  name: string
  pass: boolean
  details: Record<string, unknown>
}

const results: SmokeEntry[] = []
const startedAt = new Date().toISOString()

function record(id: string, name: string, pass: boolean, details: Record<string, unknown>): void {
  results.push({ id, name, pass, details })
  console.log(`${pass ? "PASS" : "FAIL"}  ${id} ${name}`)
  if (!pass) console.log(`      ${JSON.stringify(details)}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<number> {
  const apiKey = requireSolariApiKey()
  const runDir = path.join(
    PACKAGE_ROOT,
    "artifacts",
    "smoke",
    new Date().toISOString().replace(/[:.]/g, "-"),
  )
  mkdirSync(runDir, { recursive: true })

  const client = new SolariClient({ apiKey })
  const solari = new Solari({ apiKey })
  let sandbox: Sandbox | undefined
  let previewUrl = ""
  let aborted = false
  let browserReleases = 0
  let smokeServer: CommandHandle | undefined

  try {
    // ── Smoke-01 — Sandbox ──────────────────────────────────────────────
    try {
      sandbox = await client.sandboxes.create({
        template: "base",
        timeoutMs: 15 * 60_000,
      })
      await sandbox.connect()
      record("Smoke-01", "Sandbox", true, {
        sandboxId: sandbox.sandboxId,
        template: "base",
        region: "us-west (gateway default)",
        expiresAt: sandbox.expiresAt,
      })
    } catch (error) {
      record("Smoke-01", "Sandbox", false, { error: redact(String(error)) })
      aborted = true
    }

    // ── Smoke-02 — Runtime ──────────────────────────────────────────────
    if (!aborted && sandbox) {
      const runtimes: Record<string, unknown> = {}
      let allOk = true
      const probes: Array<[name: string, cmd: string, args: string[]]> = [
        ["node", "node", ["--version"]],
        ["npm", "npm", ["--version"]],
        ["python3", "python3", ["--version"]],
        ["git", "git", ["--version"]],
      ]
      for (const [name, cmd, args] of probes) {
        try {
          const out = await sandbox.commands.run(cmd, { args, timeoutMs: 30_000 })
          runtimes[name] = {
            exitCode: out.exitCode,
            version: redact((out.stdout || out.stderr).trim()),
          }
          if (name === "node" && out.exitCode !== 0) allOk = false
        } catch (error) {
          runtimes[name] = { error: redact(String(error)) }
          if (name === "node") allOk = false
        }
      }
      record("Smoke-02", "Runtime", allOk, runtimes)
      // Do NOT silently switch runtimes (master prompt §7): stop and report.
      if (!allOk) aborted = true
    }

    // ── Smoke-03 — Minimal server ───────────────────────────────────────
    if (!aborted && sandbox) {
      try {
        await sandbox.files.write("/tmp/chaoslens-smoke/server.js", SMOKE_SERVER_JS)
        const serverLog: string[] = []
        const handle = await sandbox.commands.start("node", {
          args: ["/tmp/chaoslens-smoke/server.js"],
          onStdout: (d) => serverLog.push(d),
          onStderr: (d) => serverLog.push(d),
        })
        smokeServer = handle
        await sleep(2000)
        const probe = await sandbox.commands.run("node", {
          args: [
            "-e",
            `fetch("http://127.0.0.1:${SMOKE_PORT}/health").then(r=>r.text()).then(t=>console.log(t)).catch(e=>{console.error(String(e));process.exit(1)})`,
          ],
          timeoutMs: 20_000,
        })
        const healthy = probe.exitCode === 0 && probe.stdout.includes('"ok":true')
        record("Smoke-03", "Minimal server", healthy, {
          cmdId: handle.cmdId,
          processStarted: true,
          healthResponse: probe.stdout.trim(),
          serverLog: redact(serverLog.join("").slice(0, 500)),
        })
        if (!healthy) aborted = true
      } catch (error) {
        record("Smoke-03", "Minimal server", false, { error: redact(String(error)) })
        aborted = true
      }
    }

    // ── Smoke-04 — Preview URL ──────────────────────────────────────────
    if (!aborted && sandbox) {
      try {
        const preview = await sandbox.previewUrl(SMOKE_PORT)
        previewUrl = preview.url
        let status = 0
        let body = ""
        for (let i = 0; i < 10; i++) {
          const res = await fetch(preview.url)
          status = res.status
          if (res.ok) {
            body = (await res.text()).slice(0, 200)
            break
          }
          await sleep(1000)
        }
        record("Smoke-04", "Preview URL", status === 200, {
          url: redact(preview.url),
          tokenReturned: Boolean(preview.token),
          urlContainsPtToken: preview.url.includes("pt_token"),
          localFetchStatus: status,
          localFetchBody: redact(body),
          note: "signed preview URL; token redacted in all artifacts",
        })
        if (status !== 200) aborted = true
      } catch (error) {
        record("Smoke-04", "Preview URL", false, { error: redact(String(error)) })
        aborted = true
      }
    }

    // ── Smoke-05 + 06 — Browser → Preview + Screenshot ─────────────────
    if (!aborted) {
      let browser: BrowserSession | undefined
      try {
        browser = await solari.launch()
        const page = await browser.newPage()
        await page.goto(previewUrl, { waitUntil: "load", timeout: 30_000 })
        const h1 = await page.locator("#title").innerText()
        record("Smoke-05", "Browser → Preview", h1.includes("Solari smoke server"), {
          sessionId: browser.id,
          previewUrl: redact(previewUrl),
          observedH1: h1,
        })

        const shot = await page.screenshot()
        writeFileSync(path.join(runDir, "screenshot-preview.png"), shot)
        record("Smoke-06", "Screenshot", shot.length > 0, {
          file: "screenshot-preview.png",
          bytes: shot.length,
        })
      } catch (error) {
        record("Smoke-05", "Browser → Preview", false, { error: redact(String(error)) })
      } finally {
        if (browser) {
          try {
            await browser.close()
            browserReleases += 1
          } catch {
            // close is idempotent; release failure surfaces in Smoke-08
          }
          try {
            await solari.sessions.releaseAndWait(browser.id)
          } catch {
            // already released by close() — acceptable
          }
        }
      }
    }

    // ── Smoke-07 — Recording + Replay retrieval ────────────────────────
    if (!aborted) {
      let recBrowser: BrowserSession | undefined
      let sessionId = ""
      try {
        recBrowser = await solari.launch({ recording: true })
        sessionId = recBrowser.id
        const page = await recBrowser.newPage()
        await page.goto(previewUrl, { waitUntil: "load", timeout: 30_000 })
        await page.locator("#ping").click()
        await page.locator("#out").innerText()
        await sleep(2000) // let rrweb flush batched events before release
        await recBrowser.close()
        browserReleases += 1
        recBrowser = undefined

        try {
          await solari.sessions.releaseAndWait(sessionId)
        } catch {
          // close() already released; releaseAndWait confirms when available
        }

        // Replay upload is async after release: poll >= 30s (we poll 60s),
        // 404 = PROCESSING. Cookbook pattern polls downloadReplay directly.
        let replayOk = false
        const attempts: string[] = []
        for (let attempt = 1; attempt <= 20; attempt++) {
          await sleep(3000)
          try {
            const blob = await solari.sessions.downloadReplay(sessionId)
            writeFileSync(path.join(runDir, "replay.ndjson"), blob)
            let replayUrl = ""
            let expiresInSeconds: number | undefined
            try {
              const meta = await solari.sessions.getReplayUrl(sessionId)
              replayUrl = redact(meta.url)
              expiresInSeconds = meta.expiresInSeconds
            } catch {
              // bytes are the required evidence; the presigned URL is a bonus
            }
            attempts.push(`attempt ${attempt}: OK (${blob.length} bytes)`)
            record("Smoke-07", "Recording + Replay", true, {
              sessionId,
              attempts,
              ...(replayUrl ? { replayUrl } : {}),
              ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
              replayBytes: blob.length,
              note: "404 during polling window treated as PROCESSING, not error",
            })
            replayOk = true
            break
          } catch (error) {
            if (error instanceof SolariError && error.status === 404) {
              attempts.push(`attempt ${attempt}: 404 (PROCESSING)`)
              continue
            }
            const detail =
              error instanceof SolariError
                ? `status=${error.status} code=${error.code ?? "?"} ${error.message}`
                : String(error)
            attempts.push(`attempt ${attempt}: ${redact(detail)}`)
            break
          }
        }
        if (!replayOk) {
          record("Smoke-07", "Recording + Replay", false, { sessionId, attempts })
        }
      } catch (error) {
        record("Smoke-07", "Recording + Replay", false, { error: redact(String(error)) })
      } finally {
        if (recBrowser) {
          try {
            await recBrowser.close()
            browserReleases += 1
          } catch {
            // best-effort
          }
        }
      }
    }
  } finally {
    // ── Smoke-08 — Cleanup (always, even after failures) ─────────────
    let sandboxKilled = false
    let cleanupError: string | undefined
    // Stop the still-running smoke server FIRST so its streamed command
    // handle doesn't fault when the sandbox control channel closes.
    if (smokeServer) {
      try {
        await smokeServer.kill()
      } catch {
        // best-effort; the VM kill below is authoritative
      }
    }
    try {
      if (sandbox) {
        await sandbox.kill()
        sandboxKilled = true
      } else {
        sandboxKilled = true // nothing was created; nothing to leak
      }
    } catch (error) {
      cleanupError = redact(String(error))
    }
    try {
      await solari.close()
    } catch {
      // loopback proxy teardown is best-effort here
    }
    record("Smoke-08", "Cleanup", sandboxKilled && cleanupError === undefined, {
      browserSessionsReleased: browserReleases,
      sandboxKilled,
      ...(cleanupError ? { cleanupError } : {}),
    })
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    gate: results.every((r) => r.pass) && results.length === 8 ? "PASS" : "FAIL",
    results,
    ...(teardownEvents.length > 0 ? { teardownEvents } : {}),
  }
  const outPath = path.join(runDir, "smoke-result.json")
  writeFileSync(outPath, JSON.stringify(redactDeep(summary), null, 2))
  console.log(`\nSmoke gate: ${summary.gate}`)
  console.log(`Transcript: ${outPath}`)
  return summary.gate === "PASS" ? 0 : 1
}

const exitCode = await main()
process.exitCode = exitCode
// Give WS handles a moment to finish their close handshake; a hard
// process.exit() here trips a libuv assertion on Windows.
await new Promise((resolve) => setTimeout(resolve, 500))
