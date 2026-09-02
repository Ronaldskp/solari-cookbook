import type { Page } from "patchright-core"
import type { FaultConfig } from "../types.js"
import * as log from "../log.js"
import { faultEvent, urlMatcher, type ArmedFault } from "./shared.js"

/**
 * F2 — Artificial Network Latency (Spec §8). Delay every matching request by
 * a deterministic amount, then let it continue to the real server.
 */
export async function armLatency(page: Page, fault: FaultConfig): Promise<ArmedFault> {
  const target = fault.target ?? ""
  const delayMs = fault.delayMs ?? 0
  const events = [faultEvent(fault, false, `route armed for target "${target}" with ${delayMs}ms delay`)]
  let intercepts = 0

  await page.route(urlMatcher(target), async (route) => {
    intercepts += 1
    const request = route.request()
    if (intercepts === 1) {
      events.push(faultEvent(fault, true, `first intercepted: ${request.method()} ${request.url()}`))
      log.verbose(`fault latency(${delayMs}ms) activated on ${request.url()}`)
    }
    const armedAt = new Date().toISOString()
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    events.push(
      faultEvent(fault, true, `delayed ${request.method()} ${request.url()} by ${delayMs}ms (armed ${armedAt})`),
    )
    // The session may be closed while a delayed request is still parked
    // (e.g. flow finished before the delay elapsed) — that is expected.
    await route.continue().catch(() => {})
  })

  return {
    fault,
    events,
    activated: () => intercepts > 0,
    disarm: () => page.unroute(urlMatcher(target)).catch(() => {}),
  }
}
