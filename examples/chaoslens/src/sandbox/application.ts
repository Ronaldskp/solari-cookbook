import type { CommandHandle, Sandbox } from "@solarisdk/sdk"
import { ChaosLensError } from "../errors.js"
import type { ChaosLensConfig } from "../types.js"
import * as log from "../log.js"

const MAX_SERVER_LOG_BYTES = 2 * 1024 * 1024
const HEALTH_POLL_INTERVAL_MS = 1000
const FETCH_TIMEOUT_MS = 5000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run a shell command inside the sandbox and fail loudly on non-zero exit. */
async function runShell(sandbox: Sandbox, command: string, cwd: string, timeoutMs: number): Promise<string> {
  const result = await sandbox.commands.run("sh", { args: ["-c", command], cwd, timeoutMs })
  if (result.exitCode !== 0) {
    const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-2000)
    throw new Error(`command failed (exit ${result.exitCode}): ${command}\n${tail}`)
  }
  return result.stdout
}

/**
 * The audited application running inside the sandbox: install, start,
 * health-check, and server log capture. Long-running servers use
 * `commands.start` (a background handle), never a blocking run that would
 * wait for the server to exit.
 */
export class SandboxApplication {
  private serverLogChunks: string[] = []
  private serverLogBytes = 0
  private appHandle: CommandHandle | undefined
  private currentPreviewUrl: string | undefined

  constructor(
    private readonly sandbox: Sandbox,
    private readonly config: ChaosLensConfig,
    private readonly appDir: string,
  ) {}

  get previewUrl(): string {
    if (!this.currentPreviewUrl) {
      throw new ChaosLensError("APP_HEALTH", "preview URL not resolved yet")
    }
    return this.currentPreviewUrl
  }

  private get workDir(): string {
    const cwd = this.config.application.cwd
    return cwd ? `${this.appDir}/${cwd.replace(/^\.\//, "").replace(/\/$/, "")}` : this.appDir
  }

  async install(): Promise<string> {
    const command = this.config.application.installCommand
    log.verbose(`install: ${command}`)
    let output: string
    try {
      output = await runShell(this.sandbox, command, this.workDir, 15 * 60_000)
    } catch (error) {
      throw new ChaosLensError("APP_INSTALL", `install failed: ${String(error)}`, error)
    }
    log.ok("Dependencies installed")
    return output
  }

  /** Start the application as a background process and capture its output. */
  async start(): Promise<void> {
    const command = this.config.application.startCommand
    log.verbose(`start: ${command}`)
    try {
      this.appHandle = await this.sandbox.commands.start("sh", {
        args: ["-c", command],
        cwd: this.workDir,
        onStdout: (data) => this.appendServerLog(data),
        onStderr: (data) => this.appendServerLog(data),
      })
    } catch (error) {
      throw new ChaosLensError("APP_START", `failed to start application: ${String(error)}`, error)
    }
  }

  private appendServerLog(data: string): void {
    if (this.serverLogBytes >= MAX_SERVER_LOG_BYTES) return
    this.serverLogChunks.push(data)
    this.serverLogBytes += data.length
  }

  /** Full captured server stdout/stderr so far. */
  serverLog(): string {
    return this.serverLogChunks.join("")
  }

  /** Stop the application process (best-effort) before the sandbox is killed. */
  async stop(): Promise<void> {
    const handle = this.appHandle
    this.appHandle = undefined
    if (!handle) return
    try {
      await handle.kill()
    } catch {
      // the sandbox kill that follows is authoritative
    }
  }

  /** Resolve (or re-resolve after revert) the public preview URL. */
  async refreshPreviewUrl(): Promise<string> {
    try {
      const { url } = await this.sandbox.previewUrl(this.config.application.port)
      this.currentPreviewUrl = url
      return url
    } catch (error) {
      throw new ChaosLensError("APP_HEALTH", `failed to resolve preview URL: ${String(error)}`, error)
    }
  }

  /** Poll the health path until READY or TIMEOUT. */
  async waitForHealthy(): Promise<void> {
    const timeoutMs = this.config.application.healthTimeoutMs ?? 60_000
    const deadline = Date.now() + timeoutMs
    const healthUrl = `${this.previewUrl.replace(/\/$/, "")}${this.config.application.healthPath}`
    let lastError = "no attempt made"
    while (Date.now() < deadline) {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (res.ok) {
          await res.arrayBuffer().catch(() => {})
          log.verbose(`healthy: ${healthUrl}`)
          return
        }
        lastError = `HTTP ${res.status}`
        await res.arrayBuffer().catch(() => {})
      } catch (error) {
        lastError = String(error)
      }
      await sleep(HEALTH_POLL_INTERVAL_MS)
    }
    throw new ChaosLensError(
      "APP_HEALTH",
      `application health check timed out after ${timeoutMs} ms (${lastError})`,
    )
  }
}
