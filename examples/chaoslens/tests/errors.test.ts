import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChaosLensError, messageOf, stageOf } from "../src/errors.js"
import { requireSolariApiKey } from "../src/env.js"

describe("error model", () => {
  it("carries the audit stage", () => {
    const error = new ChaosLensError("SANDBOX_CREATE", "boom")
    expect(stageOf(error)).toBe("SANDBOX_CREATE")
    expect(messageOf(error)).toBe("boom")
  })

  it("stageOf returns undefined for foreign errors", () => {
    expect(stageOf(new Error("x"))).toBeUndefined()
  })

  it("messageOf stringifies non-Error values", () => {
    expect(messageOf("plain")).toBe("plain")
  })
})

describe("SOLARI_API_KEY handling (AC-02)", () => {
  const saved = process.env["SOLARI_API_KEY"]
  afterEach(() => {
    if (saved === undefined) delete process.env["SOLARI_API_KEY"]
    else process.env["SOLARI_API_KEY"] = saved
    vi.restoreAllMocks()
  })

  it("reads the key from the environment", () => {
    process.env["SOLARI_API_KEY"] = "slr_live_from_env"
    expect(requireSolariApiKey()).toBe("slr_live_from_env")
  })

  it("falls back to a .env file", () => {
    delete process.env["SOLARI_API_KEY"]
    const dir = mkdtempSync(path.join(tmpdir(), "chaoslens-env-"))
    const envPath = path.join(dir, ".env")
    writeFileSync(envPath, "# comment\nSOLARI_API_KEY=slr_live_from_file\n")
    expect(requireSolariApiKey(envPath)).toBe("slr_live_from_file")
  })

  it("fails explicitly when the key is missing — no mock fallback", () => {
    delete process.env["SOLARI_API_KEY"]
    const dir = mkdtempSync(path.join(tmpdir(), "chaoslens-env-"))
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__")
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    let threw = false
    try {
      requireSolariApiKey(path.join(dir, "does-not-exist.env"))
    } catch (error) {
      threw = true
      expect(String(error)).toContain("__exit__")
    }
    expect(threw).toBe(true)
    const printed = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(printed).toContain("SOLARI_API_KEY is not configured")
    expect(printed.toLowerCase()).not.toContain("mock fallback enabled")
  })
})

