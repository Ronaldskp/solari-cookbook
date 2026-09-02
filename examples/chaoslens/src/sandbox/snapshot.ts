import { SolariClient, type Sandbox } from "@solarisdk/sdk"
import { ChaosLensError } from "../errors.js"
import type { ChaosLensConfig } from "../types.js"
import * as log from "../log.js"
import { SandboxApplication } from "./application.js"

export interface RestoredState {
  sandbox: Sandbox
  app: SandboxApplication
}

/**
 * Snapshot the healthy, running application state. Every chaos scenario
 * starts from this snapshot (Spec §7.1).
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
 * Restore the clean application state between scenarios.
 *
 * SPEC AMENDMENT IN EFFECT (see docs/SPEC_AMENDMENT_REQUIRED.md): in-place
 * `revert()` is rejected by the gateway for this account's sessions
 * (409 "Not revertable"; `pause()` 404s), so the documented `fromSnapshot`
 * path is used instead: kill the current sandbox, boot a fresh one from the
 * ready snapshot (disk + app process state restored), re-fetch the preview
 * URL and re-verify health. Every scenario still starts from the same
 * proven-clean snapshot state, exactly as Spec §7.1 intends.
 */
export async function restoreCleanState(
  client: SolariClient,
  config: ChaosLensConfig,
  current: RestoredState,
  snapshotId: string,
): Promise<RestoredState> {
  // 1. Tear down the dirty sandbox (app process first, then the VM).
  try {
    await current.app.stop()
  } catch {
    // the kill below is authoritative
  }
  try {
    await current.sandbox.kill()
  } catch (error) {
    throw new ChaosLensError("REVERT", `failed to kill sandbox before restore: ${String(error)}`, error)
  }
  log.verbose("dirty sandbox killed; restoring from snapshot")

  // 2. Boot a fresh sandbox from the ready snapshot.
  let restored: Sandbox
  try {
    restored = await client.sandboxes.create({
      template: config.sandbox?.template ?? "base",
      fromSnapshot: snapshotId,
      timeoutMs: config.sandbox?.timeoutMs ?? 30 * 60_000,
    })
    await restored.connect()
  } catch (error) {
    throw new ChaosLensError("REVERT", `failed to restore sandbox from snapshot: ${String(error)}`, error)
  }

  // 3. Re-fetch the preview URL and re-verify application health (Spec §7.1).
  const app = new SandboxApplication(restored, config, "/app")
  await app.refreshPreviewUrl()
  try {
    await app.waitForHealthy()
  } catch {
    // Snapshot-restored process did not come back healthy; start it again.
    log.verbose("restored application not healthy — restarting it once")
    await app.start()
    try {
      await app.waitForHealthy()
    } catch (error) {
      await restored.kill().catch(() => {})
      throw new ChaosLensError(
        "REVERT",
        `application not healthy after snapshot restore + restart: ${String(error)}`,
        error,
      )
    }
  }
  log.ok("Clean state restored (healthy)")
  return { sandbox: restored, app }
}
