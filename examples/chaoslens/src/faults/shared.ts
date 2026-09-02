import type { FaultConfig, FaultEvent } from "../types.js"

export interface ArmedFault {
  fault: FaultConfig
  events: FaultEvent[]
  activated(): boolean
  disarm(): Promise<void>
}

export function faultEvent(fault: FaultConfig, activated: boolean, detail: string): FaultEvent {
  return {
    timestamp: new Date().toISOString(),
    type: fault.type,
    target: fault.target ?? "browser-context",
    activated,
    detail,
  }
}

export function urlMatcher(target: string): (url: URL) => boolean {
  return (url) => url.href.includes(target)
}
