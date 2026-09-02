import type { Sandbox } from "@solarisdk/sdk"
import { ChaosLensError } from "../errors.js"
import type { SandboxApplication } from "./application.js"
import * as log from "../log.js"

/**
 * Snapshot the healthy, running application state. Every chaos scenario
 * starts by reverting to this snapshot (Spec §7.1).
 */
export async function snapshotReadyState(sandbox: Sandbox, label: string): Promise<string> {
  try {
    const snapshotId = await sandbox.snapshot(label)
    log.ok(`Sandbox snapshot created (${snapshotId})`)
    return snapshotId
  } catch (error) {
    throw new ChaosLensError("SNAPSHOT", `failed to snapshot sandbox: ${String(error)}`, error)
  }
}

/**
 * Restore the clean application state between scenarios:
 * revert → reconnect check → re-fetch preview URL → health check.
 * If the restored application is not healthy, restart it once; if it is
 * still unhealthy this is an infrastructure ERROR, never an app FAIL.
 */
export async function revertToReadyState(
  sandbox: Sandbox,
  app: SandboxApplication,
  snapshotId: string,
): Promise<void> {
  try {
    await sandbox.revert(snapshotId)
  } catch (error) {
    throw new ChaosLensError("REVERT", `failed to revert sandbox to snapshot: ${String(error)}`, error)
  }
  log.verbose("sandbox reverted to clean snapshot")

  // The control channel may need re-attaching after an in-place restore.
  try {
    await sandbox.commands.run("true", { timeoutMs: 15_000 })
  } catch {
    try {
      await sandbox.reconnect()
    } catch (error) {
      throw new ChaosLensError("REVERT", `sandbox unreachable after revert: ${String(error)}`, error)
    }
  }

  await app.refreshPreviewUrl()
  try {
    await app.waitForHealthy()
    log.ok("Clean state restored (healthy)")
    return
  } catch {
    log.verbose("restored application not healthy — restarting it once")
  }

  // Revert restored disk/RAM but the server process did not come back
  // healthy; start it again and re-verify.
  await app.start()
  try {
    await app.waitForHealthy()
  } catch (error) {
    throw new ChaosLensError(
      "REVERT",
      `application not healthy after revert + restart: ${String(error)}`,
      error,
    )
  }
  log.ok("Clean state restored (restarted, healthy)")
}
