/**
 * Typed errors with an audit stage, so every failure can be reported as an
 * infrastructure/harness ERROR — never as an application FAIL (Spec §11).
 */

export type AuditStage =
  | "CONFIG"
  | "SANDBOX_CREATE"
  | "SANDBOX_PREPARE"
  | "APP_INSTALL"
  | "APP_START"
  | "APP_HEALTH"
  | "SNAPSHOT"
  | "REVERT"
  | "BROWSER_CREATE"
  | "BROWSER_FLOW"
  | "FAULT_INJECTION"
  | "EVIDENCE"
  | "REPLAY"
  | "REPORT"
  | "CLEANUP"

export class ChaosLensError extends Error {
  readonly stage: AuditStage

  constructor(stage: AuditStage, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "ChaosLensError"
    this.stage = stage
  }
}

export function stageOf(error: unknown): AuditStage | undefined {
  return error instanceof ChaosLensError ? error.stage : undefined
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
