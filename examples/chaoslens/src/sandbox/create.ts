import { SolariClient, type Sandbox } from "@solarisdk/sdk"
import { ChaosLensError } from "../errors.js"
import type { ChaosLensConfig } from "../types.js"
import * as log from "../log.js"

export const DEFAULT_SANDBOX_TEMPLATE = "base"
export const DEFAULT_SANDBOX_TIMEOUT_MS = 30 * 60_000

export interface SolariClients {
  client: SolariClient
}

/** Create the audit sandbox (one per audit run — Spec §23). */
export async function createAuditSandbox(
  client: SolariClient,
  config: ChaosLensConfig,
): Promise<Sandbox> {
  const template = config.sandbox?.template ?? DEFAULT_SANDBOX_TEMPLATE
  const timeoutMs = config.sandbox?.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS
  let sandbox: Sandbox
  try {
    sandbox = await client.sandboxes.create({ template, timeoutMs })
  } catch (error) {
    throw new ChaosLensError("SANDBOX_CREATE", `failed to create Solari sandbox: ${String(error)}`, error)
  }
  try {
    await sandbox.connect()
  } catch (error) {
    await sandbox.kill().catch(() => {})
    throw new ChaosLensError("SANDBOX_CREATE", `failed to open sandbox control channel: ${String(error)}`, error)
  }
  log.ok(`Solari Sandbox created (${sandbox.sandboxId})`)
  return sandbox
}

/** Clone the configured public repository into the sandbox. */
export async function cloneRepository(sandbox: Sandbox, config: ChaosLensConfig): Promise<string> {
  const appDir = "/app"
  const { url, ref } = config.application.repository
  try {
    await sandbox.git.clone(url, { branch: ref, path: appDir, depth: 1 })
  } catch (error) {
    throw new ChaosLensError("SANDBOX_PREPARE", `git clone failed for ${url}@${ref}: ${String(error)}`, error)
  }
  log.ok("Repository cloned")
  return appDir
}
