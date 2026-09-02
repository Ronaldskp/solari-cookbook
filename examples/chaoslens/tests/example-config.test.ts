import { describe, expect, it } from "vitest"
import exampleConfig from "../chaoslens.config.example.js"
import { validateConfig } from "../src/config.js"

describe("bundled demo config", () => {
  it("passes runtime validation as shipped", () => {
    const config = validateConfig(exampleConfig)
    expect(config.application.name).toBe("Demo Checkout")
    expect(config.scenarios.some((s) => s.fault === null)).toBe(true)
    expect(config.scenarios.map((s) => s.fault?.type ?? "none")).toEqual([
      "none",
      "http-500",
      "latency",
      "offline",
    ])
  })

  it("arms the fault before the Place Order click", () => {
    const config = validateConfig(exampleConfig)
    const armIndex = config.flow.faultArmBeforeStep
    expect(armIndex).toBeGreaterThan(0)
    const armedStep = config.flow.steps[(armIndex ?? 1) - 1]
    expect(armedStep?.action).toBe("click")
    expect(armedStep?.selector).toContain("place-order")
  })
})
