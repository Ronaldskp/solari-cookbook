import { describe, expect, it } from "vitest"
import { validateConfig } from "../src/config.js"
import type { ChaosLensConfig } from "../src/types.js"

function base(): ChaosLensConfig {
  return {
    application: {
      name: "Demo",
      repository: { url: "https://github.com/example/repo.git", ref: "main" },
      installCommand: "npm install",
      startCommand: "node server.js",
      port: 3000,
      healthPath: "/health",
    },
    flow: {
      name: "Checkout",
      faultArmBeforeStep: 2,
      steps: [
        { action: "goto", path: "/" },
        { action: "click", selector: "#go" },
      ],
    },
    scenarios: [
      { id: "baseline", name: "Healthy", fault: null, assertions: [{ type: "baselineSuccess" }] },
      {
        id: "http-500",
        name: "HTTP 500",
        fault: { type: "http-500", target: "/api" },
        assertions: [{ type: "visible", selector: "#err" }],
      },
    ],
  }
}

describe("config validation", () => {
  it("accepts a valid config", () => {
    expect(validateConfig(base())).toBeTruthy()
  })

  it("rejects a non-object", () => {
    expect(() => validateConfig("nope")).toThrow(/must be an object/)
  })

  it("rejects a non-http repository url", () => {
    const cfg = base()
    cfg.application.repository.url = "git@github.com:example/repo.git"
    expect(() => validateConfig(cfg)).toThrow(/http\(s\) URL/)
  })

  it("rejects an out-of-range port", () => {
    const cfg = base()
    cfg.application.port = 70000
    expect(() => validateConfig(cfg)).toThrow(/port/)
  })

  it("rejects a healthPath without leading slash", () => {
    const cfg = base()
    cfg.application.healthPath = "health"
    expect(() => validateConfig(cfg)).toThrow(/healthPath/)
  })

  it("rejects a fill step without a string value", () => {
    const cfg = base()
    cfg.flow.steps.push({ action: "fill", selector: "#email", value: 42 as unknown as string })
    expect(() => validateConfig(cfg)).toThrow(/value/)
  })

  it("rejects an unknown step action", () => {
    const cfg = base()
    cfg.flow.steps.push({ action: "hover" as never })
    expect(() => validateConfig(cfg)).toThrow(/action/)
  })

  it("rejects faultArmBeforeStep beyond the step list", () => {
    const cfg = base()
    cfg.flow.faultArmBeforeStep = 99
    expect(() => validateConfig(cfg)).toThrow(/faultArmBeforeStep/)
  })

  it("rejects a latency fault without delayMs", () => {
    const cfg = base()
    cfg.scenarios[1]!.fault = { type: "latency", target: "/api" }
    expect(() => validateConfig(cfg)).toThrow(/delayMs/)
  })

  it("rejects an http-500 fault without target", () => {
    const cfg = base()
    cfg.scenarios[1]!.fault = { type: "http-500" }
    expect(() => validateConfig(cfg)).toThrow(/target/)
  })

  it("rejects a requestCount assertion without a non-negative max", () => {
    const cfg = base()
    cfg.scenarios[1]!.assertions = [{ type: "requestCount", urlPattern: "/api", max: -1 }]
    expect(() => validateConfig(cfg)).toThrow(/max/)
  })

  it("rejects a text assertion without expected text", () => {
    const cfg = base()
    cfg.scenarios[1]!.assertions = [{ type: "text", selector: "#msg" }]
    expect(() => validateConfig(cfg)).toThrow(/text/)
  })

  it("rejects duplicate scenario ids", () => {
    const cfg = base()
    cfg.scenarios.push({ ...cfg.scenarios[1]!, name: "again" })
    expect(() => validateConfig(cfg)).toThrow(/duplicate scenario id/)
  })

  it("rejects configs with no baseline scenario", () => {
    const cfg = base()
    cfg.scenarios = cfg.scenarios.filter((s) => s.fault !== null)
    expect(() => validateConfig(cfg)).toThrow(/baseline/)
  })

  it("rejects empty scenarios", () => {
    const cfg = base()
    cfg.scenarios = []
    expect(() => validateConfig(cfg)).toThrow(/scenarios/)
  })
})
