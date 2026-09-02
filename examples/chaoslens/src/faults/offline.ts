import type { BrowserContext } from "patchright-core"
import type { FaultConfig, FaultEvent } from "../types.js"
import * as log from "../log.js"
import { faultEvent, type ArmedFault } from "./shared.js"

/**
 * F3 — Offline (Spec §8). Switch the BrowserContext offline immediately
 * before the configured critical network action; restore afterwards.
 */
export async function armOffline(context: BrowserContext, fault: FaultConfig): Promise<ArmedFault> {
  const events: FaultEvent[] = []
  let active = false

  await context.setOffline(true)
  active = true
  events.push(faultEvent(fault, true, "browser context switched offline before critical action"))
  log.verbose("fault offline activated")

  return {
    fault,
    events,
    activated: () => active,
    disarm: async () => {
      await context.setOffline(false).catch(() => {})
      events.push(faultEvent(fault, true, "browser context back online"))
    },
  }
}
