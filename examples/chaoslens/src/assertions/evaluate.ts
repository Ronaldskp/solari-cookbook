import type { Page } from "patchright-core"
import type { AssertionConfig, AssertionResult, NetworkEvent } from "../types.js"

export interface EvaluationContext {
  page: Page
  flowCompleted: boolean
  networkEvents: NetworkEvent[]
  defaultTimeoutMs: number
}

export interface EvaluationOutcome {
  results: AssertionResult[]
  /** Set when an assertion could not be evaluated (e.g. invalid selector) → scenario ERROR. */
  evaluationError: string | null
}

const POLL_INTERVAL_MS = 250

async function pollUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

function describe(assertion: AssertionConfig): string {
  switch (assertion.type) {
    case "visible":
      return `${assertion.selector} visible`
    case "hidden":
      return `${assertion.selector} hidden`
    case "disabled":
      return `${assertion.selector} disabled`
    case "text":
      return `${assertion.selector} contains "${assertion.text}"`
    case "requestCount":
      return `requests matching "${assertion.urlPattern}" <= ${assertion.max}`
    case "baselineSuccess":
      return "healthy flow completes"
  }
}

async function evaluateOne(
  assertion: AssertionConfig,
  ctx: EvaluationContext,
): Promise<{ pass: boolean; expected: string; observed: string }> {
  const timeoutMs = assertion.timeoutMs ?? ctx.defaultTimeoutMs
  const expected = describe(assertion)
  switch (assertion.type) {
    case "visible": {
      const locator = ctx.page.locator(assertion.selector ?? "").first()
      await locator.count() // invalid selector → evaluation error (scenario ERROR)
      const pass = await pollUntil(() => locator.isVisible().catch(() => false), timeoutMs)
      return { pass, expected, observed: pass ? "element visible" : `element not visible within ${timeoutMs}ms` }
    }
    case "hidden": {
      const locator = ctx.page.locator(assertion.selector ?? "").first()
      await locator.count()
      const pass = await pollUntil(async () => {
        const count = await locator.count().catch(() => 0)
        if (count === 0) return true
        return !(await locator.isVisible().catch(() => false))
      }, timeoutMs)
      return { pass, expected, observed: pass ? "element hidden" : `element still visible after ${timeoutMs}ms` }
    }
    case "disabled": {
      const locator = ctx.page.locator(assertion.selector ?? "").first()
      await locator.count()
      const pass = await pollUntil(async () => {
        const count = await locator.count().catch(() => 0)
        if (count === 0) return false
        return await locator.isDisabled().catch(() => false)
      }, timeoutMs)
      return { pass, expected, observed: pass ? "element disabled" : `element still enabled after ${timeoutMs}ms` }
    }
    case "text": {
      const locator = ctx.page.locator(assertion.selector ?? "").first()
      await locator.count()
      const needle = assertion.text ?? ""
      let lastText = ""
      // Form elements expose their state through value, not inner text.
      const readText = async (): Promise<string> => {
        const value = await locator.inputValue().catch(() => null)
        if (value !== null) return value
        return await locator.innerText().catch(() => "")
      }
      const pass = await pollUntil(async () => {
        const text = await readText()
        lastText = text
        return text.includes(needle)
      }, timeoutMs)
      return {
        pass,
        expected,
        observed: pass ? `text contains "${needle}"` : `text was ${JSON.stringify(lastText.slice(0, 200))}`,
      }
    }
    case "requestCount": {
      const pattern = assertion.urlPattern ?? ""
      const max = assertion.max ?? 0
      const count = ctx.networkEvents.filter((e) => e.url.includes(pattern)).length
      return {
        pass: count <= max,
        expected,
        observed: `${count} request(s) matched "${pattern}"`,
      }
    }
    case "baselineSuccess":
      return {
        pass: ctx.flowCompleted,
        expected,
        observed: ctx.flowCompleted ? "flow completed" : "flow did not complete",
      }
  }
}

/**
 * Evaluate deterministic assertions (Spec §10). Every PASS/FAIL comes from
 * these checks — never from an LLM. An assertion that cannot be evaluated at
 * all (invalid selector, crash) is an evaluation error → scenario ERROR.
 */
export async function evaluateAssertions(
  assertions: AssertionConfig[],
  ctx: EvaluationContext,
): Promise<EvaluationOutcome> {
  const results: AssertionResult[] = []
  let evaluationError: string | null = null

  for (const assertion of assertions) {
    try {
      const { pass, expected, observed } = await evaluateOne(assertion, ctx)
      results.push({ assertion, pass, expected, observed, evaluatedAt: new Date().toISOString() })
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        results.push({
          assertion,
          pass: false,
          expected: describe(assertion),
          observed: `timed out after ${assertion.timeoutMs ?? ctx.defaultTimeoutMs}ms`,
          evaluatedAt: new Date().toISOString(),
        })
        continue
      }
      evaluationError = `assertion (${assertion.type}) could not be evaluated: ${String(error)}`
      results.push({
        assertion,
        pass: false,
        expected: describe(assertion),
        observed: `evaluation error: ${String(error)}`,
        evaluatedAt: new Date().toISOString(),
      })
    }
  }

  return { results, evaluationError }
}
