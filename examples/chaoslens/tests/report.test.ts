import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { generateReport } from "../src/report/html.js"
import type { AuditResult, ScenarioResult } from "../src/types.js"

function scenario(
  id: string,
  status: ScenarioResult["status"],
  faulted: boolean,
  failureReasons: string[] = [],
): ScenarioResult {
  return {
    runId: "run-1",
    scenarioId: id,
    scenarioName: id,
    startTime: "",
    endTime: "",
    faultType: faulted ? "http-500" : null,
    faultTarget: faulted ? "/api/checkout" : null,
    faultActivated: faulted,
    assertions: [
      {
        assertion: { type: "visible", selector: "#x" },
        pass: status !== "FAIL",
        expected: "#x visible",
        observed: status === "FAIL" ? "not visible" : "visible",
        evaluatedAt: "",
      },
    ],
    status,
    failureReasons,
    evidence: {
      screenshotPath: null,
      consoleLogPath: null,
      networkEventsPath: null,
      faultEventsPath: null,
      serverLogPath: null,
      replayUrlPath: null,
      replayRawPath: null,
    },
    replayUrl: null,
  }
}

function audit(overrides: Partial<AuditResult>): AuditResult {
  return {
    runId: "run-1",
    startedAt: "2026-09-02T00:00:00Z",
    finishedAt: "2026-09-02T00:10:00Z",
    applicationName: "Demo Checkout",
    flowName: "Checkout",
    baseline: "PASS",
    baselineReason: null,
    scenarios: [
      scenario("baseline", "PASS", false),
      scenario("http-500", "FAIL", true, ["spinner hidden — observed: still visible"]),
      scenario("slow-api", "FAIL", true, ["requests <= 1 — observed: 2"]),
      scenario("offline", "PASS", true),
    ],
    score: 33,
    scoreState: "SCORED",
    ...overrides,
  }
}

describe("HTML report", () => {
  const runDir = mkdtempSync(path.join(tmpdir(), "chaoslens-report-"))

  it("renders the headline, score and per-scenario verdicts", () => {
    const html = generateReport(audit({}), runDir)
    expect(html).toContain("See what your users see when your backend fails.")
    expect(html).toContain("33")
    expect(html).toContain("http-500")
    expect(html).toContain("chip-pass")
    expect(html).toContain("chip-fail")
  })

  it("distinguishes ERROR from application FAIL", () => {
    const html = generateReport(
      audit({
        scenarios: [scenario("baseline", "PASS", false), scenario("http-500", "ERROR", true, ["SANDBOX_CREATE: boom"])],
        score: null,
        scoreState: "INCONCLUSIVE",
      }),
      runDir,
    )
    expect(html).toContain("chip-error")
    expect(html).toContain("inconclusive")
  })

  it("shows the blocked banner when the baseline fails", () => {
    const html = generateReport(
      audit({ baseline: "BLOCKED", score: null, scoreState: "BLOCKED" }),
      runDir,
    )
    expect(html).toContain("Baseline workflow failed")
  })

  it("escapes application-controlled strings", () => {
    const html = generateReport(
      audit({ applicationName: "<script>alert(1)</script>" }),
      runDir,
    )
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
