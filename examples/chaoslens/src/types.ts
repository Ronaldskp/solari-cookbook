/**
 * ChaosLens domain types — the contract between config, orchestration,
 * evidence collection, and reporting.
 */

// ── Configuration ────────────────────────────────────────────────────────

export type StepAction = "goto" | "click" | "fill" | "waitForVisible" | "waitForHidden" | "wait"

export interface FlowStep {
  action: StepAction
  /** CSS selector (demo apps prefer [data-testid="..."]). Required for all actions except goto/wait. */
  selector?: string
  /** URL path for goto (relative paths resolve against the preview URL origin). */
  path?: string
  /** Value for fill. */
  value?: string
  /** Per-step timeout; for `wait` steps this is the deterministic pause duration. */
  timeoutMs?: number
}

export type FaultType = "http-500" | "latency" | "offline"

export interface FaultConfig {
  type: FaultType
  /** URL substring or glob target for http-500 / latency faults. */
  target?: string
  /** Deterministic injected delay for latency faults. */
  delayMs?: number
}

export type AssertionType = "visible" | "hidden" | "disabled" | "requestCount" | "text" | "baselineSuccess"

export interface AssertionConfig {
  type: AssertionType
  /** Element the assertion observes (visible/hidden/disabled/text). */
  selector?: string
  /** Expected substring for text assertions. */
  text?: string
  /** Route substring counted by requestCount assertions. */
  urlPattern?: string
  /** requestCount passes when the observed count is <= max. */
  max?: number
  /** Observation window; falls back to the assertion default. */
  timeoutMs?: number
}

export interface ScenarioConfig {
  id: string
  name: string
  /** null = baseline (healthy) run. */
  fault: FaultConfig | null
  assertions: AssertionConfig[]
}

export interface RepositoryConfig {
  url: string
  ref: string
}

export interface ApplicationConfig {
  name: string
  repository: RepositoryConfig
  installCommand: string
  startCommand: string
  /** Working directory (relative to the cloned repo root) for install/start. */
  cwd?: string
  port: number
  healthPath: string
  /** Health polling budget after (re)start. */
  healthTimeoutMs?: number
}

export interface FlowConfig {
  name: string
  steps: FlowStep[]
  /** Arm the active fault immediately before this step index. */
  faultArmBeforeStep?: number
  /** Default timeout for steps/assertions. */
  timeoutMs?: number
}

export interface SandboxConfig {
  template?: string
  timeoutMs?: number
}

export interface ChaosLensConfig {
  application: ApplicationConfig
  flow: FlowConfig
  scenarios: ScenarioConfig[]
  sandbox?: SandboxConfig
  outputDir?: string
}

// ── Runtime evidence & results ───────────────────────────────────────────

export type ScenarioStatus = "PASS" | "FAIL" | "ERROR"

export interface AssertionResult {
  assertion: AssertionConfig
  pass: boolean
  expected: string
  observed: string
  evaluatedAt: string
}

export interface FaultEvent {
  timestamp: string
  type: FaultType
  target: string
  activated: boolean
  detail: string
}

export interface NetworkEvent {
  timestamp: string
  method: string
  url: string
  status: number | null
  durationMs: number | null
}

export interface ConsoleEvent {
  timestamp: string
  type: string
  text: string
}

export interface ScenarioEvidence {
  screenshotPath: string | null
  consoleLogPath: string | null
  networkEventsPath: string | null
  faultEventsPath: string | null
  serverLogPath: string | null
  replayUrlPath: string | null
  replayRawPath: string | null
}

export interface ScenarioResult {
  runId: string
  scenarioId: string
  scenarioName: string
  startTime: string
  endTime: string
  faultType: FaultType | null
  faultTarget: string | null
  faultActivated: boolean
  assertions: AssertionResult[]
  status: ScenarioStatus
  failureReasons: string[]
  evidence: ScenarioEvidence
  replayUrl: string | null
}

export type BaselineStatus = "PASS" | "BLOCKED" | "ERROR"
export type ScoreState = "SCORED" | "BLOCKED" | "INCONCLUSIVE"

export interface AuditResult {
  runId: string
  startedAt: string
  finishedAt: string
  applicationName: string
  flowName: string
  baseline: BaselineStatus
  baselineReason: string | null
  scenarios: ScenarioResult[]
  score: number | null
  scoreState: ScoreState
}
