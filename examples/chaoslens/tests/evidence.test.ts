import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { writeScenarioEvidence } from "../src/browser/evidence.js"
import type { ScenarioResult } from "../src/types.js"

function result(): ScenarioResult {
  return {
    runId: "run-1",
    scenarioId: "http-500",
    scenarioName: "HTTP 500",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    faultType: "http-500",
    faultTarget: "/api/checkout",
    faultActivated: true,
    assertions: [],
    status: "FAIL",
    failureReasons: ["spinner hidden — observed: element still visible"],
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

describe("artifact serialization", () => {
  it("writes the full evidence bundle and redacts secrets", () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "chaoslens-test-"))
    const evidence = writeScenarioEvidence({
      runDir,
      scenarioId: "http-500",
      result: result(),
      screenshot: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      consoleEvents: [{ timestamp: new Date().toISOString(), type: "error", text: "boom" }],
      networkEvents: [
        {
          timestamp: new Date().toISOString(),
          method: "GET",
          url: "https://x.preview.getsolari.com/?pt_token=SECRET-TOKEN-VALUE",
          status: 200,
          durationMs: 5,
        },
      ],
      faultEvents: [
        { timestamp: new Date().toISOString(), type: "http-500", target: "/api/checkout", activated: true, detail: "ok" },
      ],
      serverLog: "listening with key slr_live_SHOULD_NOT_APPEAR\n",
      replayUrl: null,
      replayRaw: null,
    })

    for (const p of [
      evidence.consoleLogPath,
      evidence.networkEventsPath,
      evidence.faultEventsPath,
      evidence.serverLogPath,
      evidence.replayUrlPath,
    ]) {
      expect(p).not.toBeNull()
      expect(existsSync(p!)).toBe(true)
    }
    expect(existsSync(evidence.screenshotPath!)).toBe(true)

    const network = readFileSync(evidence.networkEventsPath!, "utf8")
    expect(network).not.toContain("SECRET-TOKEN-VALUE")
    expect(network).toContain("pt_token=[REDACTED]")

    const serverLog = readFileSync(evidence.serverLogPath!, "utf8")
    expect(serverLog).not.toContain("SHOULD_NOT_APPEAR")

    const replayRef = readFileSync(evidence.replayUrlPath!, "utf8")
    expect(replayRef).toContain("REPLAY UNAVAILABLE")

    const scenarioJson = readFileSync(path.join(runDir, "http-500", "scenario-result.json"), "utf8")
    expect(scenarioJson).toContain('"faultActivated": true')
    expect(scenarioJson).toContain('"status": "FAIL"')
  })

  it("records the replay URL when one exists", () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "chaoslens-test-"))
    const evidence = writeScenarioEvidence({
      runDir,
      scenarioId: "offline",
      result: { ...result(), scenarioId: "offline", faultType: "offline", replayUrl: "https://replay.example/x" },
      screenshot: null,
      consoleEvents: [],
      networkEvents: [],
      faultEvents: [],
      serverLog: "",
      replayUrl: "https://replay.example/x",
      replayRaw: new Uint8Array([1, 2, 3]),
    })
    expect(readFileSync(evidence.replayUrlPath!, "utf8")).toContain("https://replay.example/x")
    expect(existsSync(evidence.replayRawPath!)).toBe(true)
  })
})
