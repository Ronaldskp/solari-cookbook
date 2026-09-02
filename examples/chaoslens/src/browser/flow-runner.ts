import type { BrowserContext, Page, Request } from "patchright-core"
import { ChaosLensError } from "../errors.js"
import { armHttp500 } from "../faults/http-error.js"
import { armLatency } from "../faults/latency.js"
import { armOffline } from "../faults/offline.js"
import type { ArmedFault } from "../faults/shared.js"
import type {
  ConsoleEvent,
  FaultConfig,
  FlowConfig,
  FlowStep,
  NetworkEvent,
} from "../types.js"
import * as log from "../log.js"

export interface FlowRun {
  completed: boolean
  consoleEvents: ConsoleEvent[]
  networkEvents: NetworkEvent[]
  fault: ArmedFault | null
  /** Index of the step that faulted the run, if any. */
  failedStepIndex: number | null
  failureReason: string | null
}

interface RequestTiming {
  startedAt: number
  event: NetworkEvent
}

const DEFAULT_STEP_TIMEOUT_MS = 15_000

function resolveStepUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`
}

async function executeStep(page: Page, baseUrl: string, step: FlowStep, timeoutMs: number): Promise<void> {
  const timeout = step.timeoutMs ?? timeoutMs
  switch (step.action) {
    case "goto":
      await page.goto(resolveStepUrl(baseUrl, step.path ?? "/"), { timeout, waitUntil: "domcontentloaded" })
      return
    case "click":
      await page.locator(step.selector ?? "").first().click({ timeout })
      return
    case "fill":
      await page.locator(step.selector ?? "").first().fill(step.value ?? "", { timeout })
      return
    case "waitForVisible":
      await page.locator(step.selector ?? "").first().waitFor({ state: "visible", timeout })
      return
    case "waitForHidden":
      await page.locator(step.selector ?? "").first().waitFor({ state: "hidden", timeout })
      return
    case "wait":
      // Deterministic pause (duration = timeoutMs) — used to separate
      // programmatic clicks so duplicate submissions are provable.
      await new Promise((resolve) => setTimeout(resolve, timeout))
      return
  }
}

async function armFault(
  page: Page,
  context: BrowserContext,
  fault: FaultConfig,
): Promise<ArmedFault> {
  switch (fault.type) {
    case "http-500":
      return armHttp500(page, fault)
    case "latency":
      return armLatency(page, fault)
    case "offline":
      return armOffline(context, fault)
  }
}

/**
 * Execute the configured critical flow deterministically (Spec §9). No
 * autonomous exploration: every step comes from config, and the fault (if
 * any) is armed immediately before the configured step.
 */
export async function runFlow(
  page: Page,
  context: BrowserContext,
  baseUrl: string,
  flow: FlowConfig,
  fault: FaultConfig | null,
): Promise<FlowRun> {
  const consoleEvents: ConsoleEvent[] = []
  const networkEvents: NetworkEvent[] = []
  const pending = new Map<Request, RequestTiming>()

  page.on("console", (message) => {
    consoleEvents.push({
      timestamp: new Date().toISOString(),
      type: message.type(),
      text: message.text(),
    })
  })
  page.on("request", (request) => {
    const event: NetworkEvent = {
      timestamp: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      status: null,
      durationMs: null,
    }
    pending.set(request, { startedAt: Date.now(), event })
    networkEvents.push(event)
  })
  page.on("response", (response) => {
    const timing = pending.get(response.request())
    if (timing) timing.event.status = response.status()
  })
  const finalize = (request: Request): void => {
    const timing = pending.get(request)
    if (timing) {
      timing.event.durationMs = Date.now() - timing.startedAt
      pending.delete(request)
    }
  }
  page.on("requestfinished", finalize)
  page.on("requestfailed", finalize)

  const stepTimeoutMs = flow.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  // Default: arm right before the final step (the critical network action).
  const armBefore = flow.faultArmBeforeStep ?? flow.steps.length

  let armedFault: ArmedFault | null = null
  let failedStepIndex: number | null = null
  let failureReason: string | null = null
  let completed = true

  try {
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i]
      if (!step) break
      if (fault && armedFault === null && i + 1 === armBefore) {
        armedFault = await armFault(page, context, fault)
        log.verbose(`fault armed before step ${i + 1} (${step.action})`)
      }
      try {
        await executeStep(page, baseUrl, step, stepTimeoutMs)
        log.verbose(`step ${i + 1}/${flow.steps.length} ${step.action} ok`)
      } catch (error) {
        completed = false
        failedStepIndex = i
        failureReason = `${step.action} ${step.selector ?? step.path ?? ""} failed: ${String(error)}`
        log.verbose(`step ${i + 1} failed: ${String(error)}`)
        break
      }
    }
  } catch (error) {
    // Fault arming itself failed → infrastructure ERROR, not an app FAIL.
    throw new ChaosLensError("FAULT_INJECTION", `failed to arm fault: ${String(error)}`, error)
  }

  return { completed, consoleEvents, networkEvents, fault: armedFault, failedStepIndex, failureReason }
}
