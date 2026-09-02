import type { AssertionResult, FaultConfig, ScenarioResult, ScenarioStatus, ScoreState } from "../types.js"

export interface ClassificationInput {
  isBaseline: boolean
  fault: FaultConfig | null
  faultActivated: boolean
  flowCompleted: boolean
  /** Flow step failed before the fault was armed (chaos runs only). */
  flowFailedBeforeFault: boolean
  /** Harness/infrastructure failure at any stage (never an app FAIL — Spec §11). */
  infrastructureError: string | null
  /** Assertion could not be evaluated (e.g. invalid selector). */
  evaluationError: string | null
  assertionResults: AssertionResult[]
}

export interface Classification {
  status: ScenarioStatus
  failureReasons: string[]
}

/**
 * Strict scenario classification (Spec §11):
 *   PASS  — fault injected + all resilience assertions pass
 *   FAIL  — fault injected + application assertion failed
 *   ERROR — harness / infrastructure / config / selector / fault-activation failure
 */
export function classifyScenario(input: ClassificationInput): Classification {
  const failureReasons: string[] = []

  if (input.infrastructureError) {
    return { status: "ERROR", failureReasons: [input.infrastructureError] }
  }
  if (input.evaluationError) {
    return { status: "ERROR", failureReasons: [input.evaluationError] }
  }
  if (!input.isBaseline) {
    if (input.fault === null) {
      return { status: "ERROR", failureReasons: ["chaos scenario has no fault configured"] }
    }
    if (!input.faultActivated) {
      // A test cannot evaluate resilience unless the fault provably happened.
      return { status: "ERROR", failureReasons: [`fault ${input.fault.type} was not activated`] }
    }
    if (input.flowFailedBeforeFault) {
      return {
        status: "ERROR",
        failureReasons: ["flow failed before the fault was armed (harness/environment problem)"],
      }
    }
  }

  const failed = input.assertionResults.filter((r) => !r.pass)
  if (input.isBaseline && !input.flowCompleted && failed.length === 0) {
    failureReasons.push("baseline flow did not complete")
    return { status: "FAIL", failureReasons }
  }
  if (failed.length === 0) {
    return { status: "PASS", failureReasons: [] }
  }
  for (const result of failed) {
    failureReasons.push(`${result.expected} — observed: ${result.observed}`)
  }
  return { status: "FAIL", failureReasons }
}

/**
 * Reliability score (Spec §13): PASS / (PASS + FAIL) × 100 over chaos
 * scenarios only. Baseline gates scoring; any ERROR (or missing required
 * replay evidence, Spec §24) makes the audit INCONCLUSIVE.
 */
export function computeScore(
  baselinePassed: boolean,
  scenarios: ScenarioResult[],
  replayMissingForValidScenario: boolean,
): { score: number | null; scoreState: ScoreState } {
  if (!baselinePassed) {
    return { score: null, scoreState: "BLOCKED" }
  }
  const chaos = scenarios.filter((s) => s.faultType !== null)
  if (chaos.length === 0) {
    return { score: null, scoreState: "INCONCLUSIVE" }
  }
  if (chaos.some((s) => s.status === "ERROR") || replayMissingForValidScenario) {
    return { score: null, scoreState: "INCONCLUSIVE" }
  }
  const passed = chaos.filter((s) => s.status === "PASS").length
  const failed = chaos.filter((s) => s.status === "FAIL").length
  return { score: Math.round((passed / (passed + failed)) * 100), scoreState: "SCORED" }
}
