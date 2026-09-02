import type { Page } from "patchright-core"
import type { FaultConfig } from "../types.js"
import * as log from "../log.js"
import { faultEvent, urlMatcher, type ArmedFault } from "./shared.js"

/**
 * F1 — HTTP Server Error (Spec §8). Intercept requests matching the target
 * and answer with a controlled HTTP 500. `faultActivated` becomes true only
 * when a request is actually intercepted — otherwise the scenario must be
 * ERROR, never PASS (Spec §24).
 */
export async function armHttp500(page: Page, fault: FaultConfig): Promise<ArmedFault> {
  const target = fault.target ?? ""
  const events = [faultEvent(fault, false, `route armed for target "${target}"`)]
  let intercepts = 0

  await page.route(urlMatcher(target), async (route) => {
    intercepts += 1
    if (intercepts === 1) {
      events.push(faultEvent(fault, true, `first intercepted: ${route.request().method()} ${route.request().url()}`))
      log.verbose(`fault http-500 activated on ${route.request().url()}`)
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "ChaosLens injected HTTP 500" }),
    }).catch(() => {})
  })

  return {
    fault,
    events,
    activated: () => intercepts > 0,
    disarm: () => page.unroute(urlMatcher(target)).catch(() => {}),
  }
}
