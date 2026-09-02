/**
 * Diagnostic — why does POST /sandboxes/:id/revert say "Not revertable"?
 *
 * Variant A: revert while running (docs say this works).
 * Variant B: pause → revert → resume (undocumented prerequisite test).
 *
 *   npx tsx scripts/diagnose-revert.ts
 */
import { SolariClient, GatewayError } from "@solarisdk/sdk"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(error: unknown): string {
  if (error instanceof GatewayError) {
    return `status=${error.status} code=${error.code ?? "?"} body=${JSON.stringify(error.body ?? {})}`
  }
  return String(error)
}

async function main(): Promise<void> {
  const client = new SolariClient({ apiKey: requireSolariApiKey() })
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 15 * 60_000 })
  await sandbox.connect()
  console.log(`sandbox: ${sandbox.sandboxId}`)

  try {
    await sandbox.commands.run("sh", { args: ["-c", "echo marker > /tmp/marker.txt"], timeoutMs: 15_000 })
    const snapId = await sandbox.snapshot("revert-diag")
    console.log(`snapshot: ${snapId}`)
    await sleep(3000)

    // Variant A — revert while running
    try {
      await sandbox.revert(snapId)
      console.log("VARIANT A (running): revert OK")
    } catch (error) {
      console.log(`VARIANT A (running): revert FAILED → ${redact(describeError(error))}`)
    }

    // Variant B — pause, revert, resume
    try {
      await sandbox.pause()
      console.log("paused")
      await sleep(1000)
      await sandbox.revert(snapId)
      console.log("VARIANT B (paused): revert OK")
      await sandbox.resume()
      console.log("resumed")
      await sleep(2000)
      const probe = await sandbox.commands.run("cat", { args: ["/tmp/marker.txt"], timeoutMs: 15_000 })
      console.log(`VARIANT B post-revert command: exit=${probe.exitCode} stdout=${probe.stdout.trim()}`)
    } catch (error) {
      console.log(`VARIANT B (paused): FAILED → ${redact(describeError(error))}`)
    }
  } finally {
    await sandbox.kill().catch(() => {})
    console.log("sandbox killed")
  }
}

await main()
console.log("done")
