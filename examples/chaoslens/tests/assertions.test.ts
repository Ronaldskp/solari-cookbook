import { describe, expect, it } from "vitest"
import { evaluateAssertions } from "../src/assertions/evaluate.js"
import type { Page } from "patchright-core"
import type { AssertionConfig, NetworkEvent } from "../src/types.js"

interface ElementState {
  count: number
  visible: boolean
  disabled: boolean
  text: string
}

function fakePage(state: Partial<ElementState>, selectorThrows = false): Page {
  const full: ElementState = { count: 1, visible: true, disabled: false, text: "", ...state }
  const locator = {
    first: () => locator,
    count: async () => {
      if (selectorThrows) throw new Error("strict mode violation: unexpected selector")
      return full.count
    },
    isVisible: async () => full.visible && full.count > 0,
    isDisabled: async () => full.disabled,
    innerText: async () => full.text,
  }
  return { locator: () => locator } as unknown as Page
}

function networkEvent(url: string, method = "POST"): NetworkEvent {
  return { timestamp: new Date().toISOString(), method, url, status: 200, durationMs: 10 }
}

describe("assertion evaluation", () => {
  it("visible passes when the element is visible", async () => {
    const page = fakePage({ visible: true })
    const { results, evaluationError } = await evaluateAssertions(
      [{ type: "visible", selector: "#x", timeoutMs: 50 }],
      { page, flowCompleted: true, networkEvents: [], defaultTimeoutMs: 50 },
    )
    expect(evaluationError).toBeNull()
    expect(results[0]?.pass).toBe(true)
  })

  it("visible fails when the element never appears", async () => {
    const page = fakePage({ visible: false })
    const { results, evaluationError } = await evaluateAssertions(
      [{ type: "visible", selector: "#x", timeoutMs: 60 }],
      { page, flowCompleted: true, networkEvents: [], defaultTimeoutMs: 50 },
    )
    expect(evaluationError).toBeNull()
    expect(results[0]?.pass).toBe(false)
  })

  it("hidden passes when the element disappears", async () => {
    const page = fakePage({ count: 0 })
    const { results } = await evaluateAssertions([{ type: "hidden", selector: "#spin", timeoutMs: 50 }], {
      page,
      flowCompleted: true,
      networkEvents: [],
      defaultTimeoutMs: 50,
    })
    expect(results[0]?.pass).toBe(true)
  })

  it("disabled fails while the button stays enabled", async () => {
    const page = fakePage({ disabled: false })
    const { results } = await evaluateAssertions([{ type: "disabled", selector: "#btn", timeoutMs: 60 }], {
      page,
      flowCompleted: true,
      networkEvents: [],
      defaultTimeoutMs: 50,
    })
    expect(results[0]?.pass).toBe(false)
  })

  it("requestCount compares observed requests against max", async () => {
    const page = fakePage({})
    const assertions: AssertionConfig[] = [{ type: "requestCount", urlPattern: "/api/checkout", max: 1 }]
    const ctx = {
      page,
      flowCompleted: true,
      networkEvents: [networkEvent("https://x/api/checkout"), networkEvent("https://x/api/checkout")],
      defaultTimeoutMs: 50,
    }
    const two = await evaluateAssertions(assertions, ctx)
    expect(two.results[0]?.pass).toBe(false)

    const one = await evaluateAssertions(assertions, { ...ctx, networkEvents: [networkEvent("https://x/api/checkout")] })
    expect(one.results[0]?.pass).toBe(true)
  })

  it("text passes when the expected text is present", async () => {
    const page = fakePage({ text: "Thank you for your order!" })
    const { results } = await evaluateAssertions(
      [{ type: "text", selector: "#ok", text: "Thank you", timeoutMs: 50 }],
      { page, flowCompleted: true, networkEvents: [], defaultTimeoutMs: 50 },
    )
    expect(results[0]?.pass).toBe(true)
  })

  it("baselineSuccess mirrors flow completion", async () => {
    const page = fakePage({})
    const done = await evaluateAssertions([{ type: "baselineSuccess" }], {
      page,
      flowCompleted: true,
      networkEvents: [],
      defaultTimeoutMs: 50,
    })
    expect(done.results[0]?.pass).toBe(true)
    const broken = await evaluateAssertions([{ type: "baselineSuccess" }], {
      page,
      flowCompleted: false,
      networkEvents: [],
      defaultTimeoutMs: 50,
    })
    expect(broken.results[0]?.pass).toBe(false)
  })

  it("reports an evaluation error (scenario ERROR) for broken selectors", async () => {
    const page = fakePage({}, true)
    const { evaluationError } = await evaluateAssertions(
      [{ type: "visible", selector: "###bad", timeoutMs: 50 }],
      { page, flowCompleted: true, networkEvents: [], defaultTimeoutMs: 50 },
    )
    expect(evaluationError).toContain("could not be evaluated")
  })
})
