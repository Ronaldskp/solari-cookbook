import { describe, expect, it } from "vitest"
import { armHttp500 } from "../src/faults/http-error.js"
import { armLatency } from "../src/faults/latency.js"
import { armOffline } from "../src/faults/offline.js"
import { urlMatcher } from "../src/faults/shared.js"
import type { BrowserContext, Page } from "patchright-core"

interface FakeRoute {
  request: () => { method: () => string; url: () => string }
  fulfill: (opts: { status?: number; body?: string }) => Promise<void>
  continue: () => Promise<void>
}

function fakePage() {
  const routes: Array<{ handler: (route: FakeRoute) => Promise<void> }> = []
  const page = {
    route: async (_matcher: unknown, handler: (route: FakeRoute) => Promise<void>) => {
      routes.push({ handler })
    },
    unroute: async () => {},
  } as unknown as Page
  return { page, routes }
}

function fakeRoute(url: string): { route: FakeRoute; fulfilled: Array<{ status?: number }>; continued: number[] } {
  const fulfilled: Array<{ status?: number }> = []
  const continued: number[] = []
  const route: FakeRoute = {
    request: () => ({ method: () => "POST", url: () => url }),
    fulfill: async (opts) => {
      fulfilled.push(opts)
    },
    continue: async () => {
      continued.push(Date.now())
    },
  }
  return { route, fulfilled, continued }
}

describe("fault model", () => {
  it("http-500 is not activated until a request is intercepted", async () => {
    const { page, routes } = fakePage()
    const armed = await armHttp500(page, { type: "http-500", target: "/api/checkout" })
    expect(armed.activated()).toBe(false)

    const { route, fulfilled } = fakeRoute("https://app.preview/api/checkout")
    await routes[0]!.handler(route)
    expect(armed.activated()).toBe(true)
    expect(fulfilled[0]?.status).toBe(500)
    expect(armed.events.some((e) => e.activated)).toBe(true)
  })

  it("latency delays the request then continues it", async () => {
    const { page, routes } = fakePage()
    const armed = await armLatency(page, { type: "latency", target: "/api/checkout", delayMs: 30 })
    const { route, continued } = fakeRoute("https://app.preview/api/checkout")
    const started = Date.now()
    await routes[0]!.handler(route)
    const elapsed = Date.now() - started
    expect(continued).toHaveLength(1)
    expect(elapsed).toBeGreaterThanOrEqual(25)
    expect(armed.activated()).toBe(true)
  })

  it("offline activates by switching the context offline", async () => {
    let offline = false
    const context = { setOffline: async (v: boolean) => void (offline = v) } as unknown as BrowserContext
    const armed = await armOffline(context, { type: "offline" })
    expect(offline).toBe(true)
    expect(armed.activated()).toBe(true)
    await armed.disarm()
    expect(offline).toBe(false)
  })

  it("urlMatcher matches by substring", () => {
    const match = urlMatcher("/api/checkout")
    expect(match(new URL("https://x.preview.getsolari.com/api/checkout"))).toBe(true)
    expect(match(new URL("https://x.preview.getsolari.com/other"))).toBe(false)
  })

  it("every fault event carries a timestamp, type, target and activation flag", async () => {
    const { page, routes } = fakePage()
    const armed = await armHttp500(page, { type: "http-500", target: "/api" })
    const { route } = fakeRoute("https://x/api")
    await routes[0]!.handler(route)
    for (const event of armed.events) {
      expect(new Date(event.timestamp).toString()).not.toBe("Invalid Date")
      expect(event.type).toBe("http-500")
      expect(typeof event.activated).toBe("boolean")
    }
  })
})
