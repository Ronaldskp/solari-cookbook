import { describe, expect, it } from "vitest"
import { classifyScenario, computeScore } from "../src/report/model.js"
import type { AssertionResult, ScenarioResult } from "../src/types.js"

function assertion(pass: boolean): AssertionResult {
  return {
    assertion: { type: "visible", selector: "#x" },
    pass,
    expected: "#x visible",
    observed: pass ? "visible" : "not visible",
    evaluatedAt: new Date().toISOString(),
  }
}

describe("scenario classification", () => {
  it("PASS when fault injected and all assertions pass", () => {
    const { status } = classifyScenario({
      isBaseline: false,
      fault: { type: "http-500", target: "/api" },
      faultActivated: true,
      flowCompleted: true,
      flowFailedBeforeFault: false,
      infrastructureError: null,
      evaluationError: null,
      assertionResults: [assertion(true)],
    })
    expect(status).toBe("PASS")
  })

  it("FAIL when fault injected but an application assertion fails", () => {
    const { status, failureReasons } = classifyScenario({
      isBaseline: false,
      fault: { type: "http-500", target: "/api" },
      faultActivated: true,
      flowCompleted: true,
      flowFailedBeforeFault: false,
      infrastructureError: null,
      evaluationError: null,
      assertionResults: [assertion(true), assertion(false)],
    })
    expect(status).toBe("FAIL")
    expect(failureReasons).toHaveLength(1)
  })

  it("ERROR when the fault was not activated — never PASS", () => {
    const { status } = classifyScenario({
      isBaseline: false,
      fault: { type: "http-500", target: "/api" },
      faultActivated: false,
      flowCompleted: true,
      flowFailedBeforeFault: false,
      infrastructureError: null,
      evaluationError: null,
      assertionResults: [assertion(true)],
    })
    expect(status).toBe("ERROR")
  })

  it("ERROR on infrastructure failure — never an application FAIL", () => {
    const { status } = classifyScenario({
      isBaseline: false,
      fault: { type: "latency", target: "/api", delayMs: 1000 },
      faultActivated: true,
      flowCompleted: false,
      flowFailedBeforeFault: false,
      infrastructureError: "SANDBOX_CREATE: boom",
      evaluationError: null,
      assertionResults: [assertion(false)],
    })
    expect(status).toBe("ERROR")
  })

  it("ERROR when an assertion could not be evaluated", () => {
    const { status } = classifyScenario({
      isBaseline: false,
      fault: { type: "offline" },
      faultActivated: true,
      flowCompleted: true,
      flowFailedBeforeFault: false,
      infrastructureError: null,
      evaluationError: "assertion (visible) could not be evaluated: invalid selector",
      assertionResults: [assertion(false)],
    })
    expect(status).toBe("ERROR")
  })

  it("ERROR when the flow failed before the fault was armed", () => {
    const { status } = classifyScenario({
      isBaseline: false,
      fault: { type: "http-500", target: "/api" },
      faultActivated: false,
      flowCompleted: false,
      flowFailedBeforeFault: true,
      infrastructureError: null,
      evaluationError: null,
      assertionResults: [],
    })
    expect(status).toBe("ERROR")
  })

  it("baseline PASS requires a completed flow and passing assertions", () => {
    const pass = classifyScenario({
      isBaseline: true,
      fault: null,
      faultActivated: false,
      flowCompleted: true,
      flowFailedBeforeFault: false,
      infrastructureError: null,
      evaluationError: null,
      assertionResults: [assertion(true)],
    })
    expect(pass.status).toBe("PASS")

    const blocked = classifyScenario({
      isBaseline: true,
      fault: null,
      faultActivated: false,
      flowCompleted: false,
      flowFailedBeforeFault: false,
      infrastructureError: null,
      evaluationError: null,
      assertionResults: [],
    })
    expect(blocked.status).toBe("FAIL")
  })
})

function scenario(id: string, status: ScenarioResult["status"], faulted: boolean, replayUrl: string | null): ScenarioResult {
  return {
    runId: "run",
    scenarioId: id,
    scenarioName: id,
    startTime: "",
    endTime: "",
    faultType: faulted ? "http-500" : null,
    faultTarget: faulted ? "/api" : null,
    faultActivated: faulted,
    assertions: [],
    status,
    failureReasons: [],
    evidence: {
      screenshotPath: null,
      consoleLogPath: null,
      networkEventsPath: null,
      faultEventsPath: null,
      serverLogPath: null,
      replayUrlPath: null,
      replayRawPath: null,
    },
    replayUrl,
  }
}

describe("reliability score", () => {
  it("reproduces the frozen demo score: 33 = 1 PASS / 3", () => {
    const scenarios = [
      scenario("baseline", "PASS", false, "https://replay/1"),
      scenario("http-500", "FAIL", true, "https://replay/2"),
      scenario("slow-api", "FAIL", true, "https://replay/3"),
      scenario("offline", "PASS", true, "https://replay/4"),
    ]
    const { score, scoreState } = computeScore(true, scenarios, false)
    expect(scoreState).toBe("SCORED")
    expect(score).toBe(33)
  })

  it("baseline failure blocks scoring", () => {
    const { score, scoreState } = computeScore(false, [scenario("b", "FAIL", false, null)], false)
    expect(scoreState).toBe("BLOCKED")
    expect(score).toBeNull()
  })

  it("any infrastructure ERROR makes the audit INCONCLUSIVE", () => {
    const scenarios = [
      scenario("baseline", "PASS", false, "https://r/1"),
      scenario("http-500", "ERROR", true, null),
      scenario("offline", "PASS", true, "https://r/2"),
    ]
    const { score, scoreState } = computeScore(true, scenarios, false)
    expect(scoreState).toBe("INCONCLUSIVE")
    expect(score).toBeNull()
  })

  it("missing replay evidence for a valid scenario makes the audit INCONCLUSIVE", () => {
    const scenarios = [
      scenario("baseline", "PASS", false, null),
      scenario("http-500", "FAIL", true, "https://r/2"),
    ]
    const { scoreState } = computeScore(true, scenarios, true)
    expect(scoreState).toBe("INCONCLUSIVE")
  })

  it("never resurrects the legacy 67", () => {
    const scenarios = [
      scenario("baseline", "PASS", false, "r"),
      scenario("http-500", "FAIL", true, "r"),
      scenario("slow-api", "FAIL", true, "r"),
      scenario("offline", "PASS", true, "r"),
    ]
    const { score } = computeScore(true, scenarios, false)
    expect(score).not.toBe(67)
    expect(score).toBe(33)
  })
})
